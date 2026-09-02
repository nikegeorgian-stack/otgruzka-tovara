/**
 * Операции по отпускным и расчёт при увольнении:
 * каждая операция пишет leaveLedger / dismissalSettlements,
 * запись в hrDocuments (архив) и строку в hrJournal — для сложных отчётов.
 */

import { appendEmployeeJournal } from '@/lib/hr/journal'
import {
  computeLeaveBalance,
  estimateUnusedLeavePay,
  newLeaveLedgerEntry,
} from '@/lib/hr/leaveBalance'
import type {
  DismissalSettlement,
  HrDocument,
  LeaveLedgerEntry,
  LeaveLedgerKind,
  HrJournalKind,
} from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

export const LEAVE_DOC_TYPE = 'Отпускные / расчёт'

export type LeaveOpAttachment = {
  fileUrl?: string
  fileName?: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function journalKindForLeave(kind: LeaveLedgerKind): HrJournalKind {
  if (kind === 'opening') return 'leave_opening'
  if (kind === 'adjustment') return 'leave_adjustment'
  return 'leave_payout'
}

function archiveTitle(
  kind: LeaveLedgerKind | 'dismissal_settlement',
  date: string,
  days: number,
  amountGel?: number,
): string {
  if (kind === 'dismissal_settlement') {
    const pay =
      amountGel != null && amountGel > 0
        ? ` · ${amountGel.toLocaleString('ru-RU')} ₾`
        : ''
    return `Расчёт при увольнении ${date} · ${days} дн.${pay}`
  }
  const sign = days > 0 ? '+' : ''
  const labels: Record<LeaveLedgerKind, string> = {
    opening: 'Стартовый остаток отпускных',
    adjustment: 'Корректировка отпускных',
    payout: 'Компенсация отпускных',
  }
  return `${labels[kind]} ${date} · ${sign}${days} дн.`
}

function pushArchiveDoc(
  emp: Employee,
  doc: HrDocument,
): Employee {
  return {
    ...emp,
    hrDocuments: [doc, ...(emp.hrDocuments ?? [])],
  }
}

/**
 * Добавить движение отпускных + обязательная запись в архив документов + журнал.
 * Скан/файл опционален, но карточка операции в архиве создаётся всегда.
 */
export function applyLeaveLedgerOperation(
  emp: Employee,
  input: {
    kind: LeaveLedgerKind
    days: number
    date?: string
    note?: string
    byName?: string
    amountGel?: number
    attachment?: LeaveOpAttachment
  },
): Employee {
  const date = input.date?.trim() || todayIso()
  const signed =
    input.kind === 'payout'
      ? -Math.abs(input.days)
      : input.kind === 'opening'
        ? Math.abs(input.days)
        : input.days

  const provisional = newLeaveLedgerEntry({
    kind: input.kind,
    days: signed,
    date,
    note: input.note,
    byName: input.byName,
  })

  const afterEmp: Employee = {
    ...emp,
    leaveLedger: [...(emp.leaveLedger ?? []), provisional],
  }
  const bal = computeLeaveBalance(afterEmp, date)
  const amountGel =
    input.amountGel ??
    (input.kind === 'payout'
      ? estimateUnusedLeavePay(emp, Math.abs(signed)).amount
      : undefined)

  const docId = crypto.randomUUID()
  const doc: HrDocument = {
    id: docId,
    title: archiveTitle(input.kind, date, signed, amountGel),
    docType: LEAVE_DOC_TYPE,
    uploadedAt: date,
    uploadedBy: input.byName?.trim() || 'HR',
    fileUrl: input.attachment?.fileUrl,
    fileName: input.attachment?.fileName,
  }

  const entry: LeaveLedgerEntry = {
    ...provisional,
    balanceAfter: bal.balance,
    amountGel,
    documentId: docId,
    fileUrl: input.attachment?.fileUrl,
    fileName: input.attachment?.fileName,
  }

  let next: Employee = {
    ...emp,
    leaveLedger: [...(emp.leaveLedger ?? []), entry],
  }
  next = pushArchiveDoc(next, doc)
  next = appendEmployeeJournal(next, {
    kind: journalKindForLeave(input.kind),
    dateKey: date,
    startDate: date,
    endDate: date,
    note: [
      `${signed > 0 ? '+' : ''}${signed} дн.`,
      amountGel != null && amountGel > 0
        ? `${amountGel.toLocaleString('ru-RU')} ₾`
        : null,
      `остаток ${bal.balance}`,
      input.note,
      input.attachment?.fileName ? `файл: ${input.attachment.fileName}` : 'архив без скана',
    ]
      .filter(Boolean)
      .join(' · '),
    source: 'leave_ledger',
    documentId: docId,
    leaveLedgerId: entry.id,
  })
  return next
}

/**
 * Зафиксировать расчёт при увольнении:
 * снимок DismissalSettlement + архив + журнал + payout в leaveLedger (если есть дни).
 */
export function confirmDismissalSettlement(
  emp: Employee,
  input: {
    terminationDate: string
    note?: string
    byName?: string
    attachment?: LeaveOpAttachment
    /** Если true (по умолчанию) — списать остаток payout-строкой */
    writePayout?: boolean
  },
): Employee {
  const term = input.terminationDate.trim()
  if (!term) return emp
  if ((emp.dismissalSettlements ?? []).some((s) => s.terminationDate === term)) {
    return emp
  }

  const withTerm: Employee = {
    ...emp,
    terminationDate: term,
  }
  const b = computeLeaveBalance(withTerm, term)
  const pay = estimateUnusedLeavePay(emp, b.balance)
  const writePayout = input.writePayout !== false && pay.days > 0

  const settlementId = crypto.randomUUID()
  const docId = crypto.randomUUID()
  const doc: HrDocument = {
    id: docId,
    title: archiveTitle('dismissal_settlement', term, pay.days, pay.amount),
    docType: LEAVE_DOC_TYPE,
    uploadedAt: term,
    uploadedBy: input.byName?.trim() || 'HR',
    fileUrl: input.attachment?.fileUrl,
    fileName: input.attachment?.fileName,
  }

  let next: Employee = { ...withTerm }
  let payoutId: string | undefined

  if (writePayout) {
    next = applyLeaveLedgerOperation(next, {
      kind: 'payout',
      days: pay.days,
      date: term,
      note: input.note ?? 'Компенсация при увольнении',
      byName: input.byName,
      amountGel: pay.amount,
    })
    payoutId = (next.leaveLedger ?? []).at(-1)?.id
  }

  const settlement: DismissalSettlement = {
    id: settlementId,
    terminationDate: term,
    createdAt: new Date().toISOString(),
    leaveBalanceDays: b.balance,
    leaveCompensationGel: pay.amount,
    dailyRate: pay.dailyRate,
    monthlySalary: emp.monthlySalary,
    accruedMonths: b.accruedMonths,
    usedDays: b.used,
    openingDays: b.opening,
    note: input.note,
    documentId: docId,
    fileUrl: input.attachment?.fileUrl,
    fileName: input.attachment?.fileName,
    leaveLedgerPayoutId: payoutId,
    status: 'confirmed',
  }

  next = pushArchiveDoc(next, doc)
  next = {
    ...next,
    dismissalSettlements: [settlement, ...(next.dismissalSettlements ?? [])],
  }
  next = appendEmployeeJournal(next, {
    kind: 'dismissal_settlement',
    dateKey: term,
    startDate: term,
    endDate: term,
    note: [
      `${pay.days} дн.`,
      pay.amount > 0 ? `${pay.amount.toLocaleString('ru-RU')} ₾` : null,
      input.note,
      input.attachment?.fileName ? `файл: ${input.attachment.fileName}` : 'архив без скана',
    ]
      .filter(Boolean)
      .join(' · '),
    source: 'leave_ledger',
    documentId: docId,
    dismissalSettlementId: settlementId,
    leaveLedgerId: payoutId,
  })
  return next
}

/** Найти документ архива по id операции / documentId. */
export function findLeaveArchiveDoc(
  emp: Employee,
  documentId: string | undefined,
): HrDocument | undefined {
  if (!documentId) return undefined
  return (emp.hrDocuments ?? []).find((d) => d.id === documentId)
}
