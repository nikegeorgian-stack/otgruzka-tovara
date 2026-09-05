import { ORG_CHART_NODE_H, ORG_CHART_NODE_W, autoLayoutOrgChart } from './layout'
import {
  orgChartDescendants,
  orgChartSubtreeNodes,
} from './subtree'
import type { OrgChartNode } from './types'
import { validateOrgChartRemove, type OrgChartRemoveMode } from './validate'

export type OrgChartRemoveResult =
  | { ok: true; nodes: OrgChartNode[]; removedIds: string[]; reparentedIds: string[] }
  | { ok: false; issue: string }

/** Удалить узел; детей переподчинить его родителю. */
export function removeOrgChartNodeReparent(
  nodes: OrgChartNode[],
  nodeId: string,
): OrgChartRemoveResult {
  const v = validateOrgChartRemove(nodes, nodeId, 'node')
  if (!v.ok) return { ok: false, issue: v.issue }
  const target = nodes.find((n) => n.id === nodeId)!
  const reparentedIds: string[] = []
  const next = nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => {
      if (n.parentId !== nodeId) return n
      reparentedIds.push(n.id)
      return {
        ...n,
        parentId: target.parentId,
        updatedAt: new Date().toISOString(),
      }
    })
  return { ok: true, nodes: next, removedIds: [nodeId], reparentedIds }
}

/** Удалить узел и всё поддерево. */
export function removeOrgChartSubtree(
  nodes: OrgChartNode[],
  nodeId: string,
): OrgChartRemoveResult {
  const v = validateOrgChartRemove(nodes, nodeId, 'subtree')
  if (!v.ok) return { ok: false, issue: v.issue }
  const removedIds = [nodeId, ...orgChartDescendants(nodes, nodeId).map((n) => n.id)]
  const drop = new Set(removedIds)
  return {
    ok: true,
    nodes: nodes.filter((n) => !drop.has(n.id)),
    removedIds,
    reparentedIds: [],
  }
}

export function applyOrgChartRemove(
  nodes: OrgChartNode[],
  nodeId: string,
  mode: OrgChartRemoveMode,
): OrgChartRemoveResult {
  return mode === 'subtree'
    ? removeOrgChartSubtree(nodes, nodeId)
    : removeOrgChartNodeReparent(nodes, nodeId)
}

export function suggestChildLayout(parent: OrgChartNode, siblingCount: number): {
  layoutX: number
  layoutY: number
} {
  return {
    layoutX: parent.layoutX + siblingCount * (ORG_CHART_NODE_W * 0.35),
    layoutY: parent.layoutY + ORG_CHART_NODE_H + 28,
  }
}

export function suggestSiblingLayout(
  nodes: OrgChartNode[],
  siblingOfId: string,
): { layoutX: number; layoutY: number; parentId: string } | null {
  const ref = nodes.find((n) => n.id === siblingOfId)
  if (!ref?.parentId) return null
  return {
    parentId: ref.parentId,
    layoutX: ref.layoutX + ORG_CHART_NODE_W + 16,
    layoutY: ref.layoutY,
  }
}

/**
 * Авто-раскладка только поддерева; остальные узлы не двигаются.
 * Поддерево кладётся относительно текущей позиции корня ветки.
 */
export function autoLayoutOrgChartBranch(
  nodes: OrgChartNode[],
  rootId: string,
): OrgChartNode[] {
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return nodes
  const sub = orgChartSubtreeNodes(nodes, rootId).map((n) =>
    n.id === rootId ? { ...n, parentId: undefined } : { ...n },
  )
  const laid = autoLayoutOrgChart(sub)
  const laidRoot = laid.find((n) => n.id === rootId)
  if (!laidRoot) return nodes
  const dx = root.layoutX - laidRoot.layoutX
  const dy = root.layoutY - laidRoot.layoutY
  const byId = new Map(
    laid.map((n) => [
      n.id,
      {
        ...n,
        parentId: n.id === rootId ? root.parentId : n.parentId,
        layoutX: n.layoutX + dx,
        layoutY: n.layoutY + dy,
      },
    ]),
  )
  return nodes.map((n) => byId.get(n.id) ?? n)
}

export function setOrgChartEmployee(
  nodes: OrgChartNode[],
  nodeId: string,
  employeeId: string | undefined,
): OrgChartNode[] {
  return nodes.map((n) =>
    n.id === nodeId
      ? { ...n, employeeId, updatedAt: new Date().toISOString() }
      : n,
  )
}

export function setOrgChartHrLink(
  nodes: OrgChartNode[],
  nodeId: string,
  link: { structuralUnitId?: string; positionId?: string },
): OrgChartNode[] {
  return nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          structuralUnitId: link.structuralUnitId,
          positionId: link.positionId,
          updatedAt: new Date().toISOString(),
        }
      : n,
  )
}

export type OrgChartHrLinkStatus = 'linked' | 'partial' | 'none' | 'broken'

export function orgChartHrLinkStatus(
  node: OrgChartNode,
  unitIds: ReadonlySet<string>,
  positionIds: ReadonlySet<string>,
): OrgChartHrLinkStatus {
  const hasU = !!node.structuralUnitId
  const hasP = !!node.positionId
  if (!hasU && !hasP) return 'none'
  const uOk = !hasU || unitIds.has(node.structuralUnitId!)
  const pOk = !hasP || positionIds.has(node.positionId!)
  if (!uOk || !pOk) return 'broken'
  if (hasU && hasP) return 'linked'
  return 'partial'
}
