import { jsPDF } from 'jspdf'
import { formatMonthTitle } from '@/lib/dates'
import type { FinanceMonthEntries, StatementRow } from '@/lib/finance/calc'
import { isProductivityBonusReason } from '@/lib/finance/adjustmentReasons'
import { formatHourlyRate } from '@/lib/payroll'
import type { Locale } from '@/lib/types'

type PayslipPdfVariant = 'full' | 'short'

type PayslipPdfInput = {
  row: StatementRow
  month: string
  locale: Locale
  site?: string
  responsible?: string
  entries: FinanceMonthEntries
  variant: PayslipPdfVariant
  t: (key: string) => string
}

function gel(n: number): string {
  return `${n.toLocaleString('ru-RU')} GEL`
}

function hoursTimesRate(hours: number, rate: number): string {
  if (!(hours > 0) || !(rate > 0)) return ''
  return `${hours} h x ${formatHourlyRate(rate)} GEL`
}

function exportShortPayslipPdf(input: PayslipPdfInput, filename: string): void {
  const { row, month, locale, t } = input
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margin = 18
  const maxW = 80
  let y = 14

  const line = (label: string, value: string, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(bold ? 10 : 9)
    pdf.text(label, margin, y)
    pdf.text(value, margin + maxW, y, { align: 'right' })
    y += 4.5
  }

  const monthTitle = formatMonthTitle(month, locale)
  const gross = row.accrued + row.bonus + row.brigadierBonus
  const deltaH = row.hourDetail.factHours - row.hourDetail.planHours

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text('FiberCell', margin, y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.text(monthTitle, margin + maxW, y, { align: 'right' })
  y += 5
  pdf.setDrawColor(180)
  pdf.line(margin, y, margin + maxW, y)
  y += 5

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(row.emp.fullName, margin, y)
  y += 4.5
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(90)
  const meta = [
    `${t('employees.colTab')} ${row.emp.tabNumber || '—'}`,
    row.schedule,
    `${row.hourDetail.planHours}/${row.hourDetail.factHours} h`,
    deltaH !== 0 ? `d${deltaH > 0 ? '+' : ''}${deltaH}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  pdf.text(meta, margin, y)
  pdf.setTextColor(0)
  y += 6

  line(t('fin.payslip.base'), gel(row.breakdown.base))
  if (row.breakdown.night > 0) line(t('fin.payslip.night'), gel(row.breakdown.night))
  if (row.breakdown.nightLineBonus > 0) {
    line(t('fin.payslip.nightLineBonus'), `+${gel(row.breakdown.nightLineBonus)}`)
  }
  if (row.breakdown.ot110 > 0) line(t('fin.payslip.ot110'), gel(row.breakdown.ot110))
  if (row.breakdown.ot115 > 0) line(t('fin.payslip.ot115'), gel(row.breakdown.ot115))
  if (row.breakdown.ot120 > 0) line(t('fin.payslip.ot120'), gel(row.breakdown.ot120))
  if (
    row.breakdown.overtime > 0 &&
    row.breakdown.ot110 === 0 &&
    row.breakdown.ot115 === 0 &&
    row.breakdown.ot120 === 0
  ) {
    line(t('fin.payslip.overtime'), gel(row.breakdown.overtime))
  }
  if (row.breakdown.idle > 0) line(t('fin.payslip.idle'), gel(row.breakdown.idle))
  if (row.breakdown.vacation > 0) line(t('fin.payslip.vacation'), gel(row.breakdown.vacation))
  if (row.breakdown.sick > 0) line(t('fin.payslip.sick'), gel(row.breakdown.sick))
  if (row.autoBonus > 0) line(t('fin.col.bonus'), `+${gel(row.autoBonus)}`)
  if (row.productivityBonus > 0) {
    line(t('fin.col.productivityBonus'), `+${gel(row.productivityBonus)}`)
  }
  if (row.otherManualBonus > 0) line(t('fin.payslip.otherBonus'), `+${gel(row.otherManualBonus)}`)
  if (row.brigadierBonus > 0) line(t('fin.col.brigadierBonus'), `+${gel(row.brigadierBonus)}`)
  if (row.penalty > 0) line(t('fin.col.penalty'), `-${gel(row.penalty)}`)
  if (row.advance > 0) line(t('fin.col.advance'), `-${gel(row.advance)}`)

  y += 1
  pdf.setFillColor(245, 245, 244)
  pdf.rect(margin, y - 3, maxW, 12, 'F')
  line(t('fin.payslip.totalAccrued'), gel(gross))
  line(t('fin.col.net'), gel(row.net), true)

  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(100)
  pdf.text(t('fin.payslip.accountant'), margin, y)
  pdf.text(t('fin.payslip.employee'), margin + maxW, y, { align: 'right' })
  y += 8
  pdf.setDrawColor(160)
  pdf.line(margin, y, margin + 28, y)
  pdf.line(margin + maxW - 28, y, margin + maxW, y)

  pdf.save(filename)
}

/**
 * PDF расчётного листка без html2canvas — стабильно в Chrome/Edge.
 */
export async function exportPayslipPdf(input: PayslipPdfInput, filename: string): Promise<void> {
  if (input.variant === 'short') {
    exportShortPayslipPdf(input, filename)
    return
  }

  const { row, month, locale, site, responsible, entries, t } = input
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const margin = 14
  const maxW = pageW - margin * 2
  let y = 16

  const line = (label: string, value: string, opts?: { bold?: boolean; gap?: number }) => {
    if (y > 275) {
      pdf.addPage()
      y = 16
    }
    pdf.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
    pdf.setFontSize(opts?.bold ? 11 : 10)
    pdf.text(label, margin, y)
    pdf.text(value, margin + maxW, y, { align: 'right' })
    y += opts?.gap ?? 6
  }

  const section = (title: string) => {
    y += 2
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text(title, margin, y)
    y += 6
    pdf.setDrawColor(200)
    pdf.line(margin, y - 4, margin + maxW, y - 4)
  }

  const monthTitle = formatMonthTitle(month, locale)
  const gross = row.accrued + row.bonus + row.brigadierBonus

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('FiberCell', margin, y)
  y += 7
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.text(t('fin.payslip.title'), margin, y)
  pdf.text(monthTitle, margin + maxW, y, { align: 'right' })
  y += 5
  if (site) {
    pdf.setFontSize(9)
    pdf.setTextColor(100)
    pdf.text(site, margin + maxW, y, { align: 'right' })
    pdf.setTextColor(0)
    y += 4
  }
  y += 3
  pdf.setDrawColor(160)
  pdf.line(margin, y, margin + maxW, y)
  y += 8

  line(t('employees.colName'), row.emp.fullName)
  line(t('employees.colTab'), row.emp.tabNumber || '—')
  line(t('hr.position'), row.emp.position || '—')
  line(t('employees.colSchedule'), row.schedule)
  line(t('pay.colRate'), row.rateLabel.replace(/₾/g, 'GEL'))
  line(
    t('fin.payslip.planFactHours'),
    `${row.hourDetail.planHours} / ${row.hourDetail.factHours} h`,
  )

  section(t('fin.payslip.hoursDetail'))
  line(
    t('fin.payslip.planFactHours'),
    `${row.hourDetail.planHours} / ${row.hourDetail.factHours} h`,
  )
  if (row.hourDetail.factHours !== row.hourDetail.planHours) {
    const d = row.hourDetail.factHours - row.hourDetail.planHours
    line(t('fin.payslip.hoursDelta'), `${d > 0 ? '+' : ''}${d} h`)
  }
  line(
    t('fin.payslip.baseHours'),
    row.hourDetail.hourlyRate > 0 && row.hourDetail.baseHours > 0
      ? `${row.hourDetail.baseHours} h · ${formatHourlyRate(row.hourDetail.hourlyRate)} GEL/h`
      : `${row.hourDetail.baseHours} h`,
  )
  if (row.hourDetail.nightShiftHours > 0) {
    line(
      t('fin.payslip.nightShiftHours'),
      hoursTimesRate(
        row.hourDetail.nightShiftHours,
        row.hourDetail.hourlyRate * row.hourDetail.nightMultiplier,
      ) || `${row.hourDetail.nightShiftHours} h`,
    )
  }
  if (row.hourDetail.idleHours > 0) {
    line(
      t('fin.payslip.idleHours'),
      hoursTimesRate(
        row.hourDetail.idleHours,
        row.hourDetail.hourlyRate * row.hourDetail.idleMultiplier,
      ) || `${row.hourDetail.idleHours} h`,
    )
  }
  if (row.hourDetail.nightLineBonus > 0) {
    line(
      t('fin.payslip.nightLineBonus'),
      `${row.hourDetail.nightLineNights} x ${row.hourDetail.nightLineFixedGel} GEL`,
    )
  }
  if (row.hourDetail.monthDeltaOtHours > 0) {
    line(t('fin.payslip.monthDeltaOt'), `${row.hourDetail.monthDeltaOtHours} h · 110%`)
  } else if (row.hourDetail.overtimeHours > 0) {
    line(t('fin.payslip.overtimeHours'), `${row.hourDetail.overtimeHours} h`)
  }
  const b = row.hourDetail.brigadier
  if (b && row.brigadierBonus > 0) {
    section(t('fin.payslip.brigadierDetail'))
    line(t('fin.payslip.brigadierDays'), `${b.brigadierDays}`)
    line(t('fin.payslip.brigadierHours'), `${b.factBrigHours} h`)
    line(
      t('fin.payslip.brigadierRate'),
      `${b.fullMonthlyAmount} GEL / ${row.hourDetail.planHours} h`,
    )
    line(
      t('fin.payslip.brigadierFormula'),
      `${b.factBrigHours} x ${b.hourlySupplement.toFixed(2)} GEL`,
    )
    line(t('fin.col.brigadierBonus'), `+${gel(row.brigadierBonus)}`, { bold: true })
  }

  section(t('fin.payslip.accruals'))
  line(
    t('fin.payslip.base'),
    row.hourDetail.baseHours > 0 && row.hourDetail.hourlyRate > 0
      ? `${gel(row.breakdown.base)}  (${hoursTimesRate(row.hourDetail.baseHours, row.hourDetail.hourlyRate)})`
      : gel(row.breakdown.base),
  )
  if (row.breakdown.night > 0) {
    const nightRate = row.hourDetail.hourlyRate * row.hourDetail.nightMultiplier
    line(
      t('fin.payslip.night'),
      row.hourDetail.nightShiftHours > 0 && nightRate > 0
        ? `${gel(row.breakdown.night)}  (${hoursTimesRate(row.hourDetail.nightShiftHours, nightRate)})`
        : gel(row.breakdown.night),
    )
  }
  if (row.breakdown.nightLineBonus > 0) {
    line(t('fin.payslip.nightLineBonus'), `+${gel(row.breakdown.nightLineBonus)}`)
  }
  if (row.breakdown.ot110 > 0) line(t('fin.payslip.ot110'), gel(row.breakdown.ot110))
  if (row.breakdown.ot115 > 0) line(t('fin.payslip.ot115'), gel(row.breakdown.ot115))
  if (row.breakdown.ot120 > 0) line(t('fin.payslip.ot120'), gel(row.breakdown.ot120))
  if (
    row.breakdown.overtime > 0 &&
    row.breakdown.ot110 === 0 &&
    row.breakdown.ot115 === 0 &&
    row.breakdown.ot120 === 0
  ) {
    line(t('fin.payslip.overtime'), gel(row.breakdown.overtime))
  }
  if (row.breakdown.idle > 0) {
    const idleRate = row.hourDetail.hourlyRate * row.hourDetail.idleMultiplier
    line(
      t('fin.payslip.idle'),
      row.hourDetail.idleHours > 0 && idleRate > 0
        ? `${gel(row.breakdown.idle)}  (${hoursTimesRate(row.hourDetail.idleHours, idleRate)})`
        : gel(row.breakdown.idle),
    )
  }
  line(t('fin.payslip.vacation'), gel(row.breakdown.vacation))
  line(t('fin.payslip.sick'), gel(row.breakdown.sick))
  if (row.autoBonus > 0) line(t('fin.col.bonus'), `+${gel(row.autoBonus)}`)
  line(
    t('fin.col.productivityBonus'),
    row.productivityBonus > 0 ? `+${gel(row.productivityBonus)}` : '—',
  )
  for (const adj of entries.bonuses.filter((x) => !isProductivityBonusReason(x.reason))) {
    line(`${t('fin.ledger.kind.bonus')}: ${adj.reason}`, `+${gel(adj.amount)}`)
  }
  if (row.brigadierBonus > 0) {
    line(t('fin.col.brigadierBonus'), `+${gel(row.brigadierBonus)}`)
  }
  line(t('fin.payslip.totalAccrued'), gel(gross), { bold: true, gap: 8 })

  section(t('fin.payslip.deductions'))
  if (entries.penalties.length === 0 && row.advance === 0) {
    line(t('fin.payslip.none'), '—')
  } else {
    for (const p of entries.penalties) {
      line(`${t('fin.ledger.kind.penalty')}: ${p.reason}`, `-${gel(p.amount)}`)
    }
    for (const a of entries.advances) {
      line(`${t('fin.ledger.kind.advance')} · ${a.date}`, `-${gel(a.amount)}`)
    }
  }

  y += 2
  pdf.setFillColor(245, 245, 244)
  pdf.rect(margin, y - 4, maxW, 22, 'F')
  line(t('fin.col.net'), gel(row.net), { bold: true })
  line(t('fin.col.paid'), gel(row.paid))
  line(t('fin.col.remaining'), gel(row.remaining), { bold: true, gap: 10 })

  y += 8
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(80)
  pdf.text(`${t('fin.payslip.accountant')}: ${responsible || '____________'}`, margin, y)
  pdf.text(t('fin.payslip.employee'), margin + maxW, y, { align: 'right' })
  y += 14
  pdf.setDrawColor(160)
  pdf.line(margin, y, margin + 55, y)
  pdf.line(margin + maxW - 55, y, margin + maxW, y)
  y += 5
  pdf.text(t('fin.payslip.signature'), margin, y)
  pdf.text(t('fin.payslip.signature'), margin + maxW, y, { align: 'right' })
  pdf.setTextColor(0)

  pdf.save(filename)
}
