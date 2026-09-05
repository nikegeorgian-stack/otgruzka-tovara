import { formatOrgShortLabel, orgNodeDisplayLabel } from './display'
import { orgChartParent, orgChartReportsToChain } from './hierarchy'
import type { OrgChartDisplayMode, OrgChartNode } from './types'

export type OrgChartOccupancyFilter = 'all' | 'occupied' | 'vacant' | 'hrLinked' | 'hrUnlinked'

export type OrgChartSearchHit = {
  node: OrgChartNode
  chainLabel: string
}

type SearchCtx = {
  employeeNameById: Map<string, string>
  unitNameById: Map<string, string>
  positionTitleById: Map<string, string>
}

export function filterOrgChartNodes(
  nodes: OrgChartNode[],
  filter: OrgChartOccupancyFilter,
): OrgChartNode[] {
  if (filter === 'all') return nodes
  return nodes.filter((n) => {
    if (filter === 'occupied') return !!n.employeeId
    if (filter === 'vacant') return !n.employeeId
    if (filter === 'hrLinked') return !!(n.structuralUnitId && n.positionId)
    return !n.structuralUnitId && !n.positionId
  })
}

export function searchOrgChartNodes(
  nodes: OrgChartNode[],
  query: string,
  ctx: SearchCtx,
  opts?: {
    filter?: OrgChartOccupancyFilter
    displayMode?: OrgChartDisplayMode
    limit?: number
  },
): OrgChartSearchHit[] {
  const filter = opts?.filter ?? 'all'
  const mode = opts?.displayMode ?? 'both'
  const limit = opts?.limit ?? 40
  const needle = query.trim().toLowerCase()
  const pool = filterOrgChartNodes(nodes, filter)
  if (!needle) {
    return pool.slice(0, limit).map((node) => ({
      node,
      chainLabel: formatChain(nodes, node.id, mode),
    }))
  }

  const hits: OrgChartSearchHit[] = []
  for (const node of pool) {
    const emp = node.employeeId ? ctx.employeeNameById.get(node.employeeId) ?? '' : ''
    const unit = node.structuralUnitId ? ctx.unitNameById.get(node.structuralUnitId) ?? '' : ''
    const pos = node.positionId ? ctx.positionTitleById.get(node.positionId) ?? '' : ''
    const hay = [
      node.nameFull,
      node.nameShort,
      formatOrgShortLabel(node.nameShort),
      emp,
      unit,
      pos,
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(needle)) continue
    hits.push({ node, chainLabel: formatChain(nodes, node.id, mode) })
    if (hits.length >= limit) break
  }
  return hits
}

function formatChain(
  nodes: OrgChartNode[],
  nodeId: string,
  mode: OrgChartDisplayMode,
): string {
  return orgChartReportsToChain(nodes, nodeId)
    .slice()
    .reverse()
    .map((n) => orgNodeDisplayLabel(n.nameFull, n.nameShort, mode === 'both' ? 'short' : mode))
    .join(' → ')
}

export function formatOrgChartChainCopy(
  nodes: OrgChartNode[],
  nodeId: string,
  mode: OrgChartDisplayMode,
): string {
  return orgChartReportsToChain(nodes, nodeId)
    .slice()
    .reverse()
    .map((n) => {
      if (mode === 'full') return n.nameFull
      if (mode === 'short') return formatOrgShortLabel(n.nameShort)
      return `${formatOrgShortLabel(n.nameShort)} ${n.nameFull}`
    })
    .join(' → ')
}

export function orgChartManagerShort(
  nodes: OrgChartNode[],
  nodeId: string,
  mode: OrgChartDisplayMode,
): string {
  const p = orgChartParent(nodes, nodeId)
  if (!p) return '—'
  return orgNodeDisplayLabel(p.nameFull, p.nameShort, mode)
}
