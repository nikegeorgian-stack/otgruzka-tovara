import { appendAudit } from '@/lib/audit'
import { candidateToEmployee } from '@/lib/hr/candidates'
import { syncPlanRow } from '@/lib/monthSheet'
import { trashCandidate } from '@/lib/trash'
import type { Candidate } from '@/lib/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createCandidatesSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertCandidate(candidate: Candidate) {
      patchStore(setStore, (s) => {
        const list = s.candidates ?? []
        const exists = list.some((c) => c.id === candidate.id)
        const next = { ...candidate, updatedAt: new Date().toISOString() }
        return {
          ...s,
          candidates: exists
            ? list.map((c) => (c.id === candidate.id ? next : c))
            : [...list, next],
        }
      })
    },

    removeCandidate(id: string) {
      patchStore(setStore, (s) => {
        let next = trashCandidate(s, id)
        next = appendAudit(next, {
          action: 'candidate_remove',
          detail: `candidate ${id}`,
        })
        return next
      })
    },

    /**
     * Превращает кандидата в сотрудника: создаёт Employee, синхронизирует
     * строки табеля и убирает кандидата из воронки.
     */
    hireCandidate(id: string) {
      patchStore(setStore, (s) => {
        const candidate = (s.candidates ?? []).find((c) => c.id === id)
        if (!candidate) return s
        const emp = candidateToEmployee(candidate, s.brigades, s.employees)
        let next = {
          ...s,
          employees: [...s.employees, emp],
          candidates: (s.candidates ?? []).filter((c) => c.id !== id),
        }
        for (const [key, sheet] of Object.entries(next.months)) {
          let updated = sheet
          for (const row of sheet.rows) {
            if (row.employeeId === emp.id) updated = syncPlanRow(updated, row.id, emp)
          }
          next = { ...next, months: { ...next.months, [key]: updated } }
        }
        next = appendAudit(next, {
          action: 'candidate_hire',
          employeeId: emp.id,
          detail: `candidate ${id} → employee ${emp.id}`,
        })
        return next
      })
    },
  }
}
