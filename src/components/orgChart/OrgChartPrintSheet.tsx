import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { orgNodeLabelParts } from '@/lib/orgChart/display'
import {
  edgePath,
  layoutOrgChartForPrint,
  ORG_CHART_NODE_H,
  ORG_CHART_NODE_W,
  orgChartCanvasSize,
} from '@/lib/orgChart/layout'
import { orgChartSubtreeNodes } from '@/lib/orgChart/subtree'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'
import { orgChartToneForNode } from '@/lib/orgChart/visual'

export type OrgChartPrintPaper = 'a4' | 'a3'

type Props = {
  organization: string
  nodes: OrgChartNode[]
  displayMode: OrgChartDisplayMode
  rootId?: string
  paper: OrgChartPrintPaper
  printedAt: string
  title: string
}

export function OrgChartPrintSheet({
  organization,
  nodes,
  displayMode,
  rootId,
  paper,
  printedAt,
  title,
}: Props) {
  const sourceNodes = rootId ? orgChartSubtreeNodes(nodes, rootId) : nodes
  const laid = layoutOrgChartForPrint(sourceNodes)
  const size = orgChartCanvasSize(laid)
  const byId = new Map(laid.map((n) => [n.id, n]))
  const edges = laid.flatMap((n) => {
    if (!n.parentId) return []
    const parent = byId.get(n.parentId)
    if (!parent) return []
    const tone = orgChartToneForNode(laid, n.id)
    return [{ from: parent, to: n, stroke: tone.edge }]
  })

  return (
    <div
      className={`org-chart-print-page print-sheet-page ${
        paper === 'a3' ? 'print-sheet-page--a3' : ''
      } mx-auto bg-white text-stone-900`}
    >
      <div className="print-sheet-content">
        <header className="mb-2 flex shrink-0 items-start justify-between gap-3 border-b border-stone-300 pb-2">
          <FiberCellBrand variant="print" />
          <div className="text-right text-[10px] leading-snug">
            <div className="font-semibold">{organization}</div>
            <div className="mt-0.5 text-stone-600">{printedAt}</div>
            <div className="mt-0.5 uppercase tracking-wide text-stone-400">
              {paper.toUpperCase()}
            </div>
          </div>
        </header>
        <h1 className="mb-2 shrink-0 text-center text-sm font-bold uppercase tracking-wide">
          {title}
        </h1>

        <div
          className="relative mx-auto min-h-0 flex-1"
          style={{ width: size.width, height: size.height, maxWidth: '100%' }}
        >
          <svg className="absolute inset-0" width={size.width} height={size.height} aria-hidden>
            <defs>
              {edges.map(({ to, stroke }) => (
                <marker
                  key={`pm-${to.id}`}
                  id={`org-print-arrow-${to.id}`}
                  markerWidth="6"
                  markerHeight="6"
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
                strokeWidth={1}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={`url(#org-print-arrow-${to.id})`}
              />
            ))}
          </svg>
          {laid.map((node) => {
            const parts = orgNodeLabelParts(node.nameFull, node.nameShort, displayMode)
            const tone = orgChartToneForNode(laid, node.id)
            return (
              <div
                key={node.id}
                className="absolute overflow-hidden text-center"
                style={{
                  left: node.layoutX,
                  top: node.layoutY,
                  width: ORG_CHART_NODE_W,
                  minHeight: ORG_CHART_NODE_H,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  borderRadius: 4,
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 w-[2px]"
                  style={{ background: tone.accent }}
                  aria-hidden
                />
                <div className="flex h-full min-h-[inherit] flex-col items-center justify-center px-1 py-0.5 pl-1.5">
                  <div
                    className="text-[9px] font-bold leading-tight"
                    style={{ color: parts.isAbbrev ? tone.accent : tone.text }}
                  >
                    {parts.primary}
                  </div>
                  {parts.secondary ? (
                    <div
                      className="mt-px line-clamp-2 text-[7px] leading-tight"
                      style={{ color: tone.muted }}
                    >
                      {parts.secondary}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
