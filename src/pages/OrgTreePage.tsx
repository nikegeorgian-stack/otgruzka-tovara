import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  OrgChartCanvas,
  type OrgChartCanvasMenuEvent,
  type OrgChartCanvasPan,
} from '@/components/orgChart/OrgChartCanvas'
import { OrgChartAssignDialog } from '@/components/orgChart/OrgChartAssignDialog'
import { OrgChartContextMenu, type OrgChartMenuAction } from '@/components/orgChart/OrgChartContextMenu'
import { OrgChartDeleteDialog } from '@/components/orgChart/OrgChartDeleteDialog'
import { OrgChartDisplayModeBar } from '@/components/orgChart/OrgChartDisplayModeBar'
import { OrgChartHelpDialog } from '@/components/orgChart/OrgChartHelpDialog'
import { OrgChartNodeDialog } from '@/components/orgChart/OrgChartNodeDialog'
import { OrgChartPrintModal } from '@/components/orgChart/OrgChartPrintModal'
import { OrgChartReparentDialog } from '@/components/orgChart/OrgChartReparentDialog'
import { OrgChartSidePanel } from '@/components/orgChart/OrgChartSidePanel'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import type { AppUser } from '@/lib/access/types'
import { formatOrgShortLabel, orgNodeDisplayLabel } from '@/lib/orgChart/display'
import { ORG_CHART_NODE_H, ORG_CHART_NODE_W } from '@/lib/orgChart/layout'
import { orgChartParent } from '@/lib/orgChart/hierarchy'
import { createDefaultOrgChartStore } from '@/lib/orgChart/init'
import { orgChartHrLinkStatus, type OrgChartHrLinkStatus } from '@/lib/orgChart/ops'
import {
  formatOrgChartChainCopy,
  orgChartManagerShort,
  searchOrgChartNodes,
  type OrgChartOccupancyFilter,
} from '@/lib/orgChart/search'
import { orgChartAncestors, orgChartBranchIds, orgChartCountDescendants, orgChartHiddenByCollapse } from '@/lib/orgChart/subtree'
import { resolveDocHeaderOrg } from '@/lib/print/docHeaderOptions'
import type { OrgChartDisplayMode, OrgChartNode, OrgChartNodeDraft } from '@/lib/orgChart/types'
import { type OrgChartRemoveMode } from '@/lib/orgChart/validate'
import { clampOrgChartZoom, loadOrgChartUiPrefs, saveOrgChartUiPrefs } from '@/lib/orgChart/uiPrefs'
import { orgChartToneForNode } from '@/lib/orgChart/visual'
import type { AppStore } from '@/lib/types'

type TabId = 'chart' | 'list'
type MenuState =
  | {
      mode: 'node' | 'canvas'
      x: number
      y: number
      nodeId?: string
    }
  | null

const FILTERS: OrgChartOccupancyFilter[] = ['all', 'occupied', 'vacant', 'hrLinked', 'hrUnlinked']

type Props = {
  store: AppStore
  currentUser: AppUser | null
  canEdit: boolean
  onSetDisplayMode: (mode: OrgChartDisplayMode) => void
  onUpsertNode: (draft: OrgChartNodeDraft) => string
  onMoveNode: (id: string, x: number, y: number) => boolean
  onReparentNode: (id: string, parentId: string | undefined) => boolean
  onArchiveNode: (id: string) => boolean
  onRemoveNode: (id: string, mode?: OrgChartRemoveMode) => boolean
  onAssignEmployee: (nodeId: string, employeeId: string) => boolean
  onUnassignEmployee: (nodeId: string) => boolean
  onSetHrLink: (
    nodeId: string,
    link: { structuralUnitId?: string; positionId?: string },
  ) => boolean
  onAutoLayout: () => void
  onAutoLayoutBranch: (rootId: string) => void
}

