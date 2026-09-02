import { appendAudit } from '@/lib/audit'
import { canMutateTimesheet } from '@/lib/access/timesheetGuard'
import { isMonthClosed } from '@/lib/monthManage'
import { ensureMonth } from '@/lib/monthSheet'
import { applyNightShiftToStore, revertNightShiftFromStore } from '@/lib/nightShift/apply'
import {
  createDefaultNightShiftStore,
  nextNightShiftNumber,
  normalizeNightShiftDocument,
  normalizeNightShiftStore,
} from '@/lib/nightShift/init'
import type { NightShiftGroupId } from '@/lib/nightShift/types'
import type { AppStore } from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'

export function createNightShiftSlice({ setStore, getActor }: StoreSliceDeps) {
  const actorFields = () => {
    const a = getActor?.() ?? null
    return { by: a?.id, byName: a?.name }
  }

  return {
    upsertNightShiftDraft(input: {
      id?: string
      date: string
      groups: NightShiftGroupId[]
      brigades?: string[]
      employeeIds: string[]
      note?: string
      reasons?: Record<string, string>
    }): string | null {
      let docId: string | null = null
      setStore((s) => {
        const month = input.date.slice(0, 7)
        if (isMonthClosed(s, month)) return s
        if (!canMutateTimesheet(s, getActor?.() ?? null, { month })) return s
        const base = ensureMonth(s, month)
        const ns = normalizeNightShiftStore(base.nightShifts ?? createDefaultNightShiftStore())
        const existing = input.id
          ? ns.documents.find((d) => d.id === input.id)
          : ns.documents.find((d) => d.date === input.date && d.status === 'draft')

        if (existing?.status === 'posted') return base

        const actor = actorFields()
        const now = new Date().toISOString()
        const id = existing?.id ?? crypto.randomUUID()
        docId = id
        const draft = normalizeNightShiftDocument({
          id,
          number: existing?.number ?? nextNightShiftNumber(ns.documents),
          date: input.date,
          status: 'draft',
          groups: input.groups,
          brigades: input.brigades,
          employeeIds: input.employeeIds,
          note: input.note,
          reasons: input.reasons,
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? actor.by,
          createdByName: existing?.createdByName ?? actor.byName,
        })
        if (!draft) return base

        const documents = existing
          ? ns.documents.map((d) => (d.id === id ? draft : d))
          : [...ns.documents, draft]

        const withDocs: AppStore = { ...base, nightShifts: { documents } }
        return appendAudit(withDocs, {
          action: 'night_shift',
          month,
          dateKey: input.date,
          detail: `draft ${draft.number} · ${input.employeeIds.length} чел.`,
          ...actor,
        })
      })
      return docId
    },

    postNightShift(documentId: string): boolean {
      let ok = false
      setStore((s) => {
        const ns = normalizeNightShiftStore(s.nightShifts ?? createDefaultNightShiftStore())
        const doc = ns.documents.find((d) => d.id === documentId)
        if (!doc || doc.status === 'posted' || doc.employeeIds.length === 0) return s
        const month = doc.date.slice(0, 7)
        if (isMonthClosed(s, month)) return s
        if (!canMutateTimesheet(s, getActor?.() ?? null, { month })) return s

        const base = ensureMonth(s, month)
        const appliedResult = applyNightShiftToStore(base, doc)
        if (!appliedResult) return s

        const actor = actorFields()
        const now = new Date().toISOString()
        const posted = {
          ...doc,
          status: 'posted' as const,
          applied: appliedResult.applied,
          postedAt: now,
          postedBy: actor.by,
          postedByName: actor.byName,
          voidedAt: undefined,
          voidedBy: undefined,
          voidedByName: undefined,
        }

        const documents = ns.documents.map((d) => (d.id === documentId ? posted : d))
        const withDocs: AppStore = {
          ...appliedResult.store,
          nightShifts: { documents },
        }
        ok = true
        return appendAudit(withDocs, {
          action: 'night_shift',
          month,
          dateKey: doc.date,
          detail: `post ${posted.number} · ${posted.employeeIds.length} чел. · Н`,
          ...actor,
        })
      })
      return ok
    },

    /** Сохранить черновик и сразу провести. */
    saveAndPostNightShift(input: {
      id?: string
      date: string
      groups: NightShiftGroupId[]
      brigades?: string[]
      employeeIds: string[]
      note?: string
      reasons?: Record<string, string>
    }): boolean {
      let ok = false
      setStore((s) => {
        const month = input.date.slice(0, 7)
        if (isMonthClosed(s, month)) return s
        if (!canMutateTimesheet(s, getActor?.() ?? null, { month })) return s
        if (input.employeeIds.length === 0) return s

        const base = ensureMonth(s, month)
        const ns = normalizeNightShiftStore(base.nightShifts ?? createDefaultNightShiftStore())
        const existing = input.id
          ? ns.documents.find((d) => d.id === input.id)
          : ns.documents.find(
              (d) =>
                d.date === input.date && (d.status === 'draft' || d.status === 'posted'),
            )

        let working: AppStore = base
        let docs = ns.documents
        if (existing?.status === 'posted') {
          const reverted = revertNightShiftFromStore(working, existing)
          if (reverted) working = reverted
        }

        const actor = actorFields()
        const now = new Date().toISOString()
        const id = existing?.id ?? crypto.randomUUID()
        const draft = normalizeNightShiftDocument({
          id,
          number: existing?.number ?? nextNightShiftNumber(docs),
          date: input.date,
          status: 'draft',
          groups: input.groups,
          brigades: input.brigades,
          employeeIds: input.employeeIds,
          note: input.note,
          reasons: input.reasons,
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? actor.by,
          createdByName: existing?.createdByName ?? actor.byName,
        })
        if (!draft) return s

        docs = existing
          ? docs.map((d) => (d.id === id ? draft : d))
          : [...docs, draft]
        working = { ...working, nightShifts: { documents: docs } }

        const appliedResult = applyNightShiftToStore(working, draft)
        if (!appliedResult) return s

        const posted = {
          ...draft,
          status: 'posted' as const,
          applied: appliedResult.applied,
          postedAt: now,
          postedBy: actor.by,
          postedByName: actor.byName,
        }
        const documents = docs.map((d) => (d.id === id ? posted : d))
        const withDocs: AppStore = {
          ...appliedResult.store,
          nightShifts: { documents },
        }
        ok = true
        return appendAudit(withDocs, {
          action: 'night_shift',
          month,
          dateKey: input.date,
          detail: `post ${posted.number} · ${posted.employeeIds.length} чел. · Н`,
          ...actor,
        })
      })
      return ok
    },

    voidNightShift(documentId: string): boolean {
      let ok = false
      setStore((s) => {
        const ns = normalizeNightShiftStore(s.nightShifts ?? createDefaultNightShiftStore())
        const doc = ns.documents.find((d) => d.id === documentId)
        if (!doc || doc.status !== 'posted') return s
        const month = doc.date.slice(0, 7)
        if (isMonthClosed(s, month)) return s
        if (!canMutateTimesheet(s, getActor?.() ?? null, { month })) return s

        const reverted = revertNightShiftFromStore(s, doc)
        if (!reverted) return s
        const actor = actorFields()
        const now = new Date().toISOString()
        const voided = {
          ...doc,
          status: 'void' as const,
          voidedAt: now,
          voidedBy: actor.by,
          voidedByName: actor.byName,
        }
        const documents = ns.documents.map((d) => (d.id === documentId ? voided : d))
        const withDocs: AppStore = { ...reverted, nightShifts: { documents } }
        ok = true
        return appendAudit(withDocs, {
          action: 'night_shift',
          month,
          dateKey: doc.date,
          detail: `void ${doc.number}`,
          ...actor,
        })
      })
      return ok
    },
  }
}
