import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OrgChartNodeBox } from '@/components/orgChart/OrgChartNodeBox'
import { useI18n } from '@/context/I18nContext'
import { edgePath, orgChartCanvasSize } from '@/lib/orgChart/layout'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'
import { orgChartToneForNode } from '@/lib/orgChart/visual'

export type OrgChartCanvasPan = {
  x: number
  y: number
}

export type OrgChartCanvasIndicators = {
  vacant?: boolean
  hrBroken?: boolean
  hrPartial?: boolean
  collapsedCount?: number
}

export type OrgChartCanvasMenuEvent = {
  clientX: number
  clientY: number
  preventDefault: () => void
}

type Props = {
  nodes: OrgChartNode[]
  displayMode: OrgChartDisplayMode
  canEdit: boolean
  selectedId: string | null
  highlightId: string | null
  collapsedIds: ReadonlySet<string> | string[]
  dropTarget?: string | null
  zoom: number
  pan: OrgChartCanvasPan
  nodeIndicators?: Record<string, OrgChartCanvasIndicators>
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onReparent: (id: string, parentId: string) => void
  onPanChange?: (pan: OrgChartCanvasPan) => void
  onContextMenuNode: (event: OrgChartCanvasMenuEvent, id: string) => void
  onContextMenuCanvas: (event: OrgChartCanvasMenuEvent) => void
  onDoubleClickEdit: (id: string) => void
}

