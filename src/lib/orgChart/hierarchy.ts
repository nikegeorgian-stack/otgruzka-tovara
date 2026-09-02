import { formatOrgShortLabel } from './display'
import type { OrgChartNode, OrgChartStore } from './types'

export function orgChartNodeMap(nodes: OrgChartNode[]): Map<string, OrgChartNode> {
  return new Map(nodes.map((n) => [n.id, n]))
}

export function orgChartRoots(nodes: OrgChartNode[]): OrgChartNode[] {
  const ids = new Set(nodes.map((n) => n.id))
  return nodes
    .filter((n) => !n.parentId || !ids.has(n.parentId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function orgChartChildren(nodes: OrgChartNode[], parentId: string): OrgChartNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.nameFull.localeCompare(b.nameFull, 'ru'))
}

export function orgChartParent(
  nodes: OrgChartNode[],
  nodeId: string,
): OrgChartNode | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node?.parentId) return undefined
  return nodes.find((n) => n.id === node.parentId)
}

/** Цепочка «кому подчиняется» снизу вверх (исполнитель → … → ГД). */
export function orgChartReportsToChain(
  nodes: OrgChartNode[],
  nodeId: string,
): OrgChartNode[] {
  const chain: OrgChartNode[] = []
  let cur = nodes.find((n) => n.id === nodeId)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    chain.push(cur)
    seen.add(cur.id)
    cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined
  }
  return chain
}

/** Прямые подчинённые. */
export function orgChartDirectReports(nodes: OrgChartNode[], nodeId: string): OrgChartNode[] {
  return orgChartChildren(nodes, nodeId)
}

export function orgChartWouldCycle(
  nodes: OrgChartNode[],
  nodeId: string,
  newParentId: string | undefined,
): boolean {
  if (!newParentId || nodeId === newParentId) return true
  let cur: string | undefined = newParentId
  const seen = new Set<string>()
  while (cur) {
    if (cur === nodeId) return true
    if (seen.has(cur)) return true
    seen.add(cur)
    cur = nodes.find((n) => n.id === cur)?.parentId
  }
  return false
}

/** Узел, к которому привязан сотрудник (employeeId на узле или совпадение positionId). */
export function orgChartNodeForEmployee(
  store: OrgChartStore,
  employeeId: string,
  positionId?: string,
): OrgChartNode | undefined {
  const byEmp = store.nodes.find((n) => n.employeeId === employeeId && !n.archived)
  if (byEmp) return byEmp
  if (positionId) {
    return store.nodes.find((n) => n.positionId === positionId && !n.archived)
  }
  return undefined
}

/** Имя непосредственного руководителя по схеме (для HR/протоколов). */
export function orgChartManagerLabel(
  store: OrgChartStore,
  nodeId: string,
  mode: 'full' | 'short' = 'full',
): string | undefined {
  const parent = orgChartParent(store.nodes, nodeId)
  if (!parent) return undefined
  return mode === 'short' ? formatOrgShortLabel(parent.nameShort) : parent.nameFull
}
