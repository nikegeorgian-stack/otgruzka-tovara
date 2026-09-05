import { appendAudit } from '@/lib/audit'
import {
  advanceAccrualById,
  nextAdvanceAccrualNumber,
  normalizeAccrualLines,
} from '@/lib/finance/advanceAccrual'
import {
  advanceDocumentById,
  buildAdvancesFromDocument,
  nextAdvanceDocumentNumber,
  normalizeAdvanceDocumentLines,
} from '@/lib/finance/advanceDocuments'
import {
  buildPayoutsFromDocument,
  nextPayoutDocumentNumber,
  normalizePayoutDocumentLines,
  payoutDocumentById,
} from '@/lib/finance/payoutDocuments'
import { getFinance } from '@/lib/finance/calc'
import { canHandoffExport } from '@/lib/finance/disbursementDocStatus'
import { createDefaultFinanceStore } from '@/lib/finance/init'
import type {
  FinanceAdjustment,
  FinanceAdjustmentKind,
  FinanceAdvanceAccrualDocument,
  FinanceAdvanceDocument,
  FinancePayoutDocument,
  FinancePaymentMethod,
  FinancePayout,
  FinanceStore,
  SickConfirmation,
  VacationConfirmation,
} from '@/lib/finance/types'
import { isMonthClosed } from '@/lib/monthManage'
import type { AppStore } from '@/lib/types'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import type { StoreSliceDeps } from '../storeApi'

export type Actor = { id?: string; name?: string }

export type GiveAdvanceInput = {
  employeeId: string
  month: string
  date: string
  amount: number
  method: FinancePaymentMethod
  note?: string
}

export type SaveAdvanceDocumentInput = {
  id: string
  month: string
  date: string
  method: FinancePaymentMethod
  lines: { id?: string; employeeId: string; amount: number; note?: string }[]
  purpose?: string
}

export type SavePayoutDocumentInput = SaveAdvanceDocumentInput

export type SaveAdvanceAccrualInput = {
  id: string
  month: string
  lines: {
    id?: string
    employeeId: string
    amount: number
    mode?: 'percent' | 'fixed'
    percent?: number
    salaryBase?: number
    note?: string
  }[]
  purpose?: string
}

export type AddAdjustmentInput = {
  employeeId: string
  month: string
  date: string
  kind: FinanceAdjustmentKind
  amount: number
  reason: string
}

export type AddPayoutInput = {
  employeeId: string
  month: string
  date: string
  amount: number
  method: FinancePaymentMethod
  note?: string
}

export type ConfirmSickInput = {
  employeeId: string
  month: string
  fileUrl?: string
  fileName?: string
  note?: string
}

export type ConfirmVacationInput = ConfirmSickInput

function empName(s: AppStore, id: string): string {
  return s.employees.find((e) => e.id === id)?.fullName ?? id.slice(0, 8)
}

function ensureAdvanceDocuments(fin: FinanceStore): FinanceAdvanceDocument[] {
  return fin.advanceDocuments ?? []
}

function ensurePayoutDocuments(fin: FinanceStore): FinancePayoutDocument[] {
  return fin.payoutDocuments ?? []
}

function ensureAdvanceAccruals(fin: FinanceStore): FinanceAdvanceAccrualDocument[] {
  return fin.advanceAccruals ?? []
}

function postDocumentInternal(
  fin: FinanceStore,
  doc: FinanceAdvanceDocument,
  actor?: Actor,
): { finance: FinanceStore; audit: Parameters<typeof appendAudit>[1] } {
  const advances = buildAdvancesFromDocument(doc, actor)
  const paid: FinanceAdvanceDocument = {
    ...doc,
    status: 'paid',
    postedAt: new Date().toISOString(),
    byId: actor?.id ?? doc.byId,
    byName: actor?.name ?? doc.byName,
  }
  const docs = ensureAdvanceDocuments(fin).map((d) => (d.id === doc.id ? paid : d))
  return {
    finance: { ...fin, advanceDocuments: docs, advances: [...fin.advances, ...advances] },
    audit: {
      action: 'advance_document_post',
      month: doc.month,
      by: actor?.id,
      byName: actor?.name,
      detail: `${doc.number} · выплачено · ${doc.lines.length} чел. · ${advances.reduce((sum, a) => sum + a.amount, 0)} ₾${actor?.name ? ` · ${actor.name}` : ''}`,
    },
  }
}

