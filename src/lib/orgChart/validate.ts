import { orgChartWouldCycle, orgChartRoots } from './hierarchy'
import { orgChartDescendantIds, orgChartIsRoot } from './subtree'
import type { OrgChartNode, OrgChartNodeDraft } from './types'

export type OrgChartValidateIssue =
  | 'nameFull_required'
  | 'nameShort_required'
  | 'parent_missing'
  | 'self_parent'
  | 'cycle'
  | 'second_root'
  | 'coords_invalid'
  | 'node_missing'
  | 'root_has_children_block'

export type OrgChartValidateResult = { ok: true } | { ok: false; issue: OrgChartValidateIssue }

function stripGuillemets(s: string): string {
  return s.trim().replace(/^[«"]+|[»"]+$/g, '').trim()
}

export function normalizeOrgShortInput(raw: string): string {
  return stripGuillemets(raw)
}

export function validateOrgChartCoords(layoutX: number, layoutY: number): boolean {
  return Number.isFinite(layoutX) && Number.isFinite(layoutY)
}

export function validateOrgChartDraft(
  nodes: OrgChartNode[],
  draft: OrgChartNodeDraft,
  opts?: { allowRootCreate?: boolean },
): OrgChartValidateResult {
  const nameFull = draft.nameFull.trim()
  const nameShort = normalizeOrgShortInput(draft.nameShort)
  if (!nameFull) return { ok: false, issue: 'nameFull_required' }
  if (!nameShort) return { ok: false, issue: 'nameShort_required' }

  if (draft.layoutX != null || draft.layoutY != null) {
    const x = draft.layoutX ?? 0
    const y = draft.layoutY ?? 0
    if (!validateOrgChartCoords(x, y)) return { ok: false, issue: 'coords_invalid' }
  }

  const parentId = draft.parentId || undefined
  if (draft.id && parentId === draft.id) return { ok: false, issue: 'self_parent' }

  if (parentId) {
    if (!nodes.some((n) => n.id === parentId)) return { ok: false, issue: 'parent_missing' }
    if (draft.id && orgChartWouldCycle(nodes, draft.id, parentId)) {
      return { ok: false, issue: 'cycle' }
    }
  } else {
    // Новый корень только в пустой схеме (или правка существующего корня).
    const roots = orgChartRoots(nodes)
    if (!draft.id) {
      if (roots.length > 0 && !opts?.allowRootCreate) {
        return { ok: false, issue: 'second_root' }
      }
    } else if (!orgChartIsRoot(nodes, draft.id) && roots.length > 0) {
      // Снятие родителя у не-корня = второй корень
      return { ok: false, issue: 'second_root' }
    }
  }

  return { ok: true }
}

export function validateOrgChartReparent(
  nodes: OrgChartNode[],
  nodeId: string,
  newParentId: string | undefined,
): OrgChartValidateResult {
  if (!nodes.some((n) => n.id === nodeId)) return { ok: false, issue: 'node_missing' }
  if (newParentId === nodeId) return { ok: false, issue: 'self_parent' }
  if (newParentId) {
    if (!nodes.some((n) => n.id === newParentId)) return { ok: false, issue: 'parent_missing' }
    if (orgChartWouldCycle(nodes, nodeId, newParentId)) return { ok: false, issue: 'cycle' }
    if (orgChartDescendantIds(nodes, nodeId).has(newParentId)) return { ok: false, issue: 'cycle' }
  } else {
    const roots = orgChartRoots(nodes).filter((r) => r.id !== nodeId)
    if (roots.length > 0) return { ok: false, issue: 'second_root' }
  }
  return { ok: true }
}

export type OrgChartRemoveMode = 'node' | 'subtree'

export function validateOrgChartRemove(
  nodes: OrgChartNode[],
  nodeId: string,
  mode: OrgChartRemoveMode,
): OrgChartValidateResult {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { ok: false, issue: 'node_missing' }
  const childCount = nodes.filter((n) => n.parentId === nodeId).length
  if (mode === 'node' && orgChartIsRoot(nodes, nodeId) && childCount > 0) {
    return { ok: false, issue: 'root_has_children_block' }
  }
  return { ok: true }
}
