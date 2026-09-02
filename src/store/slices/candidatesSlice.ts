import { appendAudit } from '@/lib/audit'
import { monthKey } from '@/lib/dates'
import { candidateToEmployee } from '@/lib/hr/candidates'
import { syncMonthRosterFromHrInStore } from '@/lib/monthArchive'
import { syncPlanRow } from '@/lib/monthSheet'
import { trashCandidate } from '@/lib/trash'
import type { Candidate } from '@/lib/types'
import { actorAuditFields } from './actorAuditFields'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createCandidatesSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

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
          ...who(),
        })
        return next
      })
    },

    /**
     * Кандидат → сотрудник: карточка HR, строка табеля в месяце найма,
     * удаление из воронки. Возвращает id сотрудника или null.
     */
    hireCandidate(id: string): string | null {
      let hiredId: string | null = null
      patchStore(setStore, (s) => {
        const candidate = (s.candidates ?? []).find((c) => c.id === id)
        if (!candidate) return s
        const emp = candidateToEmployee(candidate, s.brigades, s.employees)
        hiredId = emp.id
        let next = {
          ...s,
          employees: [...s.employees, emp],
          candidates: (s.candidates ?? []).filter((c) => c.id !== id),
        }
        const now = new Date()
        const hireMonth =
          emp.hireDate?.slice(0, 7) || monthKey(now.getFullYear(), now.getMonth() + 1)
        next = syncMonthRosterFromHrInStore(next, hireMonth)
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
          ...who(),
        })
        return next
      })
      return hiredId
    },
  }
}
