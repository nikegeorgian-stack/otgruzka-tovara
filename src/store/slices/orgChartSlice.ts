import { appendAudit } from '@/lib/audit'
import {
  createDefaultOrgChartStore,
  normalizeOrgChartStore,
} from '@/lib/orgChart/init'
import { autoLayoutOrgChart } from '@/lib/orgChart/layout'
import {
  applyOrgChartRemove,
  autoLayoutOrgChartBranch,
  setOrgChartEmployee,
  setOrgChartHrLink,
  suggestChildLayout,
} from '@/lib/orgChart/ops'
import type { OrgChartDisplayMode, OrgChartNode, OrgChartNodeDraft } from '@/lib/orgChart/types'
import type { OrgChartRemoveMode } from '@/lib/orgChart/validate'
import {
  normalizeOrgShortInput,
  validateOrgChartDraft,
  validateOrgChartReparent,
} from '@/lib/orgChart/validate'
import type { AppStore } from '@/lib/types'
import { actorAuditFields } from './actorAuditFields'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { patchStore, type StoreSliceDeps } from '../storeApi'

function patchField<T>(
  next: T | null | undefined,
  prev: T | undefined,
): T | undefined {
  if (next === null) return undefined
  if (next === undefined) return prev
  return next
}

export function createOrgChartSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  const patchOrg = (fn: (s: AppStore, org: ReturnType<typeof normalizeOrgChartStore>) => AppStore) => {
    patchStore(setStore, (s) => {
      const org = normalizeOrgChartStore(s.orgChart ?? createDefaultOrgChartStore())
      return fn(s, org)
    })
  }

  const removeOrgChartNode = (id: string, mode: OrgChartRemoveMode = 'node'): boolean => {
    let ok = false
    patchOrg((s, org) => {
      const existing = org.nodes.find((n) => n.id === id)
      if (!existing) return s
      const result = applyOrgChartRemove(org.nodes, id, mode)
      if (!result.ok) return s
      ok = true
      const actor = who()
      recordSliceExplicitDelete('orgChart.nodes', id, actorFromGetter(getActor))
      let next: AppStore = {
        ...s,
        orgChart: { ...org, nodes: result.nodes },
      }
      next = appendAudit(next, {
        action: mode === 'subtree' ? 'org_chart_subtree_removed' : 'org_chart_node_removed',
        detail: `${existing.nameShort} · ${existing.nameFull} (узлов: ${result.removedIds.length}${
          result.reparentedIds.length ? `, переподчинено: ${result.reparentedIds.length}` : ''
        })`,
        ...actor,
      })
      return next
    })
    return ok
  }

  return {
    setOrgChartDisplayMode(mode: OrgChartDisplayMode): void {
      patchOrg((s, org) => ({
        ...s,
        orgChart: { ...org, displayMode: mode },
      }))
    },

    upsertOrgChartNode(draft: OrgChartNodeDraft): string {
      let id = draft.id ?? ''
      patchOrg((s, org) => {
        const now = new Date().toISOString()
        const actor = who()
        const nameFull = draft.nameFull.trim()
        const nameShort = normalizeOrgShortInput(draft.nameShort)
        const check = validateOrgChartDraft(org.nodes, {
          ...draft,
          nameFull,
          nameShort,
        })
        if (!check.ok) return s

        if (draft.id) {
          const existing = org.nodes.find((n) => n.id === draft.id)
          if (!existing) return s
          id = existing.id
          const parentId =
            draft.parentId === undefined ? existing.parentId : draft.parentId || undefined
          const reparentCheck = validateOrgChartReparent(org.nodes, id, parentId)
          if (!reparentCheck.ok) return s
          const row: OrgChartNode = {
            ...existing,
            parentId,
            nameFull,
            nameShort,
            sortOrder: draft.sortOrder ?? existing.sortOrder,
            layoutX: draft.layoutX ?? existing.layoutX,
            layoutY: draft.layoutY ?? existing.layoutY,
            structuralUnitId: patchField(draft.structuralUnitId, existing.structuralUnitId),
            positionId: patchField(draft.positionId, existing.positionId),
            employeeId: patchField(draft.employeeId, existing.employeeId),
            updatedAt: now,
          }
          let next: AppStore = {
            ...s,
            orgChart: {
              ...org,
              nodes: org.nodes.map((n) => (n.id === id ? row : n)),
            },
          }
          next = appendAudit(next, {
            action: 'org_chart_node_updated',
            detail: `${row.nameShort} · ${row.nameFull}`,
            oldValue: existing.nameFull,
            newValue: row.nameFull,
            ...actor,
          })
          return next
        }

        id = crypto.randomUUID()
        const siblings = org.nodes.filter((n) => n.parentId === draft.parentId)
        let layoutX = draft.layoutX
        let layoutY = draft.layoutY
        if (layoutX == null || layoutY == null) {
          const parent = draft.parentId
            ? org.nodes.find((n) => n.id === draft.parentId)
            : undefined
          if (parent) {
            const sug = suggestChildLayout(parent, siblings.length)
            layoutX = sug.layoutX
            layoutY = sug.layoutY
          } else {
            layoutX = 80
            layoutY = 80
          }
        }
        const row: OrgChartNode = {
          id,
          parentId: draft.parentId || undefined,
          nameFull,
          nameShort,
          sortOrder: draft.sortOrder ?? siblings.length,
          layoutX,
          layoutY,
          structuralUnitId: draft.structuralUnitId || undefined,
          positionId: draft.positionId || undefined,
          employeeId: draft.employeeId || undefined,
          updatedAt: now,
        }
        let next: AppStore = {
          ...s,
          orgChart: { ...org, nodes: [...org.nodes, row] },
        }
        next = appendAudit(next, {
          action: 'org_chart_node_created',
          detail: `+ ${row.nameShort} · ${row.nameFull}`,
          ...actor,
        })
        return next
      })
      return id
    },

    moveOrgChartNode(id: string, layoutX: number, layoutY: number): boolean {
      let ok = false
      if (!Number.isFinite(layoutX) || !Number.isFinite(layoutY)) return false
      patchOrg((s, org) => {
        const existing = org.nodes.find((n) => n.id === id)
        if (!existing) return s
        ok = true
        const actor = who()
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: org.nodes.map((n) =>
              n.id === id
                ? { ...n, layoutX, layoutY, updatedAt: new Date().toISOString() }
                : n,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_layout_changed',
          detail: `${existing.nameShort}: позиция`,
          ...actor,
        })
        return next
      })
      return ok
    },

    reparentOrgChartNode(id: string, parentId: string | undefined): boolean {
      let ok = false
      patchOrg((s, org) => {
        const existing = org.nodes.find((n) => n.id === id)
        if (!existing) return s
        const check = validateOrgChartReparent(org.nodes, id, parentId)
        if (!check.ok) return s
        ok = true
        const actor = who()
        const prevParent = existing.parentId
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: org.nodes.map((n) =>
              n.id === id
                ? { ...n, parentId, updatedAt: new Date().toISOString() }
                : n,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_node_reparented',
          detail: `${existing.nameShort}: ${prevParent ?? '—'} → ${parentId ?? '—'}`,
          oldValue: prevParent,
          newValue: parentId,
          ...actor,
        })
        return next
      })
      return ok
    },

    archiveOrgChartNode(id: string): boolean {
      return removeOrgChartNode(id, 'node')
    },

    removeOrgChartNode,

    assignOrgChartEmployee(nodeId: string, employeeId: string): boolean {
      let ok = false
      patchOrg((s, org) => {
        const existing = org.nodes.find((n) => n.id === nodeId)
        if (!existing) return s
        ok = true
        const actor = who()
        const prev = existing.employeeId
        const action =
          prev && prev !== employeeId
            ? 'org_chart_employee_replaced'
            : 'org_chart_employee_assigned'
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: setOrgChartEmployee(org.nodes, nodeId, employeeId),
          },
        }
        next = appendAudit(next, {
          action,
          detail: `${existing.nameShort}: сотрудник`,
          oldValue: prev,
          newValue: employeeId,
          ...actor,
        })
        return next
      })
      return ok
    },

    unassignOrgChartEmployee(nodeId: string): boolean {
      let ok = false
      patchOrg((s, org) => {
        const existing = org.nodes.find((n) => n.id === nodeId)
        if (!existing?.employeeId) return s
        ok = true
        const actor = who()
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: setOrgChartEmployee(org.nodes, nodeId, undefined),
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_employee_unassigned',
          detail: `${existing.nameShort}: вакантно`,
          oldValue: existing.employeeId,
          ...actor,
        })
        return next
      })
      return ok
    },

    setOrgChartHrLink(
      nodeId: string,
      link: { structuralUnitId?: string; positionId?: string },
    ): boolean {
      let ok = false
      patchOrg((s, org) => {
        const existing = org.nodes.find((n) => n.id === nodeId)
        if (!existing) return s
        ok = true
        const actor = who()
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: setOrgChartHrLink(org.nodes, nodeId, {
              structuralUnitId: link.structuralUnitId || undefined,
              positionId: link.positionId || undefined,
            }),
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_hr_link_changed',
          detail: `${existing.nameShort}: HR ${link.structuralUnitId ?? '—'} / ${link.positionId ?? '—'}`,
          oldValue: `${existing.structuralUnitId ?? ''}|${existing.positionId ?? ''}`,
          newValue: `${link.structuralUnitId ?? ''}|${link.positionId ?? ''}`,
          ...actor,
        })
        return next
      })
      return ok
    },

    autoLayoutOrgChart(): void {
      patchOrg((s, org) => {
        const actor = who()
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: autoLayoutOrgChart(org.nodes),
            layoutVersion: 3,
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_auto_layout_applied',
          detail: 'Авто-раскладка всей схемы',
          ...actor,
        })
        return next
      })
    },

    autoLayoutOrgChartBranch(rootId: string): void {
      patchOrg((s, org) => {
        if (!org.nodes.some((n) => n.id === rootId)) return s
        const actor = who()
        const node = org.nodes.find((n) => n.id === rootId)!
        let next: AppStore = {
          ...s,
          orgChart: {
            ...org,
            nodes: autoLayoutOrgChartBranch(org.nodes, rootId),
          },
        }
        next = appendAudit(next, {
          action: 'org_chart_auto_layout_applied',
          detail: `Авто-раскладка ветки ${node.nameShort}`,
          ...actor,
        })
        return next
      })
    },
  }
}
