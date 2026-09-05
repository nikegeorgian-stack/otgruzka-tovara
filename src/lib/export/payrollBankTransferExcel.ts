import { formatMonthTitle } from '@/lib/dates'
import { intlLocale } from '@/i18n/localeFormat'
import { monthStatement, statementTotals, type StatementRow } from '@/lib/finance/calc'
import {
  primaryBankName,
  primaryIbanDisplay,
  primaryIbanRaw,
} from '@/lib/hr/employeeBank'
import { loadExcelJs } from '@/lib/lazy/exceljs'
import { t, tf } from '@/i18n'
import type { Locale } from '@/i18n/types'
import type { AppStore, Employee } from '@/lib/types'
import { loadBrandLogoPng } from './brandLogoPng'

const ACCENT = 'FFFF5500'
const INK = 'FF1A1A1A'
const MUTED = 'FF6B7280'
const HEADER_BG = 'FFFFF5F0'
const HEADER_FG = 'FF9A3412'
const BORDER = 'FFE5E7EB'
const ROW_ALT = 'FFFAFAF9'
const WARN_BG = 'FFFEF2F2'
const WARN_FG = 'FFB91C1C'
const TOTAL_BG = 'FFFFF7ED'
const COPY_BG = 'FFFEF9C3'

function orgTitle(store: AppStore, locale: Locale): string {
  const emp = store.settings.employer
  if (locale === 'ka') return emp?.orgKa?.trim() || emp?.orgRu?.trim() || 'FiberCell'
  return emp?.orgRu?.trim() || emp?.orgKa?.trim() || 'FiberCell'
}

function nameRu(emp: Employee): string {
  return emp.fullName?.trim() || emp.nameKa?.trim() || emp.id.slice(0, 8)
}

function nameKa(emp: Employee): string {
  return emp.nameKa?.trim() || emp.fullName?.trim() || emp.id.slice(0, 8)
}

function deptOf(emp: Employee): string {
  return emp.department?.trim() || emp.brigade?.trim() || ''
}

function sortRows(rows: StatementRow[]): StatementRow[] {
  return [...rows].sort((a, b) => nameRu(a.emp).localeCompare(nameRu(b.emp), 'ru'))
}

