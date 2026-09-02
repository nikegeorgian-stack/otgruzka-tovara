import { orgChartChildren, orgChartParent, orgChartRoots } from './hierarchy'
import type { OrgChartNode } from './types'

/** Все потомки (без самого узла), BFS. */
export function orgChartDescendants(nodes: OrgChartNode[], nodeId: string): OrgChartNode[] {
  const out: OrgChartNode[] = []
  const queue = [...orgChartChildren(nodes, nodeId)]
  const seen = new Set<string>()
  while (queue.length) {
    const n = queue.shift()!
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
    queue.push(...orgChartChildren(nodes, n.id))
  }
  return out
}

export function orgChartDescendantIds(nodes: OrgChartNode[], nodeId: string): Set<string> {
  return new Set(orgChartDescendants(nodes, nodeId).map((n) => n.id))
}

export function orgChartCountDescendants(nodes: OrgChartNode[], nodeId: string): number {
  return orgChartDescendants(nodes, nodeId).length
}

/** Предки без самого узла: immediate parent → … → root. */
export function orgChartAncestors(nodes: OrgChartNode[], nodeId: string): OrgChartNode[] {
  const out: OrgChartNode[] = []
  let cur = orgChartParent(nodes, nodeId)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur)
    cur = orgChartParent(nodes, cur.id)
  }
  return out
}

/** Узел + предки + потомки (для «только ветка»). */
export function orgChartBranchIds(nodes: OrgChartNode[], nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId])
  for (const a of orgChartAncestors(nodes, nodeId)) ids.add(a.id)
  for (const d of orgChartDescendants(nodes, nodeId)) ids.add(d.id)
  return ids
}

/** Поддерево: узел + все потомки. */
export function orgChartSubtreeNodes(nodes: OrgChartNode[], rootId: string): OrgChartNode[] {
  const ids = new Set([rootId, ...orgChartDescendantIds(nodes, rootId)])
  return nodes.filter((n) => ids.has(n.id))
}

export function orgChartIsRoot(nodes: OrgChartNode[], nodeId: string): boolean {
  return orgChartRoots(nodes).some((r) => r.id === nodeId)
}

/**
 * Скрытые из‑за свёрнутых узлов: потомок свёрнутого предка (не включая сам свёрнутый).
 */
export function orgChartHiddenByCollapse(
  nodes: OrgChartNode[],
  collapsedIds: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>()
  if (!collapsedIds.size) return hidden
  for (const id of collapsedIds) {
    for (const d of orgChartDescendants(nodes, id)) hidden.add(d.id)
  }
  return hidden
}
