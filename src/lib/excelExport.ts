import { downloadXlsxBuffer, writeAoAWorkbook } from '@/lib/excel/workbookAdapter'
import { exportLabels } from '@/lib/export/labels'
import { dayDateKey, daysInMonth, formatMonthTitle, parseMonthKey } from './dates'
import { resolvePayrollAccrualRules } from './finance/payrollAccrualRules'
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

    const stats = rowStats(sheet, row.id, days, year, m, emp)
    line.push(mode === 'plan' ? stats.planHours : stats.factHours)
    rows.push(line)
  }

  return rows
}

async function downloadSheets(
  sheets: { name: string; rows: (string | number)[][] }[],
  filename: string,
): Promise<void> {
  const buffer = await writeAoAWorkbook(sheets)
  downloadXlsxBuffer(buffer, filename)
}

export async function exportTimesheetExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
  const labels = exportLabels(locale)
  const planRows = buildTimesheetSheet(store, month, 'plan', locale)
  const factRows = buildTimesheetSheet(store, month, 'fact', locale)
  if (!planRows.length) return

  await downloadSheets(
    [
      { name: labels.sheetPlan, rows: planRows },
      { name: labels.sheetFact, rows: factRows },
    ],
    `fibercell-tabel-${month}.xlsx`,
  )
}

export async function exportPayrollExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
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
    const pay = calculateRowPay(emp, sheet, row.id, y, m, {
      accrual: resolvePayrollAccrualRules(store.settings),
    })
    rows.push([
      emp.fullName,
      emp.nameKa ?? '',
      emp.brigade,
      emp.schedule,
      pay.factHours,
      Math.round(pay.amount * 100) / 100,
    ])
  }

  await downloadSheets(
    [{ name: formatMonthTitle(month, locale).slice(0, 31), rows }],
    `fibercell-pay-${month}.xlsx`,
  )
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
    'Ночь линия ₾',
    'Сверхур. 110%',
    'Сверхур. 115%',
    'Сверхур. 120%',
    'Простой ₾',
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
    'ხაზის ღამე ₾',
    'ზეგან. 110%',
    'ზეგან. 115%',
    'ზეგან. 120%',
    'უპირომოდ ₾',
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
  en: [
    'Name RU',
    'Name GE',
    'Brigade',
    'Schedule',
    'Fact h',
    'Base ₾',
    'Night ₾',
    'Night line ₾',
    'Overtime 110%',
    'Overtime 115%',
    'Overtime 120%',
    'Idle ₾',
    'Leave pay ₾',
    'Sick pay ₾',
    'Accrued ₾',
    'Bonuses ₾',
    'Foreman ₾',
    'Fines ₾',
    'Advance ₾',
    'To pay ₾',
    'Paid ₾',
    'Balance ₾',
  ],
}

/** Расширенная расчётная ведомость: начисления с разбивкой, премии/штрафы, аванс, к выплате. */
export async function exportPayrollStatementExcel(
  store: AppStore,
  month: string,
  locale: Locale,
): Promise<void> {
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
      r.breakdown.nightLineBonus,
      r.breakdown.ot110,
      r.breakdown.ot115,
      r.breakdown.ot120,
      r.breakdown.idle,
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

  await downloadSheets(
    [{ name: formatMonthTitle(month, locale).slice(0, 31), rows }],
    `fibercell-statement-${month}.xlsx`,
  )
}

export async function exportBrigadeReportExcel(
  store: AppStore,
  month: string,
  locale: Locale = store.settings.locale,
): Promise<void> {
  const labels = exportLabels(locale)
  const sheet = store.months[month]
  if (!sheet) return
  const [y, m] = month.split('-').map(Number)

  const byBrigade = new Map<string, { hours: number; amount: number }>()

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    const pay = calculateRowPay(emp, sheet, row.id, y, m, {
      accrual: resolvePayrollAccrualRules(store.settings),
    })
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

  await downloadSheets([{ name: 'brigades', rows }], `fibercell-brigades-${month}.xlsx`)
}