function downloadXlsx(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function thinBorder() {
  return {
    top: { style: 'thin' as const, color: { argb: BORDER } },
    left: { style: 'thin' as const, color: { argb: BORDER } },
    bottom: { style: 'thin' as const, color: { argb: BORDER } },
    right: { style: 'thin' as const, color: { argb: BORDER } },
  }
}

function money(n: number): number {
  return Math.round(n * 100) / 100
}

export async function exportPayrollBankTransferExcel(
  store: AppStore,
  month: string,
  locale: Locale = store.settings.locale,
): Promise<void> {
  const allRows = monthStatement(store, month)
  const payable = sortRows(allRows.filter((r) => r.remaining > 0.005))
  if (!payable.length) return

  const ExcelJS = await loadExcelJs()
  const logo = await loadBrandLogoPng()
  const monthTitle = formatMonthTitle(month, locale)
  const bankLocale: Locale = locale === 'ka' ? 'ka' : 'ru'
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FiberCell Tabel'
  wb.created = new Date()

  const sheetName = t(locale, 'fin.bankTransfer.sheetName').slice(0, 31)
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    views: [{ state: 'frozen', ySplit: 9, showGridLines: false }],
  })

  // № | ФИО RU | ФИО KA | Отдел | Сумма | Банк | IBAN | IBAN copy | Примечание
  ws.columns = [
    { width: 5 },
    { width: 28 },
    { width: 28 },
    { width: 16 },
    { width: 14 },
    { width: 20 },
    { width: 34 },
    { width: 28 },
    { width: 16 },
  ]

  if (logo) {
    const imageId = wb.addImage({ base64: logo.base64, extension: 'png' })
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 52, height: 52 } })
  }

  ws.mergeCells('B1:I1')
  ws.getCell('B1').value = orgTitle(store, locale)
  ws.getCell('B1').font = { name: 'Georgia', size: 14, bold: true, color: { argb: INK } }

  ws.mergeCells('A4:I4')
  ws.getCell('A4').value = t(locale, 'fin.bankTransfer.title')
  ws.getCell('A4').font = { name: 'Georgia', size: 16, bold: true, color: { argb: INK } }
  ws.getCell('A4').alignment = { horizontal: 'center' }

  ws.mergeCells('A5:I5')
  ws.getCell('A5').value = monthTitle
  ws.getCell('A5').alignment = { horizontal: 'center' }
  ws.getCell('A5').font = { color: { argb: MUTED } }

  ws.mergeCells('A6:I6')
  ws.getCell('A6').value = tf(locale, 'fin.bankTransfer.purpose', { month: monthTitle })
  ws.getCell('A6').font = { italic: true, size: 10, color: { argb: MUTED } }
  ws.getCell('A6').alignment = { horizontal: 'center' }

  ws.mergeCells('A7:I7')
  ws.getCell('A7').value = t(locale, 'fin.bankTransfer.excelHint')
  ws.getCell('A7').font = { size: 9, italic: true, color: { argb: MUTED } }

  const headerRowNum = 9
  const headers = [
    t(locale, 'fin.bankTransfer.colNo'),
    t(locale, 'fin.bankTransfer.colNameRu'),
    t(locale, 'fin.bankTransfer.colNameKa'),
    t(locale, 'fin.bankTransfer.colDept'),
    t(locale, 'fin.bankTransfer.colAmount'),
    t(locale, 'fin.bankTransfer.colBank'),
    t(locale, 'fin.bankTransfer.colIban'),
    t(locale, 'fin.bankTransfer.colIbanCopy'),
    t(locale, 'fin.bankTransfer.colNote'),
  ]
  const headerRow = ws.getRow(headerRowNum)
  headers.forEach((text, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = text
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HEADER_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER } },
      left: { style: 'thin', color: { argb: BORDER } },
      right: { style: 'thin', color: { argb: BORDER } },
      bottom: { style: 'medium', color: { argb: ACCENT } },
    }
    cell.alignment = { wrapText: true, vertical: 'middle' }
  })
  headerRow.height = 28

  let rowNum = headerRowNum + 1
  let missingCount = 0

  for (let i = 0; i < payable.length; i++) {
    const row = payable[i]
    const excelRow = ws.getRow(rowNum)
    const ibanRaw = primaryIbanRaw(row.emp)
    const missingIban = !ibanRaw

    excelRow.getCell(1).value = i + 1
    excelRow.getCell(2).value = nameRu(row.emp)
    excelRow.getCell(3).value = nameKa(row.emp)
    excelRow.getCell(4).value = deptOf(row.emp)
    excelRow.getCell(5).value = money(row.remaining)
    excelRow.getCell(5).numFmt = '#,##0.00'
    excelRow.getCell(6).value = primaryBankName(row.emp, bankLocale)
    excelRow.getCell(7).value = missingIban ? '—' : primaryIbanDisplay(row.emp)
    excelRow.getCell(8).value = missingIban ? '' : ibanRaw
    excelRow.getCell(9).value = missingIban ? t(locale, 'fin.bankTransfer.missingIban') : ''

    for (let c = 1; c <= 9; c++) {
      const cell = excelRow.getCell(c)
      cell.border = thinBorder()
      if (c === 8 && !missingIban) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COPY_BG } }
        cell.font = { name: 'Consolas', size: 10 }
      } else if (missingIban && (c === 7 || c === 8 || c === 9)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_BG } }
        cell.font = { color: { argb: WARN_FG } }
      } else if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } }
      }
    }
    if (missingIban) missingCount++
    rowNum++
  }

  const dataEnd = rowNum - 1
  if (dataEnd >= headerRowNum) {
    ws.autoFilter = {
      from: { row: headerRowNum, column: 1 },
      to: { row: dataEnd, column: 9 },
    }
  }

  const totals = statementTotals(payable)
  const totalRow = ws.getRow(rowNum)
  ws.mergeCells(rowNum, 1, rowNum, 4)
  totalRow.getCell(1).value =
    `${t(locale, 'fin.bankTransfer.total')} (${tf(locale, 'fin.bankTransfer.count', { n: payable.length })})`
  totalRow.getCell(5).value = money(totals.remaining)
  totalRow.getCell(5).numFmt = '#,##0.00'
  totalRow.getCell(9).value = missingCount
    ? tf(locale, 'fin.bankTransfer.missingCount', { n: missingCount })
    : ''
  for (let c = 1; c <= 9; c++) {
    const cell = totalRow.getCell(c)
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } }
  }
  rowNum += 2

  const sigRow = ws.getRow(rowNum)
  ws.mergeCells(rowNum, 1, rowNum, 3)
  sigRow.getCell(1).value = `${t(locale, 'fin.payslip.accountant')}: __________________`
  ws.mergeCells(rowNum, 4, rowNum, 6)
  sigRow.getCell(4).value = `${t(locale, 'fin.bankTransfer.director')}: __________________`
  sigRow.getCell(9).value =
    `${t(locale, 'fin.bankTransfer.date')}: ${new Date().toLocaleDateString(intlLocale(locale))}`

  const copyWs = wb.addWorksheet(t(locale, 'fin.bankTransfer.copySheet').slice(0, 31))
  copyWs.columns = [{ width: 32 }, { width: 36 }, { width: 24 }]
  copyWs.getCell('A1').value = t(locale, 'fin.bankTransfer.copySheetTitle')
  copyWs.getCell('A1').font = { bold: true, size: 12 }
  copyWs.mergeCells('A1:C1')
  copyWs.getCell('A2').value = t(locale, 'fin.bankTransfer.copySheetHint')
  copyWs.mergeCells('A2:C2')
  copyWs.getCell('A2').font = { italic: true, size: 9, color: { argb: MUTED } }
  const ch = 4
  ;[
    t(locale, 'fin.bankTransfer.colNameRu'),
    t(locale, 'fin.bankTransfer.colIbanCopy'),
    t(locale, 'fin.bankTransfer.colBank'),
  ].forEach((text, i) => {
    const cell = copyWs.getRow(ch).getCell(i + 1)
    cell.value = text
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
  })
  let cr = ch + 1
  for (const row of payable) {
    const raw = primaryIbanRaw(row.emp)
    if (!raw) continue
    copyWs.getRow(cr).getCell(1).value = nameRu(row.emp)
    const ibanCell = copyWs.getRow(cr).getCell(2)
    ibanCell.value = raw
    ibanCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COPY_BG } }
    ibanCell.font = { name: 'Consolas', size: 11 }
    copyWs.getRow(cr).getCell(3).value = primaryBankName(row.emp, bankLocale)
    cr++
  }
  if (cr > ch + 1) {
    copyWs.autoFilter = {
      from: { row: ch, column: 1 },
      to: { row: cr - 1, column: 3 },
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  downloadXlsx(buffer as ArrayBuffer, `fibercell-bank-transfer-${month}.xlsx`)
}
