import type { OrgChartDisplayMode, OrgChartNode, OrgChartStore } from './types'
import { buildFiberCellOrgChartSeed } from './seed'
import { autoLayoutOrgChart } from './layout'

/** Компактные ячейки + перенос рядов под печать. Старые layout пересчитать один раз. */
export const ORG_CHART_LAYOUT_VERSION = 3

function normalizeNode(raw: unknown, fallbackOrder: number): OrgChartNode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = String(r.id ?? '').trim()
  const nameFull = String(r.nameFull ?? r.name ?? '').trim()
  if (!id || !nameFull) return null
  const nameShort = String(r.nameShort ?? r.shortName ?? '').trim() || nameFull.slice(0, 6)
  return {
    id,
    parentId: r.parentId ? String(r.parentId) : undefined,
    nameFull,
    nameShort,
    sortOrder: Number.isFinite(r.sortOrder) ? Number(r.sortOrder) : fallbackOrder,
    layoutX: Number.isFinite(r.layoutX) ? Number(r.layoutX) : 0,
    layoutY: Number.isFinite(r.layoutY) ? Number(r.layoutY) : 0,
    structuralUnitId: r.structuralUnitId ? String(r.structuralUnitId) : undefined,
    positionId: r.positionId ? String(r.positionId) : undefined,
    employeeId: r.employeeId ? String(r.employeeId) : undefined,
    archived: r.archived === true,
    updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
  }
}

export function createDefaultOrgChartStore(): OrgChartStore {
  const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
  return { nodes, displayMode: 'both', layoutVersion: ORG_CHART_LAYOUT_VERSION }
}

export function normalizeOrgChartStore(raw: OrgChartStore | undefined): OrgChartStore {
  if (!raw?.nodes?.length) return createDefaultOrgChartStore()
  const nodes = raw.nodes
    .map((n, i) => normalizeNode(n, i))
    .filter((n): n is OrgChartNode => !!n && !n.archived)
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    if (n.parentId && !ids.has(n.parentId)) n.parentId = undefined
  }
  const displayMode: OrgChartDisplayMode =
    raw.displayMode === 'full' || raw.displayMode === 'short' || raw.displayMode === 'both'
      ? raw.displayMode
      : 'both'
  const version = Number(raw.layoutVersion) || 0
  const needsCompact = version < ORG_CHART_LAYOUT_VERSION
  const hasLayout = nodes.some((n) => n.layoutX !== 0 || n.layoutY !== 0)
  return {
    nodes: needsCompact || !hasLayout ? autoLayoutOrgChart(nodes) : nodes,
    displayMode,
    layoutVersion: ORG_CHART_LAYOUT_VERSION,
  }
}

export function ensureOrgChartSeed(store: OrgChartStore | undefined): OrgChartStore {
  if (!store?.nodes?.length) return createDefaultOrgChartStore()
  return normalizeOrgChartStore(store)
}
