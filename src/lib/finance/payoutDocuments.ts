import type { AppStore, Employee } from '@/lib/types'
import type {
  FinancePayout,
  FinancePayoutDocument,
  FinancePayoutDocumentLine,
  FinanceAdvanceDocumentStatus,
  FinanceStore,
} from './types'

export function payoutDocumentsList(fin: FinanceStore): FinancePayoutDocument[] {
  return fin.payoutDocuments ?? []
}

export function payoutDocumentById(
  fin: FinanceStore,
  id: string,
): FinancePayoutDocument | undefined {
  return payoutDocumentsList(fin).find((d) => d.id === id)
}

export function documentLineTotal(lines: FinancePayoutDocumentLine[]): number {
  return lines.reduce((s, l) => s + Math.round(l.amount), 0)
}

export function nextPayoutDocumentNumber(fin: FinanceStore, month: string): string {
  /** ОЗ = остаточная зарплата (раньше ЗП). */
  const ym = month.replace('-', '')
  const prefixes = [`ОЗ-${ym}-`, `ЗП-${ym}-`]
  const maxSeq = payoutDocumentsList(fin).reduce((max, d) => {
    for (const prefix of prefixes) {
      if (!d.number.startsWith(prefix)) continue
      const n = parseInt(d.number.slice(prefix.length), 10)
      if (Number.isFinite(n)) return Math.max(max, n)
    }
    return max
  }, 0)
  return `ОЗ-${ym}-${String(maxSeq + 1).padStart(3, '0')}`
}

export type PayoutDocumentListOpts = {
  month?: string
  status?: FinanceAdvanceDocumentStatus | 'all'
  includeVoid?: boolean
}

export function listPayoutDocuments(
  fin: FinanceStore,
  opts: PayoutDocumentListOpts = {},
): FinancePayoutDocument[] {
  const { month, status = 'all', includeVoid = true } = opts
  let list = payoutDocumentsList(fin)
  if (month) list = list.filter((d) => d.month === month)
  if (status !== 'all') list = list.filter((d) => d.status === status)
  if (!includeVoid) list = list.filter((d) => d.status !== 'void')
  return list.sort(
    (a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, 'ru'),
  )
}

export type ResolvedPayoutLine = {
  line: FinancePayoutDocumentLine
  emp: Employee | undefined
  employeeName: string
}

export function resolvePayoutDocumentLines(
  store: AppStore,
  doc: FinancePayoutDocument,
): ResolvedPayoutLine[] {
  return doc.lines.map((line) => {
    const emp = store.employees.find((e) => e.id === line.employeeId)
    return {
      line,
      emp,
      employeeName: emp?.fullName || emp?.nameKa || line.employeeId.slice(0, 8),
    }
  })
}

export function payoutsForDocument(fin: FinanceStore, documentId: string): FinancePayout[] {
  return fin.payouts.filter((p) => p.documentId === documentId)
}

export function documentNumberForPayout(
  fin: FinanceStore,
  payout: FinancePayout,
): string | undefined {
  if (!payout.documentId) return undefined
  return payoutDocumentById(fin, payout.documentId)?.number
}

export function normalizePayoutDocumentLines(
  lines: { employeeId: string; amount: number; note?: string; id?: string }[],
): FinancePayoutDocumentLine[] {
  return lines
    .filter((l) => l.employeeId && l.amount > 0)
    .map((l) => ({
      id: l.id ?? crypto.randomUUID(),
      employeeId: l.employeeId,
      amount: Math.round(l.amount),
      note: l.note?.trim() || undefined,
    }))
}

export function buildPayoutsFromDocument(
  doc: FinancePayoutDocument,
  actor?: { id?: string; name?: string },
): FinancePayout[] {
  const at = new Date().toISOString()
  return doc.lines.map((line) => ({
    id: crypto.randomUUID(),
    employeeId: line.employeeId,
    month: doc.month,
    date: doc.date,
    amount: Math.round(line.amount),
    method: doc.method,
    note: line.note,
    documentId: doc.id,
    lineId: line.id,
    byId: actor?.id ?? doc.byId,
    byName: actor?.name ?? doc.byName,
    at,
  }))
}