export function OrgTreePage(props: Props) {
  const {
    store,
    currentUser,
    canEdit,
    onSetDisplayMode,
    onUpsertNode,
    onMoveNode,
    onReparentNode,
    onRemoveNode,
    onAssignEmployee,
    onUnassignEmployee,
    onAutoLayout,
    onAutoLayoutBranch,
  } = props
  const { t, locale } = useI18n()
  const orgChart = store.orgChart ?? createDefaultOrgChartStore()
  const displayMode = orgChart.displayMode ?? 'both'
  const nodes = useMemo(() => orgChart.nodes.filter((node) => !node.archived), [orgChart.nodes])
  const viewportRef = useRef<HTMLDivElement>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const didInitialFitRef = useRef(false)
  const initialPrefs = useMemo(() => loadOrgChartUiPrefs(currentUser?.id), [currentUser?.id])

  const [tab, setTab] = useState<TabId>('chart')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNode, setEditingNode] = useState<OrgChartNode | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [printRootId, setPrintRootId] = useState<string | undefined>()
  const [helpOpen, setHelpOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState>(null)
  const [removeNodeId, setRemoveNodeId] = useState<string | null>(null)
  const [reparentNodeId, setReparentNodeId] = useState<string | null>(null)
  const [assignState, setAssignState] = useState<{ nodeId: string; mode: 'assign' | 'replace' } | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<OrgChartOccupancyFilter>('all')
  const [focusBranchId, setFocusBranchId] = useState<string | null>(initialPrefs.focusBranchId)
  const [collapsedIds, setCollapsedIds] = useState<string[]>(initialPrefs.collapsedIds)
  const [zoom, setZoom] = useState(initialPrefs.zoom)
  const [pan, setPan] = useState<OrgChartCanvasPan>({ x: initialPrefs.panX, y: initialPrefs.panY })

  const orgName = resolveDocHeaderOrg(store, locale).organization || store.settings.site

  const tabs = useMemo(
    () =>
      [
        ['chart', 'orgTree.tab.chart'],
        ['list', 'orgTree.tab.list'],
      ] as const,
    [],
  ).map(([id, key]) => ({ id, label: t(key) }))

  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const removeNode = removeNodeId ? nodes.find((node) => node.id === removeNodeId) ?? null : null
  const reparentNode = reparentNodeId ? nodes.find((node) => node.id === reparentNodeId) ?? null : null
  const assignNode = assignState ? nodes.find((node) => node.id === assignState.nodeId) ?? null : null

  const employeeById = useMemo(
    () => new Map(store.employees.map((employee) => [employee.id, employee])),
    [store.employees],
  )
  const employeeNameById = useMemo(
    () =>
      new Map(
        store.employees.map((employee) => [employee.id, employeeName(employee, locale)]),
      ),
    [locale, store.employees],
  )
  const unitNameById = useMemo(
    () => new Map(store.hrStructuralUnits.map((unit) => [unit.id, unit.name])),
    [store.hrStructuralUnits],
  )
  const positionTitleById = useMemo(
    () => new Map(store.hrPositions.map((position) => [position.id, position.title])),
    [store.hrPositions],
  )
  const unitIds = useMemo(() => new Set(store.hrStructuralUnits.map((unit) => unit.id)), [store.hrStructuralUnits])
  const positionIds = useMemo(
    () => new Set(store.hrPositions.map((position) => position.id)),
    [store.hrPositions],
  )
  const hrStatusById = useMemo(() => {
    const next: Record<string, OrgChartHrLinkStatus> = {}
    for (const node of nodes) {
      next[node.id] = orgChartHrLinkStatus(node, unitIds, positionIds)
    }
    return next
  }, [nodes, positionIds, unitIds])

  const searchHits = useMemo(
    () =>
      searchOrgChartNodes(nodes, q, {
        employeeNameById,
        unitNameById,
        positionTitleById,
      }, {
        filter,
        displayMode,
        limit: nodes.length,
      }),
    [displayMode, employeeNameById, filter, nodes, positionTitleById, q, unitNameById],
  )

  const focusScopedNodes = useMemo(() => {
    if (!focusBranchId || !nodes.some((node) => node.id === focusBranchId)) return nodes
    const ids = orgChartBranchIds(nodes, focusBranchId)
    return nodes.filter((node) => ids.has(node.id))
  }, [focusBranchId, nodes])
  const collapsedSet = useMemo(() => new Set(collapsedIds), [collapsedIds])
  const hiddenIds = useMemo(
    () => orgChartHiddenByCollapse(focusScopedNodes, collapsedSet),
    [collapsedSet, focusScopedNodes],
  )
  const visibleNodes = useMemo(
    () => focusScopedNodes.filter((node) => !hiddenIds.has(node.id)),
    [focusScopedNodes, hiddenIds],
  )
  const nodeIndicators = useMemo(() => {
    const next: Record<string, { vacant?: boolean; hrBroken?: boolean; hrPartial?: boolean; collapsedCount?: number }> = {}
    for (const node of visibleNodes) {
      const hrStatus = hrStatusById[node.id]
      next[node.id] = {
        vacant: !node.employeeId,
        hrBroken: hrStatus === 'broken',
        hrPartial: hrStatus === 'partial',
        collapsedCount: collapsedSet.has(node.id) ? orgChartCountDescendants(focusScopedNodes, node.id) : 0,
      }
    }
    return next
  }, [collapsedSet, focusScopedNodes, hrStatusById, visibleNodes])
  const chartHits = useMemo(
    () => (q.trim() || filter !== 'all' ? searchHits.slice(0, 12) : []),
    [filter, q, searchHits],
  )
  const listRows = useMemo(() => searchHits.map((hit) => hit.node), [searchHits])
  const menuNode =
    menu?.mode === 'node' && menu.nodeId ? nodes.find((node) => node.id === menu.nodeId) ?? null : null
  const focusNode = focusBranchId ? nodes.find((node) => node.id === focusBranchId) ?? null : null

  const [createParentId, setCreateParentId] = useState<string | undefined>()

  useEffect(() => {
    const prefs = loadOrgChartUiPrefs(currentUser?.id)
    setCollapsedIds(prefs.collapsedIds)
    setFocusBranchId(prefs.focusBranchId)
    setZoom(prefs.zoom)
    setPan({ x: prefs.panX, y: prefs.panY })
  }, [currentUser?.id])

  useEffect(() => {
    const validIds = new Set(nodes.map((node) => node.id))
    setCollapsedIds((prev) => prev.filter((id) => validIds.has(id)))
    setFocusBranchId((prev) => (prev && validIds.has(prev) ? prev : null))
    setSelectedId((prev) => (prev && validIds.has(prev) ? prev : null))
  }, [nodes])

  useEffect(() => {
    saveOrgChartUiPrefs(currentUser?.id, {
      collapsedIds,
      focusBranchId,
      zoom,
      panX: pan.x,
      panY: pan.y,
    })
  }, [collapsedIds, currentUser?.id, focusBranchId, pan.x, pan.y, zoom])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  const openCreate = (parentId?: string) => {
    setEditingNode(null)
    setCreateParentId(parentId)
    setEditorOpen(true)
  }

  const flashHighlight = useCallback((id: string) => {
    setHighlightId(id)
    if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightId((current) => (current === id ? null : current))
      highlightTimerRef.current = null
    }, 1800)
  }, [])

  const centerOnNode = useCallback(
    (nodeId: string, nextZoom = zoom) => {
      const node = nodes.find((item) => item.id === nodeId)
      const viewport = viewportRef.current
      if (!node || !viewport) return
      const boxX = node.layoutX + ORG_CHART_NODE_W / 2
      const boxY = node.layoutY + ORG_CHART_NODE_H / 2
      const x = viewport.clientWidth / (2 * nextZoom) - boxX
      const y = viewport.clientHeight / (2 * nextZoom) - boxY
      setPan({ x, y })
    },
    [nodes, zoom],
  )

  const fitVisibleNodes = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !visibleNodes.length) return
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = 0
    let maxY = 0
    for (const node of visibleNodes) {
      minX = Math.min(minX, node.layoutX)
      minY = Math.min(minY, node.layoutY)
      maxX = Math.max(maxX, node.layoutX + ORG_CHART_NODE_W)
      maxY = Math.max(maxY, node.layoutY + ORG_CHART_NODE_H)
    }
    const width = Math.max(ORG_CHART_NODE_W, maxX - minX)
    const height = Math.max(ORG_CHART_NODE_H, maxY - minY)
    const fit = clampOrgChartZoom(
      Math.min((viewport.clientWidth - 56) / width, (viewport.clientHeight - 56) / height, 2),
    )
    setZoom(fit)
    setPan({
      x: viewport.clientWidth / (2 * fit) - (minX + width / 2),
      y: viewport.clientHeight / (2 * fit) - (minY + height / 2),
    })
  }, [visibleNodes])

  const runCompactAutoLayout = useCallback(() => {
    onAutoLayout()
    window.setTimeout(() => fitVisibleNodes(), 60)
  }, [fitVisibleNodes, onAutoLayout])

  const runCompactAutoLayoutBranch = useCallback(
    (rootId: string) => {
      onAutoLayoutBranch(rootId)
      window.setTimeout(() => fitVisibleNodes(), 60)
    },
    [fitVisibleNodes, onAutoLayoutBranch],
  )

  useEffect(() => {
    if (didInitialFitRef.current || tab !== 'chart' || !visibleNodes.length) return
    didInitialFitRef.current = true
    const timer = window.setTimeout(() => fitVisibleNodes(), 80)
    return () => window.clearTimeout(timer)
  }, [fitVisibleNodes, tab, visibleNodes.length])

  const revealNode = useCallback(
    (nodeId: string, options?: { clearFocus?: boolean; focusBranch?: boolean; switchToChart?: boolean }) => {
      const node = nodes.find((item) => item.id === nodeId)
      if (!node) return
      const ancestorIds = new Set(orgChartAncestors(nodes, nodeId).map((item) => item.id))
      setCollapsedIds((prev) => prev.filter((id) => id !== nodeId && !ancestorIds.has(id)))
      if (options?.focusBranch) setFocusBranchId(nodeId)
      else if (options?.clearFocus ?? true) setFocusBranchId(null)
      if (options?.switchToChart ?? true) setTab('chart')
      setSelectedId(nodeId)
      flashHighlight(nodeId)
      requestAnimationFrame(() => centerOnNode(nodeId))
    },
    [centerOnNode, flashHighlight, nodes],
  )

  const copyText = useCallback((text: string) => {
    if (!text.trim()) return
    void navigator.clipboard?.writeText(text).catch(() => {})
  }, [])

  const openMenuNode = useCallback((event: OrgChartCanvasMenuEvent, nodeId: string) => {
    event.preventDefault()
    setSelectedId(nodeId)
    setMenu({ mode: 'node', nodeId, x: event.clientX, y: event.clientY })
  }, [])

  const openMenuCanvas = useCallback((event: OrgChartCanvasMenuEvent) => {
    event.preventDefault()
    setMenu({ mode: 'canvas', x: event.clientX, y: event.clientY })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  const handleMenuAction = useCallback(
    (action: OrgChartMenuAction) => {
      const node = menuNode ?? selected
      switch (action) {
        case 'openDetails':
        case 'showOnChart':
          if (node) revealNode(node.id)
          return
        case 'focusBranch':
          if (node) revealNode(node.id, { focusBranch: true })
          return
        case 'showAll':
          setFocusBranchId(null)
          return
        case 'collapseBranch':
          if (node) {
            setCollapsedIds((prev) => (prev.includes(node.id) ? prev : [...prev, node.id]))
          }
          return
        case 'expandBranch':
          if (node) {
            setCollapsedIds((prev) => prev.filter((id) => id !== node.id))
          }
          return
        case 'expandAllBranch':
          if (node) {
            const branchIds = orgChartBranchIds(nodes, node.id)
            setCollapsedIds((prev) => prev.filter((id) => !branchIds.has(id)))
          }
          return
        case 'copyName':
          if (node) copyText(node.nameFull)
          return
        case 'copyShort':
          if (node) copyText(formatOrgShortLabel(node.nameShort))
          return
        case 'copyChain':
          if (node) copyText(formatOrgChartChainCopy(nodes, node.id, displayMode))
          return
        case 'printBranch':
          if (node) {
            setPrintRootId(node.id)
            setPrintOpen(true)
          }
          return
        case 'edit':
        case 'hrLink':
          if (node) {
            setEditingNode(node)
            setEditorOpen(true)
          }
          return
        case 'addChild':
          if (node) openCreate(node.id)
          return
        case 'addSibling':
          if (node?.parentId) openCreate(node.parentId)
          return
        case 'reparent':
          if (node) setReparentNodeId(node.id)
          return
        case 'assign':
          if (node) setAssignState({ nodeId: node.id, mode: 'assign' })
          return
        case 'replace':
          if (node) setAssignState({ nodeId: node.id, mode: 'replace' })
          return
        case 'unassign':
          if (node?.employeeId) onUnassignEmployee(node.id)
          return
        case 'autoLayoutBranch':
          if (node) runCompactAutoLayoutBranch(node.id)
          return
        case 'remove':
          if (node) setRemoveNodeId(node.id)
          return
        case 'canvasShowAll':
          setFocusBranchId(null)
          setCollapsedIds([])
          return
        case 'canvasFit':
          fitVisibleNodes()
          return
        case 'canvasExpandAll':
          setCollapsedIds([])
          return
        case 'canvasClearFocus':
          setFocusBranchId(null)
          return
        case 'canvasPrintAll':
          setPrintRootId(undefined)
          setPrintOpen(true)
          return
        case 'canvasAdd':
          openCreate(selected?.id ?? undefined)
          return
        case 'canvasAutoLayout':
          runCompactAutoLayout()
      }
    },
    [
      copyText,
      displayMode,
      fitVisibleNodes,
      menuNode,
      nodes,
      runCompactAutoLayout,
      runCompactAutoLayoutBranch,
      onUnassignEmployee,
      openCreate,
      revealNode,
      selected,
    ],
  )

  return (
    <PageLayout>
      <PageHeader
        title={t('nav.orgTree')}
        subtitle={t('orgTree.subtitleFull')}
        density="compact"
        actions={
          <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:gap-2">
            <OrgChartDisplayModeBar value={displayMode} onChange={onSetDisplayMode} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
              {t('orgTree.help')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPrintRootId(undefined)
                setPrintOpen(true)
              }}
              data-coach="orgTree:print"
            >
              {t('orgTree.print')}
            </Button>
            {canEdit ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={runCompactAutoLayout}>
                  {t('orgTree.autoLayout')}
                </Button>
                <Button type="button" size="sm" onClick={() => openCreate(selected?.id)} data-coach="orgTree:add">
                  {t('orgTree.addNode')}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} coachPrefix="orgTree" />

      {tab === 'chart' ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-4">
          <div className="space-y-3 sm:space-y-4">
            <section className="rounded-xl border border-stone-200 bg-white p-2.5 sm:p-3">
              <div className="flex flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-2.5 sm:space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="w-full min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                      placeholder={t('orgTree.search')}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      data-coach="orgTree:search"
                    />
                    {q ? (
                      <Button size="sm" variant="ghost" onClick={() => setQ('')}>
                        {t('common.clear')}
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {FILTERS.map((item) => {
                      const active = item === filter
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            active
                              ? 'border-stone-900 bg-stone-900 text-white'
                              : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-white'
                          }`}
                          onClick={() => setFilter(item)}
                        >
                          {t(`orgTree.filter.${item}`)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setZoom((value) => clampOrgChartZoom(value - 0.1))}>
                    {t('orgTree.zoom.out')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setZoom((value) => clampOrgChartZoom(value + 0.1))}>
                    {t('orgTree.zoom.in')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => fitVisibleNodes()}>
                    {t('orgTree.zoom.fit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setZoom(1)
                      setPan({ x: 0, y: 0 })
                    }}
                  >
                    {t('orgTree.zoom.reset')}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {focusBranchId ? (
                  <button
                    type="button"
                    className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700"
                    onClick={() => setFocusBranchId(null)}
                  >
                    {t('orgTree.focusBranch')}:{' '}
                    {focusNode
                      ? orgNodeDisplayLabel(focusNode.nameFull, focusNode.nameShort, displayMode)
                      : t('orgTree.noParent')}
                  </button>
                ) : null}
                {collapsedIds.length ? (
                  <button
                    type="button"
                    className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-stone-700"
                    onClick={() => setCollapsedIds([])}
                  >
                    {t('orgTree.menu.expandAll')} ({collapsedIds.length})
                  </button>
                ) : null}
              </div>

              {chartHits.length ? (
                <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-2">
                  <p className="px-1 text-xs font-medium text-stone-500">
                    {t('orgTree.filter.results').replace('{count}', String(chartHits.length))}
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {chartHits.map((hit) => (
                      <button
                        key={hit.node.id}
                        type="button"
                        className="rounded-lg border border-transparent bg-white px-3 py-2 text-left text-sm transition hover:border-stone-200 hover:bg-stone-50"
                        onClick={() => revealNode(hit.node.id)}
                      >
                        <span className="block font-medium text-stone-900">
                          {orgNodeDisplayLabel(hit.node.nameFull, hit.node.nameShort, displayMode)}
                        </span>
                        <span className="mt-0.5 block text-xs text-stone-500">{hit.chainLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <div ref={viewportRef}>
              <OrgChartCanvas
                nodes={visibleNodes}
                displayMode={displayMode}
                canEdit={canEdit}
                selectedId={selectedId}
                highlightId={highlightId}
                collapsedIds={collapsedSet}
                zoom={zoom}
                pan={pan}
                nodeIndicators={nodeIndicators}
                onSelect={setSelectedId}
                onMove={(id, x, y) => onMoveNode(id, x, y)}
                onReparent={(id, parentId) => onReparentNode(id, parentId)}
                onPanChange={setPan}
                onContextMenuNode={openMenuNode}
                onContextMenuCanvas={openMenuCanvas}
                onDoubleClickEdit={(id) => {
                  const node = nodes.find((item) => item.id === id)
                  if (!node || !canEdit) return
                  setEditingNode(node)
                  setEditorOpen(true)
                }}
              />
            </div>
          </div>

          <div className={selected ? 'block' : 'hidden xl:block'}>
          <OrgChartSidePanel
            node={selected}
            nodes={nodes}
            employees={store.employees}
            unitNameById={unitNameById}
            positionTitleById={positionTitleById}
            displayMode={displayMode}
            canEdit={canEdit}
            hrLinkStatus={selected ? hrStatusById[selected.id] : null}
            onSelectNode={(id) => revealNode(id)}
            onCopyName={() => {
              if (selected) copyText(selected.nameFull)
            }}
            onCopyShort={() => {
              if (selected) copyText(formatOrgShortLabel(selected.nameShort))
            }}
            onCopyChain={() => {
              if (selected) copyText(formatOrgChartChainCopy(nodes, selected.id, displayMode))
            }}
            onShowOnChart={() => {
              if (selected) revealNode(selected.id)
            }}
            onPrintBranch={() => {
              if (!selected) return
              setPrintRootId(selected.id)
              setPrintOpen(true)
            }}
            onOpenEdit={() => {
              if (!selected) return
              setEditingNode(selected)
              setEditorOpen(true)
            }}
            onAddChild={() => {
              if (selected) openCreate(selected.id)
            }}
            onAssign={() => {
              if (!selected) return
              setAssignState({ nodeId: selected.id, mode: selected.employeeId ? 'replace' : 'assign' })
            }}
            onUnassign={() => {
              if (selected?.employeeId) onUnassignEmployee(selected.id)
            }}
            onReparent={() => {
              if (selected) setReparentNodeId(selected.id)
            }}
            onAutoLayoutBranch={() => {
              if (selected) runCompactAutoLayoutBranch(selected.id)
            }}
            onRemove={() => {
              if (selected) setRemoveNodeId(selected.id)
            }}
          />
          </div>
        </div>
      ) : null}

      {tab === 'list' ? (
        <div className="space-y-3">
          <input
            className="w-full max-w-md rounded border border-stone-300 px-3 py-1.5 text-sm"
            placeholder={t('orgTree.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="overflow-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">{t('orgTree.list.short')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.full')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.employee')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.manager')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.directReports')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.hrStatus')}</th>
                  <th className="px-3 py-2">{t('orgTree.list.vacant')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {listRows.map((node) => {
                  const employee = node.employeeId ? employeeById.get(node.employeeId) ?? null : null
                  const manager = orgChartParent(nodes, node.id)
                  const directReports = nodes.filter((item) => item.parentId === node.id).length
                  return (
                    <tr
                      key={node.id}
                      className="cursor-pointer hover:bg-stone-50"
                      onClick={() => revealNode(node.id)}
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-stone-800">
                        {formatOrgShortLabel(node.nameShort)}
                      </td>
                      <td className="px-3 py-2 text-stone-800">{node.nameFull}</td>
                      <td className="px-3 py-2 text-stone-700">
                        {employee ? employeeName(employee, locale) : '—'}
                      </td>
                      <td className="px-3 py-2 text-stone-600">
                        {manager ? orgChartManagerShort(nodes, node.id, displayMode) : t('orgTree.noParent')}
                      </td>
                      <td className="px-3 py-2 text-stone-600">{directReports}</td>
                      <td className="px-3 py-2 text-stone-600">{t(`orgTree.hrStatus.${hrStatusById[node.id]}.label`)}</td>
                      <td className="px-3 py-2 text-stone-600">{node.employeeId ? t('common.no') : t('common.yes')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <OrgChartNodeDialog
        open={editorOpen}
        store={store}
        node={editingNode?.id ? editingNode : null}
        parentOptions={nodes}
        defaultParentId={createParentId}
        onClose={() => {
          setCreateParentId(undefined)
          setEditorOpen(false)
        }}
        onSave={(draft) => {
          const id = onUpsertNode({
            ...draft,
            parentId: draft.parentId || createParentId,
          })
          setSelectedId(id)
          flashHighlight(id)
          setCreateParentId(undefined)
          setEditorOpen(false)
          requestAnimationFrame(() => centerOnNode(id))
        }}
        onArchive={
          editingNode?.id && canEdit ? () => setRemoveNodeId(editingNode.id) : undefined
        }
      />

      {printOpen ? (
        <OrgChartPrintModal
          organization={orgName}
          nodes={nodes}
          displayMode={displayMode}
          rootId={printRootId}
          onClose={() => {
            setPrintOpen(false)
            setPrintRootId(undefined)
          }}
        />
      ) : null}

      <OrgChartHelpDialog open={helpOpen} canEdit={canEdit} onClose={() => setHelpOpen(false)} />

      {removeNode ? (
        <OrgChartDeleteDialog
          open
          node={removeNode}
          nodes={nodes}
          onClose={() => setRemoveNodeId(null)}
          onConfirm={(mode) => {
            if (onRemoveNode(removeNode.id, mode)) {
              setRemoveNodeId(null)
              if (selectedId === removeNode.id) setSelectedId(null)
            }
          }}
        />
      ) : null}

      {reparentNode ? (
        <OrgChartReparentDialog
          open
          node={reparentNode}
          nodes={nodes}
          displayMode={displayMode}
          onClose={() => setReparentNodeId(null)}
          onConfirm={(parentId) => {
            if (onReparentNode(reparentNode.id, parentId)) {
              setReparentNodeId(null)
              revealNode(reparentNode.id)
            }
          }}
        />
      ) : null}

      {assignNode && assignState ? (
        <OrgChartAssignDialog
          open
          store={store}
          node={assignNode}
          mode={assignState.mode}
          onClose={() => setAssignState(null)}
          onConfirm={(employeeId) => {
            if (onAssignEmployee(assignNode.id, employeeId)) {
              setAssignState(null)
              setSelectedId(assignNode.id)
              flashHighlight(assignNode.id)
            }
          }}
        />
      ) : null}

      {menu ? (
        <OrgChartContextMenu
          x={menu.x}
          y={menu.y}
          mode={menu.mode}
          canEdit={canEdit}
          header={
            menuNode
              ? {
                  nameShort: menuNode.nameShort,
                  nameFull: menuNode.nameFull,
                  employeeLabel: menuNode.employeeId ? employeeNameById.get(menuNode.employeeId) ?? null : null,
                  tone: orgChartToneForNode(nodes, menuNode.id),
                }
              : undefined
          }
          collapsed={!!menuNode && collapsedSet.has(menuNode.id)}
          hasParent={!!menuNode?.parentId}
          hasChildren={!!menuNode && nodes.some((node) => node.parentId === menuNode.id)}
          hasEmployee={!!menuNode?.employeeId}
          onAction={handleMenuAction}
          onClose={closeMenu}
        />
      ) : null}

      {!currentUser ? null : (
        <p className="mt-2 text-xs text-stone-400">{t('orgTree.logicNote')}</p>
      )}
    </PageLayout>
  )
}

export default OrgTreePage