function postPayoutDocumentInternal(
  fin: FinanceStore,
  doc: FinancePayoutDocument,
  actor?: Actor,
): { finance: FinanceStore; audit: Parameters<typeof appendAudit>[1] } {
  const payouts = buildPayoutsFromDocument(doc, actor)
  const paid: FinancePayoutDocument = {
    ...doc,
    status: 'paid',
    postedAt: new Date().toISOString(),
    byId: actor?.id ?? doc.byId,
    byName: actor?.name ?? doc.byName,
  }
  const docs = ensurePayoutDocuments(fin).map((d) => (d.id === doc.id ? paid : d))
  return {
    finance: { ...fin, payoutDocuments: docs, payouts: [...fin.payouts, ...payouts] },
    audit: {
      action: 'payout_document_post',
      month: doc.month,
      by: actor?.id,
      byName: actor?.name,
      detail: `${doc.number} · выплачено · ${doc.lines.length} чел. · ${payouts.reduce((sum, p) => sum + p.amount, 0)} ₾${actor?.name ? ` · ${actor.name}` : ''}`,
    },
  }
}

export function createFinanceSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const finActor = (actor?: Actor) =>
    actor?.id || actor?.name
      ? { actorId: actor.id, actorName: actor.name }
      : actorFromGetter(getActor)

  function patchFinance(
    fn: (
      fin: FinanceStore,
      s: AppStore,
    ) => { finance: FinanceStore; audit?: Parameters<typeof appendAudit>[1] },
    explicitActor?: Actor,
  ) {
    setStore((s) => {
      const fin = getFinance(s)
      const { finance, audit } = fn(fin, s)
      const fallback = getActor?.()
      const actor =
        explicitActor ??
        (fallback ? { id: fallback.id, name: fallback.name } : undefined)
      let next: AppStore = { ...s, finance }
      if (audit) {
        next = appendAudit(next, {
          ...audit,
          by: audit.by ?? actor?.id,
          byName: audit.byName ?? actor?.name,
        })
      }
      return next
    })
  }

  return {
    saveAdvanceDocumentDraft(input: SaveAdvanceDocumentInput, actor?: Actor) {
      patchFinance((fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const lines = normalizeAdvanceDocumentLines(input.lines)
        if (!lines.length) return { finance: fin }

        const docs = ensureAdvanceDocuments(fin)
        const existing = advanceDocumentById(fin, input.id)
        if (existing && existing.status !== 'draft') return { finance: fin }

        const doc: FinanceAdvanceDocument = existing
          ? {
              ...existing,
              month: input.month,
              date: input.date,
              method: input.method,
              lines,
              purpose: input.purpose?.trim() || undefined,
            }
          : {
              id: input.id,
              number: nextAdvanceDocumentNumber(fin, input.month),
              month: input.month,
              date: input.date,
              method: input.method,
              status: 'draft',
              lines,
              purpose: input.purpose?.trim() || undefined,
              byId: actor?.id,
              byName: actor?.name,
              at: new Date().toISOString(),
            }

        const nextDocs = existing
          ? docs.map((d) => (d.id === doc.id ? doc : d))
          : [...docs, doc]

        return {
          finance: { ...fin, advanceDocuments: nextDocs },
          audit: {
            action: 'advance_document_save',
            month: input.month,
            detail: `${doc.number} · черновик · ${lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    postAdvanceDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceDocumentById(fin, id)
        if (!doc || doc.status !== 'ready' || !doc.lines.length) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        return postDocumentInternal(fin, doc, actor)
      })
    },

    prepareAdvanceDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceDocumentById(fin, id)
        if (!doc || doc.status !== 'draft' || !doc.lines.length) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const ready: FinanceAdvanceDocument = {
          ...doc,
          status: 'ready',
          readyAt: new Date().toISOString(),
          byId: actor?.id ?? doc.byId,
          byName: actor?.name ?? doc.byName,
        }
        return {
          finance: {
            ...fin,
            advanceDocuments: ensureAdvanceDocuments(fin).map((d) =>
              d.id === id ? ready : d,
            ),
          },
          audit: {
            action: 'advance_document_save',
            month: doc.month,
            detail: `${doc.number} · к выплате · ${doc.lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    unprepareAdvanceDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceDocumentById(fin, id)
        if (!doc || doc.status !== 'ready') return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const draft: FinanceAdvanceDocument = {
          ...doc,
          status: 'draft',
          readyAt: undefined,
          byId: actor?.id ?? doc.byId,
          byName: actor?.name ?? doc.byName,
        }
        return {
          finance: {
            ...fin,
            advanceDocuments: ensureAdvanceDocuments(fin).map((d) =>
              d.id === id ? draft : d,
            ),
          },
          audit: {
            action: 'advance_document_save',
            month: doc.month,
            detail: `${doc.number} · возврат в черновик${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    voidAdvanceDocument(id: string, reason?: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceDocumentById(fin, id)
        if (!doc || (doc.status !== 'paid' && doc.status !== 'ready')) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }

        const voided: FinanceAdvanceDocument = {
          ...doc,
          status: 'void',
          voidedAt: new Date().toISOString(),
          voidReason: reason?.trim() || undefined,
        }
        const docs = ensureAdvanceDocuments(fin).map((d) => (d.id === id ? voided : d))
        return {
          finance: {
            ...fin,
            advanceDocuments: docs,
            advances:
              doc.status === 'paid'
                ? fin.advances.filter((a) => a.documentId !== id)
                : fin.advances,
          },
          audit: {
            action: 'advance_document_void',
            month: doc.month,
            detail: `${doc.number} аннулирован${reason ? ` · ${reason}` : ''}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    deleteAdvanceDocumentDraft(id: string, actor?: Actor) {
      const fin = getFinance(getStore())
      const doc = advanceDocumentById(fin, id)
      if (!doc || doc.status !== 'draft') return
      recordSliceExplicitDelete('finance.advanceDocuments', id, finActor(actor))
      patchFinance( (fin) => {
        const doc = advanceDocumentById(fin, id)
        if (!doc || doc.status !== 'draft') return { finance: fin }
        return {
          finance: {
            ...fin,
            advanceDocuments: ensureAdvanceDocuments(fin).filter((d) => d.id !== id),
          },
          audit: {
            action: 'advance_document_void',
            month: doc.month,
            detail: `Удалён черновик ${doc.number}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    savePayoutDocumentDraft(input: SavePayoutDocumentInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const lines = normalizePayoutDocumentLines(input.lines)
        if (!lines.length) return { finance: fin }

        const docs = ensurePayoutDocuments(fin)
        const existing = payoutDocumentById(fin, input.id)
        if (existing && existing.status !== 'draft') return { finance: fin }

        const doc: FinancePayoutDocument = existing
          ? {
              ...existing,
              month: input.month,
              date: input.date,
              method: input.method,
              lines,
              purpose: input.purpose?.trim() || undefined,
            }
          : {
              id: input.id,
              number: nextPayoutDocumentNumber(fin, input.month),
              month: input.month,
              date: input.date,
              method: input.method,
              status: 'draft',
              lines,
              purpose: input.purpose?.trim() || undefined,
              byId: actor?.id,
              byName: actor?.name,
              at: new Date().toISOString(),
            }

        const nextDocs = existing
          ? docs.map((d) => (d.id === doc.id ? doc : d))
          : [...docs, doc]

        return {
          finance: { ...fin, payoutDocuments: nextDocs },
          audit: {
            action: 'payout_document_save',
            month: input.month,
            detail: `${doc.number} · черновик · ${lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    postPayoutDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = payoutDocumentById(fin, id)
        if (!doc || doc.status !== 'ready' || !doc.lines.length) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        return postPayoutDocumentInternal(fin, doc, actor)
      })
    },

    preparePayoutDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = payoutDocumentById(fin, id)
        if (!doc || doc.status !== 'draft' || !doc.lines.length) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const ready: FinancePayoutDocument = {
          ...doc,
          status: 'ready',
          readyAt: new Date().toISOString(),
          byId: actor?.id ?? doc.byId,
          byName: actor?.name ?? doc.byName,
        }
        return {
          finance: {
            ...fin,
            payoutDocuments: ensurePayoutDocuments(fin).map((d) => (d.id === id ? ready : d)),
          },
          audit: {
            action: 'payout_document_save',
            month: doc.month,
            detail: `${doc.number} · к выплате · ${doc.lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    unpreparePayoutDocument(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = payoutDocumentById(fin, id)
        if (!doc || doc.status !== 'ready') return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const draft: FinancePayoutDocument = {
          ...doc,
          status: 'draft',
          readyAt: undefined,
          byId: actor?.id ?? doc.byId,
          byName: actor?.name ?? doc.byName,
        }
        return {
          finance: {
            ...fin,
            payoutDocuments: ensurePayoutDocuments(fin).map((d) => (d.id === id ? draft : d)),
          },
          audit: {
            action: 'payout_document_save',
            month: doc.month,
            detail: `${doc.number} · возврат в черновик${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    voidPayoutDocument(id: string, reason?: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = payoutDocumentById(fin, id)
        if (!doc || (doc.status !== 'paid' && doc.status !== 'ready')) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }

        const voided: FinancePayoutDocument = {
          ...doc,
          status: 'void',
          voidedAt: new Date().toISOString(),
          voidReason: reason?.trim() || undefined,
        }
        const docs = ensurePayoutDocuments(fin).map((d) => (d.id === id ? voided : d))
        return {
          finance: {
            ...fin,
            payoutDocuments: docs,
            payouts:
              doc.status === 'paid'
                ? fin.payouts.filter((p) => p.documentId !== id)
                : fin.payouts,
          },
          audit: {
            action: 'payout_document_void',
            month: doc.month,
            detail: `${doc.number} аннулирован${reason ? ` · ${reason}` : ''}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    deletePayoutDocumentDraft(id: string, actor?: Actor) {
      const fin = getFinance(getStore())
      const doc = payoutDocumentById(fin, id)
      if (!doc || doc.status !== 'draft') return
      recordSliceExplicitDelete('finance.payoutDocuments', id, finActor(actor))
      patchFinance( (fin) => {
        const doc = payoutDocumentById(fin, id)
        if (!doc || doc.status !== 'draft') return { finance: fin }
        return {
          finance: {
            ...fin,
            payoutDocuments: ensurePayoutDocuments(fin).filter((d) => d.id !== id),
          },
          audit: {
            action: 'payout_document_void',
            month: doc.month,
            detail: `Удалён черновик ${doc.number}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    giveAdvance(input: GiveAdvanceInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const lineId = crypto.randomUUID()
        const doc: FinanceAdvanceDocument = {
          id: crypto.randomUUID(),
          number: nextAdvanceDocumentNumber(fin, input.month),
          month: input.month,
          date: input.date,
          method: input.method,
          status: 'draft',
          lines: [
            {
              id: lineId,
              employeeId: input.employeeId,
              amount: Math.round(input.amount),
              note: input.note,
            },
          ],
          byId: actor?.id,
          byName: actor?.name,
          at: new Date().toISOString(),
        }
        const docs = [...ensureAdvanceDocuments(fin), doc]
        const finWithDoc = { ...fin, advanceDocuments: docs }
        const { finance, audit } = postDocumentInternal(finWithDoc, doc, actor)
        return {
          finance,
          audit: {
            ...audit,
            action: 'advance_give',
            month: input.month,
            employeeId: input.employeeId,
            detail: `Аванс ${doc.lines[0].amount} ₾ · ${empName(s, input.employeeId)} · ${doc.number}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    removeAdvance(id: string, actor?: Actor) {
      const s = getStore()
      const fin = getFinance(s)
      const adv = fin.advances.find((a) => a.id === id)
      if (!adv) return
      if (isMonthClosed(s, adv.month)) return
      if (adv.documentId) {
        const doc = advanceDocumentById(fin, adv.documentId)
        if (doc?.status === 'paid') return
      }
      recordSliceExplicitDelete('finance.advances', id, finActor(actor))
      patchFinance( (fin, s) => {
        const adv = fin.advances.find((a) => a.id === id)
        if (!adv) return { finance: fin }
        if (isMonthClosed(s, adv.month)) return { finance: fin }
        if (adv.documentId) {
          const doc = advanceDocumentById(fin, adv.documentId)
          if (doc?.status === 'paid') return { finance: fin }
        }
        return {
          finance: { ...fin, advances: fin.advances.filter((a) => a.id !== id) },
          audit: {
            action: 'advance_remove',
            month: adv.month,
            employeeId: adv.employeeId,
            detail: `Удалён аванс ${adv.amount} ₾ · ${empName(s, adv.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    addAdjustment(input: AddAdjustmentInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const adj: FinanceAdjustment = {
          id: crypto.randomUUID(),
          employeeId: input.employeeId,
          month: input.month,
          date: input.date,
          kind: input.kind,
          amount: Math.round(Math.abs(input.amount)),
          reason: input.reason,
          byId: actor?.id,
          byName: actor?.name,
          at: new Date().toISOString(),
        }
        return {
          finance: { ...fin, adjustments: [...fin.adjustments, adj] },
          audit: {
            action: 'adjustment_add',
            month: input.month,
            employeeId: input.employeeId,
            detail: `${adj.kind === 'bonus' ? 'Премия' : 'Штраф'} ${adj.amount} ₾ · ${empName(s, input.employeeId)} · ${adj.reason}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    removeAdjustment(id: string, actor?: Actor) {
      const s = getStore()
      const fin = getFinance(s)
      const adj = fin.adjustments.find((a) => a.id === id)
      if (!adj) return
      if (isMonthClosed(s, adj.month)) return
      recordSliceExplicitDelete('finance.adjustments', id, finActor(actor))
      patchFinance( (fin, s) => {
        const adj = fin.adjustments.find((a) => a.id === id)
        if (!adj) return { finance: fin }
        if (isMonthClosed(s, adj.month)) return { finance: fin }
        return {
          finance: { ...fin, adjustments: fin.adjustments.filter((a) => a.id !== id) },
          audit: {
            action: 'adjustment_remove',
            month: adj.month,
            employeeId: adj.employeeId,
            detail: `Удалён ${adj.kind === 'bonus' ? 'премия' : 'штраф'} ${adj.amount} ₾ · ${empName(s, adj.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    addPayout(input: AddPayoutInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        const payout: FinancePayout = {
          id: crypto.randomUUID(),
          employeeId: input.employeeId,
          month: input.month,
          date: input.date,
          amount: Math.round(input.amount),
          method: input.method,
          note: input.note,
          byId: actor?.id,
          byName: actor?.name,
          at: new Date().toISOString(),
        }
        return {
          finance: { ...fin, payouts: [...fin.payouts, payout] },
          audit: {
            action: 'payout_add',
            month: input.month,
            employeeId: input.employeeId,
            detail: `Выплата ${payout.amount} ₾ · ${empName(s, input.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    removePayout(id: string, actor?: Actor) {
      const fin = getFinance(getStore())
      const p = fin.payouts.find((x) => x.id === id)
      if (!p) return
      if (p.documentId) {
        const doc = payoutDocumentById(fin, p.documentId)
        if (doc?.status === 'paid') return
      }
      recordSliceExplicitDelete('finance.payouts', id, finActor(actor))
      patchFinance( (fin, s) => {
        const p = fin.payouts.find((x) => x.id === id)
        if (!p) return { finance: fin }
        if (p.documentId) {
          const doc = payoutDocumentById(fin, p.documentId)
          if (doc?.status === 'paid') return { finance: fin }
        }
        return {
          finance: { ...fin, payouts: fin.payouts.filter((x) => x.id !== id) },
          audit: {
            action: 'payout_remove',
            month: p.month,
            employeeId: p.employeeId,
            detail: `Удалена выплата ${p.amount} ₾ · ${empName(s, p.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    confirmSick(input: ConfirmSickInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        const existing = fin.sickConfirmations.find(
          (c) => c.employeeId === input.employeeId && c.month === input.month,
        )
        const confirmation: SickConfirmation = {
          id: existing?.id ?? crypto.randomUUID(),
          employeeId: input.employeeId,
          month: input.month,
          confirmedAt: new Date().toISOString(),
          byId: actor?.id,
          byName: actor?.name,
          fileUrl: input.fileUrl ?? existing?.fileUrl,
          fileName: input.fileName ?? existing?.fileName,
          note: input.note ?? existing?.note,
        }
        const sickConfirmations = existing
          ? fin.sickConfirmations.map((c) => (c.id === existing.id ? confirmation : c))
          : [...fin.sickConfirmations, confirmation]
        return {
          finance: { ...fin, sickConfirmations },
          audit: {
            action: 'sick_confirm',
            month: input.month,
            employeeId: input.employeeId,
            detail: `Больничный подтверждён · ${empName(s, input.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    unconfirmSick(employeeId: string, month: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (!fin.sickConfirmations.some((c) => c.employeeId === employeeId && c.month === month)) {
          return { finance: fin }
        }
        return {
          finance: {
            ...fin,
            sickConfirmations: fin.sickConfirmations.filter(
              (c) => !(c.employeeId === employeeId && c.month === month),
            ),
          },
          audit: {
            action: 'sick_unconfirm',
            month,
            employeeId,
            detail: `Больничный снят с подтверждения · ${empName(s, employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    confirmVacation(input: ConfirmVacationInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        const existing = fin.vacationConfirmations.find(
          (c) => c.employeeId === input.employeeId && c.month === input.month,
        )
        const confirmation: VacationConfirmation = {
          id: existing?.id ?? crypto.randomUUID(),
          employeeId: input.employeeId,
          month: input.month,
          confirmedAt: new Date().toISOString(),
          byId: actor?.id,
          byName: actor?.name,
          fileUrl: input.fileUrl ?? existing?.fileUrl,
          fileName: input.fileName ?? existing?.fileName,
          note: input.note ?? existing?.note,
        }
        const vacationConfirmations = existing
          ? fin.vacationConfirmations.map((c) => (c.id === existing.id ? confirmation : c))
          : [...fin.vacationConfirmations, confirmation]
        return {
          finance: { ...fin, vacationConfirmations },
          audit: {
            action: 'vacation_confirm',
            month: input.month,
            employeeId: input.employeeId,
            detail: `Отпуск подтверждён · ${empName(s, input.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    unconfirmVacation(employeeId: string, month: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (
          !fin.vacationConfirmations.some((c) => c.employeeId === employeeId && c.month === month)
        ) {
          return { finance: fin }
        }
        return {
          finance: {
            ...fin,
            vacationConfirmations: fin.vacationConfirmations.filter(
              (c) => !(c.employeeId === employeeId && c.month === month),
            ),
          },
          audit: {
            action: 'vacation_unconfirm',
            month,
            employeeId,
            detail: `Отпуск снят с подтверждения · ${empName(s, employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    saveAdvanceAccrualDraft(input: SaveAdvanceAccrualInput, actor?: Actor) {
      patchFinance( (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const lines = normalizeAccrualLines(input.lines)
        if (!lines.length) return { finance: fin }

        const docs = ensureAdvanceAccruals(fin)
        const existing = advanceAccrualById(fin, input.id)
        if (existing && existing.status !== 'draft') return { finance: fin }

        const doc: FinanceAdvanceAccrualDocument = existing
          ? {
              ...existing,
              month: input.month,
              lines,
              purpose: input.purpose?.trim() || undefined,
            }
          : {
              id: input.id,
              number: nextAdvanceAccrualNumber(fin, input.month),
              month: input.month,
              status: 'draft',
              lines,
              purpose: input.purpose?.trim() || undefined,
              byId: actor?.id,
              byName: actor?.name,
              at: new Date().toISOString(),
            }

        const nextDocs = existing
          ? docs.map((d) => (d.id === doc.id ? doc : d))
          : [...docs, doc]

        return {
          finance: { ...fin, advanceAccruals: nextDocs },
          audit: {
            action: 'advance_accrual_save',
            month: input.month,
            detail: `${doc.number} · черновик · ${lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    postAdvanceAccrual(id: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceAccrualById(fin, id)
        if (!doc || doc.status !== 'draft' || !doc.lines.length) return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const posted: FinanceAdvanceAccrualDocument = {
          ...doc,
          status: 'posted',
          postedAt: new Date().toISOString(),
          byId: actor?.id ?? doc.byId,
          byName: actor?.name ?? doc.byName,
        }
        return {
          finance: {
            ...fin,
            advanceAccruals: ensureAdvanceAccruals(fin).map((d) => (d.id === id ? posted : d)),
          },
          audit: {
            action: 'advance_accrual_post',
            month: doc.month,
            detail: `${doc.number} · проведено · ${doc.lines.length} чел.${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    voidAdvanceAccrual(id: string, reason?: string, actor?: Actor) {
      patchFinance( (fin, s) => {
        const doc = advanceAccrualById(fin, id)
        if (!doc || doc.status !== 'posted') return { finance: fin }
        if (isMonthClosed(s, doc.month)) return { finance: fin }
        const voided: FinanceAdvanceAccrualDocument = {
          ...doc,
          status: 'void',
          voidedAt: new Date().toISOString(),
          voidReason: reason?.trim() || undefined,
        }
        return {
          finance: {
            ...fin,
            advanceAccruals: ensureAdvanceAccruals(fin).map((d) => (d.id === id ? voided : d)),
          },
          audit: {
            action: 'advance_accrual_void',
            month: doc.month,
            detail: `${doc.number} · сторно${reason ? ` · ${reason}` : ''}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    deleteAdvanceAccrualDraft(id: string, actor?: Actor) {
      const fin = getFinance(getStore())
      const doc = advanceAccrualById(fin, id)
      if (!doc || doc.status !== 'draft') return
      recordSliceExplicitDelete('finance.advanceAccruals', id, finActor(actor))
      patchFinance( (fin) => {
        const doc = advanceAccrualById(fin, id)
        if (!doc || doc.status !== 'draft') return { finance: fin }
        return {
          finance: {
            ...fin,
            advanceAccruals: ensureAdvanceAccruals(fin).filter((d) => d.id !== id),
          },
          audit: {
            action: 'advance_accrual_save',
            month: doc.month,
            detail: `${doc.number} · удалён черновик${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    /** Создать черновик выдачи АВ из проведённого начисления НА. */
    createDisbursementFromAccrual(
      accrualId: string,
      opts: { date: string; method: FinancePaymentMethod; purpose?: string },
      actor?: Actor,
    ): string | null {
      let createdId: string | null = null
      patchFinance( (fin, s) => {
        const accrual = advanceAccrualById(fin, accrualId)
        if (!accrual || accrual.status !== 'posted' || !accrual.lines.length) {
          return { finance: fin }
        }
        if (isMonthClosed(s, accrual.month)) return { finance: fin }
        if (accrual.disbursementDocumentId) {
          createdId = accrual.disbursementDocumentId
          return { finance: fin }
        }

        const avId = crypto.randomUUID()
        const avDoc: FinanceAdvanceDocument = {
          id: avId,
          number: nextAdvanceDocumentNumber(fin, accrual.month),
          month: accrual.month,
          date: opts.date,
          method: opts.method,
          status: 'draft',
          lines: normalizeAdvanceDocumentLines(
            accrual.lines.map((l) => ({
              employeeId: l.employeeId,
              amount: l.amount,
              note: l.note,
            })),
          ),
          purpose:
            opts.purpose?.trim() ||
            accrual.purpose ||
            `Выдача по ${accrual.number}`,
          byId: actor?.id,
          byName: actor?.name,
          at: new Date().toISOString(),
        }

        const linked: FinanceAdvanceAccrualDocument = {
          ...accrual,
          disbursementDocumentId: avId,
        }

        createdId = avId
        return {
          finance: {
            ...fin,
            advanceDocuments: [...ensureAdvanceDocuments(fin), avDoc],
            advanceAccruals: ensureAdvanceAccruals(fin).map((d) =>
              d.id === accrual.id ? linked : d,
            ),
          },
          audit: {
            action: 'advance_document_save',
            month: accrual.month,
            detail: `${avDoc.number} · из ${accrual.number}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
      return createdId
    },

    markFinanceDocExported(
      kind: 'advance' | 'payout' | 'accrual',
      id: string,
      actor?: Actor,
    ) {
      const at = new Date().toISOString()
      patchFinance((fin) => {
        if (kind === 'advance') {
          const doc = advanceDocumentById(fin, id)
          if (!doc || !canHandoffExport(doc.status)) return { finance: fin }
          return {
            finance: {
              ...fin,
              advanceDocuments: ensureAdvanceDocuments(fin).map((d) =>
                d.id === id
                  ? {
                      ...d,
                      exportedAt: at,
                      exportedBy: actor?.id,
                      exportedByName: actor?.name,
                    }
                  : d,
              ),
            },
          }
        }
        if (kind === 'payout') {
          const doc = payoutDocumentById(fin, id)
          if (!doc || !canHandoffExport(doc.status)) return { finance: fin }
          return {
            finance: {
              ...fin,
              payoutDocuments: ensurePayoutDocuments(fin).map((d) =>
                d.id === id
                  ? {
                      ...d,
                      exportedAt: at,
                      exportedBy: actor?.id,
                      exportedByName: actor?.name,
                    }
                  : d,
              ),
            },
          }
        }
        const doc = advanceAccrualById(fin, id)
        if (!doc || (doc.status !== 'posted' && doc.status !== 'ready' && doc.status !== 'paid')) {
          return { finance: fin }
        }
        return {
          finance: {
            ...fin,
            advanceAccruals: ensureAdvanceAccruals(fin).map((d) =>
              d.id === id
                ? {
                    ...d,
                    exportedAt: at,
                    exportedBy: actor?.id,
                    exportedByName: actor?.name,
                  }
                : d,
            ),
          },
        }
      })
    },

    resetFinance() {
      setStore((s) => ({ ...s, finance: createDefaultFinanceStore() }))
    },
  }
}
