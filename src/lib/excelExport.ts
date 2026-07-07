import { exportLabels } from '@/lib/export/labels'
import { loadXlsx } from '@/lib/lazy/xlsx'
import { dayDateKey, daysInMonth, formatMonthTitle, parseMonthKey } from './dates'
import { calculateRowPay, isPayableInMonth } from './payroll'
import { monthStatement, statementTotals } from './finance/calc'
import { formatFactCellCode, getFactExtraHours } from './factExtra'
import { getFactMark, rowStats } from './stats'
import type { AppStore, DayCode, Locale } from './types'

function buildTimesheetSheet(
  store: AppStore,
  month: string,
  mode: 'plan' | 'fact',
  locale: Locale,
): (string | number)[][] {
  const labels = exportLabels(locale)
  const sheet = store.months[month]
  if (!sheet) return []
  const { year, month: m } = parseMonthKey(month)
  const days = daysInMonth(year, m)
  const header: (string | number)[] = [
    labels.nameRu,
    labels.nameKa,
    labels.brigade,
    labels.schedule,
  ]
  for (let d = 1; d <= days; d++) header.push(d)
  header.push(mode === 'plan' ? labels.planHours : labels.factHours)

  const rows: (string | number)[][] = [header]

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp) continue

    const line: (string | number)[] = [
      emp.fullName,
      emp.nameKa ?? '',
      emp.brigade,
      emp.schedule,
    ]

    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, m, d)
      const code: DayCode =
        mode === 'plan'
          ? (sheet.plan[row.id]?.[dk] ?? '')
          : getFactMark(sheet, row.id, dk)
      if (mode === 'fact') {
        const extra = getFactExtraHours(sheet, row.id, dk)
        line.push(formatFactCellCode(code, extra))
      } else {
        line.push(code)
      }
    }

    const stats = rowStats(sheet, row.id, days, year, m)
    line.push(mode === 'plan' ? stats.planHours : stats.factHours)
    rows.push(line)
  }

  return rows
}

export async function exportTimesheetExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
  const XLSX = await loadXlsx()
  const labels = exportLabels(locale)
  const planRows = buildTimesheetSheet(store, month, 'plan', locale)
  const factRows = buildTimesheetSheet(store, month, 'fact', locale)
  if (!planRows.length) return

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(planRows), labels.sheetPlan)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(factRows), labels.sheetFact)
  XLSX.writeFile(wb, `fibercell-tabel-${month}.xlsx`)
}

export async function exportPayrollExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
  const XLSX = await loadXlsx()
  const sheet = store.months[month]
  if (!sheet) return
  const [y, m] = month.split('-').map(Number)

  const labels = exportLabels(locale)
  const rows: (string | number)[][] = [
    [
      labels.nameRu,
      labels.nameKa,
      labels.brigade,
      labels.schedule,
      labels.factHours,
      labels.payAmount,
    ],
  ]

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    const pay = calculateRowPay(emp, sheet, row.id, y, m)
    rows.push([
      emp.fullName,
      emp.nameKa ?? '',
      emp.brigade,
      emp.schedule,
      pay.factHours,
      Math.round(pay.amount * 100) / 100,
    ])
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, formatMonthTitle(month, locale).slice(0, 31))
  XLSX.writeFile(wb, `fibercell-pay-${month}.xlsx`)
}

const STATEMENT_HEADERS: Record<Locale, string[]> = {
  ru: [
    'ФИО RU',
    'ФИО GE',
    'Бригада',
    'График',
    'Факт ч',
    'База ₾',
    'Ночь ₾',
    'Сверхуроч ₾',
    'Отпускные ₾',
    'Больничные ₾',
    'Начислено ₾',
    'Премии ₾',
    'Бригадирские ₾',
    'Штрафы ₾',
    'Аванс ₾',
    'К выплате ₾',
    'Выплачено ₾',
    'Остаток ₾',
  ],
  ka: [
    'სახელი RU',
    'სახელი GE',
    'ბრიგადა',
    'გრაფიკი',
    'ფაქ.სთ',
    'ბაზა ₾',
    'ღამის ₾',
    'ზეგანაკვ. ₾',
    'შვებულება ₾',
    'ბიულეტენი ₾',
    'დარიცხული ₾',
    'პრემია ₾',
    'ბრიგადირის ₾',
    'ჯარიმა ₾',
    'ავანსი ₾',
    'გასაცემი ₾',
    'გაცემული ₾',
    'ნაშთი ₾',
  ],
}

/** Расширенная расчётная ведомость: начисления с разбивкой, премии/штрафы, аванс, к выплате. */
export async function exportPayrollStatementExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
  const XLSX = await loadXlsx()
  const stmt = monthStatement(store, month)
  if (!stmt.length) return
  const totals = statementTotals(stmt)

  const rows: (string | number)[][] = [STATEMENT_HEADERS[locale]]
  for (const r of stmt) {
    rows.push([
      r.emp.fullName,
      r.emp.nameKa ?? '',
      r.brigade,
      r.schedule,
      r.factHours,
      r.breakdown.base,
      r.breakdown.night,
      r.breakdown.overtime,
      r.breakdown.vacation,
      r.breakdown.sick,
      r.accrued,
      r.bonus,
      r.brigadierBonus,
      r.penalty,
      r.advance,
      r.net,
      r.paid,
      r.remaining,
    ])
  }
  const totalLabel = locale === 'ka' ? 'სულ' : 'Итого'
  rows.push([
    totalLabel,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    totals.accrued,
    totals.bonus,
    totals.brigadierBonus,
    totals.penalty,
    totals.advance,
    totals.net,
    totals.paid,
    totals.remaining,
  ])

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = STATEMENT_HEADERS[locale].map((h, i) => ({ wch: i < 2 ? 22 : Math.max(8, h.length + 1) }))
  XLSX.utils.book_append_sheet(wb, ws, formatMonthTitle(month, locale).slice(0, 31))
  XLSX.writeFile(wb, `fibercell-statement-${month}.xlsx`)
}

export async function exportBrigadeReportExcel(
  store: AppStore,
  month: string,
  locale: Locale = store.settings.locale,
): Promise<void> {
  const XLSX = await loadXlsx()
  const labels = exportLabels(locale)
  const sheet = store.months[month]
  if (!sheet) return
  const [y, m] = month.split('-').map(Number)

  const byBrigade = new Map<string, { hours: number; amount: number }>()

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    const pay = calculateRowPay(emp, sheet, row.id, y, m)
    const b = emp.brigade || '—'
    const cur = byBrigade.get(b) ?? { hours: 0, amount: 0 }
    byBrigade.set(b, {
      hours: cur.hours + pay.factHours,
      amount: cur.amount + pay.amount,
    })
  }

  const rows: (string | number)[][] = [
    [labels.brigadeCol, labels.factHours, labels.amountCol],
  ]
  for (const [b, v] of byBrigade) {
    rows.push([b, v.hours, Math.round(v.amount * 100) / 100])
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'brigades')
  XLSX.writeFile(wb, `fibercell-brigades-${month}.xlsx`)
}
