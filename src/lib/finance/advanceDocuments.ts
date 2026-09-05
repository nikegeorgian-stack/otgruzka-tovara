import type { AppStore, Employee } from '@/lib/types'
import { getFinance } from './calc'
import type {
  FinanceAdvance,
  FinanceAdvanceDocument,
  FinanceAdvanceDocumentLine,
  FinanceAdvanceDocumentStatus,
  FinanceStore,
} from './types'

export function advanceDocumentsList(fin: FinanceStore): FinanceAdvanceDocument[] {
  return fin.advanceDocuments ?? []
}

export function advanceDocumentById(
  fin: FinanceStore,
  id: string,
): FinanceAdvanceDocument | undefined {
  return advanceDocumentsList(fin).find((d) => d.id === id)
}

export function documentLineTotal(lines: FinanceAdvanceDocumentLine[]): number {
  return lines.reduce((s, l) => s + Math.round(l.amount), 0)
}

export function nextAdvanceDocumentNumber(fin: FinanceStore, month: string): string {
  /** ПЧ = первая часть зарплаты (раньше АВ — аванс). */
  const ym = month.replace('-', '')
  const prefixes = [`ПЧ-${ym}-`, `АВ-${ym}-`]
  const maxSeq = advanceDocumentsList(fin).reduce((max, d) => {
    for (const prefix of prefixes) {
      if (!d.number.startsWith(prefix)) continue
      const n = parseInt(d.number.slice(prefix.length), 10)
      if (Number.isFinite(n)) return Math.max(max, n)
    }
    return max
  }, 0)
  return `ПЧ-${ym}-${String(maxSeq + 1).padStart(3, '0')}`
}

export type AdvanceDocumentListOpts = {
  month?: string
  status?: FinanceAdvanceDocumentStatus | 'all'
  includeVoid?: boolean
}

export function listAdvanceDocuments(
  fin: FinanceStore,
  opts: AdvanceDocumentListOpts = {},
): FinanceAdvanceDocument[] {
  const { month, status = 'all', includeVoid = true } = opts
  let list = advanceDocumentsList(fin)
  if (month) list = list.filter((d) => d.month === month)
  if (status !== 'all') list = list.filter((d) => d.status === status)
  if (!includeVoid) list = list.filter((d) => d.status !== 'void')
  return list.sort(
    (a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, 'ru'),
  )
}

export type ResolvedAdvanceLine = {
  line: FinanceAdvanceDocumentLine
  emp: Employee | undefined
  employeeName: string
}

export function resolveAdvanceDocumentLines(
  store: AppStore,
  doc: FinanceAdvanceDocument,
): ResolvedAdvanceLine[] {
  return doc.lines.map((line) => {
    const emp = store.employees.find((e) => e.id === line.employeeId)
    return {
      line,
      emp,
      employeeName: emp?.fullName || emp?.nameKa || line.employeeId.slice(0, 8),
    }
  })
}

export function advancesForDocument(fin: FinanceStore, documentId: string): FinanceAdvance[] {
  return fin.advances.filter((a) => a.documentId === documentId)
}

export function documentNumberForAdvance(
  fin: FinanceStore,
  advance: FinanceAdvance,
): string | undefined {
  if (!advance.documentId) return undefined
  return advanceDocumentById(fin, advance.documentId)?.number
}

export function normalizeAdvanceDocumentLines(
  lines: { employeeId: string; amount: number; note?: string; id?: string }[],
): FinanceAdvanceDocumentLine[] {
  return lines
    .filter((l) => l.employeeId && l.amount > 0)
    .map((l) => ({
      id: l.id ?? crypto.randomUUID(),
      employeeId: l.employeeId,
      amount: Math.round(l.amount),
      note: l.note?.trim() || undefined,
    }))
}

export function buildAdvancesFromDocument(
  doc: FinanceAdvanceDocument,
  actor?: { id?: string; name?: string },
): FinanceAdvance[] {
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

export function methodLabelKey(method: string): string {
  return `fin.method.${method}`
}

export function getFinanceDocuments(store: AppStore): FinanceAdvanceDocument[] {
  return advanceDocumentsList(getFinance(store))
}
