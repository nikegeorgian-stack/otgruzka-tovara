import { appendAudit } from '@/lib/audit'
import { getFinance } from '@/lib/finance/calc'
import { createDefaultFinanceStore } from '@/lib/finance/init'
import { isMonthClosed } from '@/lib/monthManage'
import type {
  FinanceAdjustment,
  FinanceAdjustmentKind,
  FinanceAdvance,
  FinancePaymentMethod,
  FinancePayout,
  FinanceStore,
  SickConfirmation,
} from '@/lib/finance/types'
import type { AppStore } from '@/lib/types'
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

function patchFinance(
  setStore: StoreSliceDeps['setStore'],
  fn: (fin: FinanceStore, s: AppStore) => { finance: FinanceStore; audit?: Parameters<typeof appendAudit>[1] },
) {
  setStore((s) => {
    const fin = getFinance(s)
    const { finance, audit } = fn(fin, s)
    let next: AppStore = { ...s, finance }
    if (audit) next = appendAudit(next, audit)
    return next
  })
}

function empName(s: AppStore, id: string): string {
  return s.employees.find((e) => e.id === id)?.fullName ?? id.slice(0, 8)
}

export function createFinanceSlice({ setStore }: StoreSliceDeps) {
  return {
    giveAdvance(input: GiveAdvanceInput, actor?: Actor) {
      patchFinance(setStore, (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
        const advance: FinanceAdvance = {
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
          finance: { ...fin, advances: [...fin.advances, advance] },
          audit: {
            action: 'advance_give',
            month: input.month,
            employeeId: input.employeeId,
            detail: `Аванс ${advance.amount} ₾ · ${empName(s, input.employeeId)}${actor?.name ? ` · ${actor.name}` : ''}`,
          },
        }
      })
    },

    removeAdvance(id: string, actor?: Actor) {
      patchFinance(setStore, (fin, s) => {
        const adv = fin.advances.find((a) => a.id === id)
        if (!adv) return { finance: fin }
        if (isMonthClosed(s, adv.month)) return { finance: fin }
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
      patchFinance(setStore, (fin, s) => {
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
      patchFinance(setStore, (fin, s) => {
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
      patchFinance(setStore, (fin, s) => {
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
      patchFinance(setStore, (fin, s) => {
        const p = fin.payouts.find((x) => x.id === id)
        if (!p) return { finance: fin }
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
      patchFinance(setStore, (fin, s) => {
        if (isMonthClosed(s, input.month)) return { finance: fin }
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
      patchFinance(setStore, (fin, s) => {
        if (isMonthClosed(s, month)) return { finance: fin }
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

    resetFinance() {
      setStore((s) => ({ ...s, finance: createDefaultFinanceStore() }))
    },
  }
}