export function OrgChartCanvas({
  nodes,
  displayMode,
  canEdit,
  selectedId,
  highlightId,
  collapsedIds,
  dropTarget,
  zoom,
  pan,
  nodeIndicators,
  onSelect,
  onMove,
  onReparent,
  onPanChange,
  onContextMenuNode,
  onContextMenuCanvas,
  onDoubleClickEdit,
}: Props) {
  const { t } = useI18n()
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)
  const panRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const touchRef = useRef<{
    id: string
    startX: number
    startY: number
    timer: number | null
  } | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const [localDropTargetId, setLocalDropTargetId] = useState<string | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({})
  const collapsedSet = useMemo(
    () => (collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds)),
    [collapsedIds],
  )
  const activeDropTargetId = dropTarget ?? localDropTargetId

  const size = useMemo(() => orgChartCanvasSize(nodes), [nodes])

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const live = livePos[n.id]
        return live ? { ...n, layoutX: live.x, layoutY: live.y } : n
      }),
    [livePos, nodes],
  )

  const edges = useMemo(() => {
    const byId = new Map(displayNodes.map((n) => [n.id, n]))
    const list: { from: OrgChartNode; to: OrgChartNode; stroke: string }[] = []
    for (const n of displayNodes) {
      if (!n.parentId) continue
      const parent = byId.get(n.parentId)
      if (!parent) continue
      const tone = orgChartToneForNode(displayNodes, n.id)
      list.push({ from: parent, to: n, stroke: tone.edge })
    }
    return list
  }, [displayNodes])

  useEffect(() => {
    const down = (e: KeyboardEvent) => setShiftHeld(e.shiftKey)
    const up = (e: KeyboardEvent) => setShiftHeld(e.shiftKey)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const clearTouchTimer = useCallback(() => {
    const touch = touchRef.current
    if (!touch) return
    if (touch.timer != null) window.clearTimeout(touch.timer)
    touchRef.current = null
  }, [])

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      if (drag) {
        if (shiftHeld && activeDropTargetId && activeDropTargetId !== drag.id) {
          onReparent(drag.id, activeDropTargetId)
        } else if (drag.moved) {
          const dx = clientX - drag.startX
          const dy = clientY - drag.startY
          onMove(drag.id, drag.origX + dx, drag.origY + dy)
        }
        dragRef.current = null
        setLivePos({})
        setLocalDropTargetId(null)
        return
      }

      const p = panRef.current
      if (!p) return
      const dx = (clientX - p.startX) / Math.max(zoom, 0.001)
      const dy = (clientY - p.startY) / Math.max(zoom, 0.001)
      onPanChange?.({ x: p.origX + dx, y: p.origY + dy })
      panRef.current = null
    },
    [activeDropTargetId, onMove, onPanChange, onReparent, shiftHeld, zoom],
  )

  useEffect(() => () => clearTouchTimer(), [clearTouchTimer])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag) {
        if ((e.buttons & 1) === 0) return
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
        setLivePos({
          [drag.id]: { x: drag.origX + dx, y: drag.origY + dy },
        })
        return
      }

      const panState = panRef.current
      if (panState) {
        const dx = (e.clientX - panState.startX) / Math.max(zoom, 0.001)
        const dy = (e.clientY - panState.startY) / Math.max(zoom, 0.001)
        onPanChange?.({ x: panState.origX + dx, y: panState.origY + dy })
      }

      const touch = touchRef.current
      if (touch && Math.abs(e.clientX - touch.startX) + Math.abs(e.clientY - touch.startY) > 12) {
        clearTouchTimer()
      }
    }

    const up = (e: PointerEvent) => {
      clearTouchTimer()
      finishDrag(e.clientX, e.clientY)
    }

    const cancel = () => {
      clearTouchTimer()
      dragRef.current = null
      panRef.current = null
      setLocalDropTargetId(null)
      setLivePos({})
    }

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [clearTouchTimer, finishDrag, onPanChange, zoom])

  const openSelectedContextMenu = useCallback(() => {
    if (!selectedId) return
    const el = nodeRefs.current.get(selectedId)
    if (!el) return
    const rect = el.getBoundingClientRect()
    onContextMenuNode(
      {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        preventDefault: () => {},
      },
      selectedId,
    )
  }, [onContextMenuNode, selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault()
        openSelectedContextMenu()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSelectedContextMenu, selectedId])

  return (
    <div className="space-y-2">
      {canEdit ? <p className="hidden text-xs text-stone-500 sm:block">{t('orgTree.canvasHint')}</p> : null}
      <div
        className="relative overflow-hidden rounded-xl border border-stone-200 max-sm:min-h-[260px] max-sm:h-[min(58vh,400px)] min-h-[300px] h-[min(68vh,560px)] sm:min-h-[360px]"
        style={{
          backgroundColor: '#F8FAFC',
          backgroundImage: 'radial-gradient(circle at 1px 1px, #E2E8F0 1px, transparent 0)',
          backgroundSize: '16px 16px',
          touchAction: 'none',
        }}
        onClick={() => onSelect(null)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenuCanvas(e)
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          panRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: pan.x,
            origY: pan.y,
          }
          onSelect(null)
        }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="relative origin-top-left"
            style={{
              width: size.width,
              height: size.height,
              minWidth: size.width,
              minHeight: size.height,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={size.width}
              height={size.height}
              aria-hidden
            >
              <defs>
                {edges.map(({ to, stroke }) => (
                  <marker
                    key={`m-${to.id}`}
                    id={`org-arrow-${to.id}`}
                    markerWidth="7"
                    markerHeight="7"
                    refX="5"
                    refY="2.5"
                    orient="auto"
                  >
                    <path d="M0,0 L5,2.5 L0,5 Z" fill={stroke} />
                  </marker>
                ))}
              </defs>
              {edges.map(({ from, to, stroke }) => (
                <path
                  key={`${from.id}-${to.id}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd={`url(#org-arrow-${to.id})`}
                />
              ))}
            </svg>

            {displayNodes.map((node) => (
              <OrgChartNodeBox
                key={node.id}
                boxRef={(el) => {
                  if (el) nodeRefs.current.set(node.id, el)
                  else nodeRefs.current.delete(node.id)
                }}
                node={node}
                tone={orgChartToneForNode(displayNodes, node.id)}
                displayMode={displayMode}
                selected={selectedId === node.id}
                highlighted={highlightId === node.id}
                dropTarget={activeDropTargetId === node.id && shiftHeld}
                vacant={nodeIndicators?.[node.id]?.vacant}
                hrBroken={nodeIndicators?.[node.id]?.hrBroken}
                hrPartial={nodeIndicators?.[node.id]?.hrPartial}
                collapsedCount={nodeIndicators?.[node.id]?.collapsedCount}
                canEdit={canEdit}
                onClick={() => {
                  if (suppressClickRef.current === node.id) {
                    suppressClickRef.current = null
                    return
                  }
                  onSelect(node.id)
                }}
                onDoubleClick={canEdit ? () => onDoubleClickEdit(node.id) : undefined}
                onContextMenu={(e) => {
                  e.stopPropagation()
                  onSelect(node.id)
                  onContextMenuNode(e, node.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(node.id)
                  }
                }}
                onPointerEnter={() => {
                  if (dragRef.current && dragRef.current.id !== node.id) {
                    setLocalDropTargetId(node.id)
                  }
                }}
                onPointerLeave={() => {
                  if (activeDropTargetId === node.id) setLocalDropTargetId(null)
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect(node.id)
                  if (e.pointerType === 'touch') {
                    touchRef.current = {
                      id: node.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      timer: window.setTimeout(() => {
                        suppressClickRef.current = node.id
                        onContextMenuNode(
                          {
                            clientX: e.clientX,
                            clientY: e.clientY,
                            preventDefault: () => {},
                          },
                          node.id,
                        )
                        clearTouchTimer()
                      }, 500),
                    }
                    return
                  }
                  if (!canEdit || e.button !== 0) return
                  dragRef.current = {
                    id: node.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: node.layoutX,
                    origY: node.layoutY,
                    moved: false,
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-stone-500">
        <span>{t('orgTree.zoom.current').replace('{value}', `${Math.round(zoom * 100)}%`)}</span>
        <span>
          {t(collapsedSet.size ? 'orgTree.collapseSummary' : 'orgTree.collapseSummaryEmpty').replace(
            '{count}',
            String(collapsedSet.size),
          )}
        </span>
      </div>
    </div>
  )
}
