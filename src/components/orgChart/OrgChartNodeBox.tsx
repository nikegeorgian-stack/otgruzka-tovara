import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { orgNodeLabelParts } from '@/lib/orgChart/display'
import { ORG_CHART_NODE_H, ORG_CHART_NODE_W } from '@/lib/orgChart/layout'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'
import type { OrgChartTone } from '@/lib/orgChart/visual'

type Props = {
  node: OrgChartNode
  tone: OrgChartTone
  displayMode: OrgChartDisplayMode
  selected?: boolean
  highlighted?: boolean
  dropTarget?: boolean
  vacant?: boolean
  hrBroken?: boolean
  hrPartial?: boolean
  collapsedCount?: number
  canEdit: boolean
  boxRef?: (el: HTMLDivElement | null) => void
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function OrgChartNodeBox({
  node,
  tone,
  displayMode,
  selected,
  highlighted,
  dropTarget,
  vacant,
  hrBroken,
  hrPartial,
  collapsedCount = 0,
  canEdit,
  boxRef,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const parts = orgNodeLabelParts(node.nameFull, node.nameShort, displayMode)
  const badges = [
    collapsedCount > 0 ? { key: 'collapsed', label: `+${collapsedCount}`, className: 'border-stone-300 bg-white/90 text-stone-700' } : null,
    vacant ? { key: 'vacant', label: 'vac', className: 'border-amber-200 bg-amber-50 text-amber-700' } : null,
    hrBroken ? { key: 'hr-broken', label: 'HR!', className: 'border-red-200 bg-red-50 text-red-700' } : null,
    !hrBroken && hrPartial ? { key: 'hr-partial', label: 'HR?', className: 'border-amber-200 bg-amber-50 text-amber-700' } : null,
  ].filter(Boolean) as { key: string; label: string; className: string }[]

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      className={`absolute select-none overflow-hidden rounded-md text-center shadow-sm transition-[box-shadow,transform] ${
        canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${selected ? 'z-10 scale-[1.02] shadow-md' : ''} ${
        highlighted && !selected ? 'z-10 ring-2 ring-sky-300 shadow-md' : ''
      } ${dropTarget ? 'z-10 ring-2 ring-emerald-400' : ''}`}
      style={{
        left: node.layoutX,
        top: node.layoutY,
        width: ORG_CHART_NODE_W,
        minHeight: ORG_CHART_NODE_H,
        background: tone.bg,
        border: `1px solid ${selected ? tone.accent : tone.border}`,
        boxShadow: selected ? `0 0 0 2px ${tone.accent}33` : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick?.()
      }}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      data-coach="orgTree:node"
      title={node.nameFull}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone.accent }} aria-hidden />
      {badges.length ? (
        <div className="pointer-events-none absolute right-1 top-1 flex flex-col items-end gap-1">
          {badges.map((badge) => (
            <span
              key={badge.key}
              className={`rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase leading-none shadow-sm ${badge.className}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex h-full min-h-[inherit] flex-col items-center justify-center px-1.5 py-1 pl-2.5">
        {parts.isAbbrev ? (
          <div
            className="text-[11px] font-bold leading-tight tracking-wide"
            style={{ color: tone.accent }}
          >
            {parts.primary}
          </div>
        ) : (
          <div
            className="line-clamp-2 text-[10px] font-semibold leading-tight"
            style={{ color: tone.text }}
          >
            {parts.primary}
          </div>
        )}
        {parts.secondary ? (
          <div
            className="mt-0.5 line-clamp-2 text-[8px] leading-tight"
            style={{ color: tone.muted }}
          >
            {parts.secondary}
          </div>
        ) : null}
      </div>
    </div>
  )
}
