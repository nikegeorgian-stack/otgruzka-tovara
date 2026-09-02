import { formatMonthTitle } from '@/lib/dates'
import {
  advanceDocumentById,
  documentLineTotal,
  resolveAdvanceDocumentLines,
} from '@/lib/finance/advanceDocuments'
import { getFinance } from '@/lib/finance/calc'
import { canHandoffExport } from '@/lib/finance/disbursementDocStatus'
import {
  primaryBankName,
  primaryIbanDisplay,
  primaryIbanRaw,
} from '@/lib/hr/employeeBank'
import { loadExcelJs } from '@/lib/lazy/exceljs'
import { t } from '@/i18n'
import type { Locale } from '@/i18n/types'
import type { AppStore, Employee } from '@/lib/types'
import { loadBrandLogoPng } from './brandLogoPng'

const ACCENT = 'FFFF5500'
const INK = 'FF1A1A1A'
const HEADER_BG = 'FFFFF5F0'
const HEADER_FG = 'FF9A3412'
const BORDER = 'FFE5E7EB'
const ROW_ALT = 'FFFAFAF9'
const WARN_BG = 'FFFEF2F2'
const WARN_FG = 'FFB91C1C'
const TOTAL_BG = 'FFFFF7ED'
const COPY_BG = 'FFFEF9C3'

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

function nameRu(emp: Employee | undefined, fallback: string): string {
  if (!emp) return fallback
  return emp.fullName?.trim() || emp.nameKa?.trim() || fallback
}

function nameKa(emp: Employee | undefined, fallback: string): string {
  if (!emp) return fallback
  return emp.nameKa?.trim() || emp.fullName?.trim() || fallback
}

function deptOf(emp: Employee | undefined): string {
  return emp?.department?.trim() || emp?.brigade?.trim() || ''
}

export async function exportAdvanceDisbursementExcel(
  store: AppStore,
  documentId: string,
  locale: Locale = store.settings.locale,
): Promise<void> {
  const fin = getFinance(store)
  const doc = advanceDocumentById(fin, documentId)
  if (!doc || !canHandoffExport(doc.status) || !doc.lines.length) return

  const ExcelJS = await loadExcelJs()
  const logo = await loadBrandLogoPng()
  const rows = [...resolveAdvanceDocumentLines(store, doc)].sort((a, b) => {
    const na = nameRu(a.emp, a.employeeName)
    const nb = nameRu(b.emp, b.employeeName)
    return na.localeCompare(nb, 'ru')
  })
  const monthTitle = formatMonthTitle(doc.month, locale)
  const total = documentLineTotal(doc.lines)
  const showIban = doc.method === 'bank'
  const bankLocale: Locale = locale === 'ka' ? 'ka' : 'ru'

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FiberCell Tabel'
  const ws = wb.addWorksheet(doc.number.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', ySplit: 7, showGridLines: false }],
  })

  // № | ФИО RU | ФИО KA | Отдел | Сумма | Банк | IBAN | IBAN copy | Подпись
  ws.columns = showIban
    ? [
        { width: 5 },
        { width: 28 },
        { width: 28 },
        { width: 18 },
        { width: 12 },
        { width: 22 },
        { width: 34 },
        { width: 28 },
        { width: 12 },
      ]
    : [{ width: 5 }, { width: 28 }, { width: 28 }, { width: 18 }, { width: 12 }, { width: 12 }]

  if (logo) {
    const imageId = wb.addImage({ base64: logo.base64, extension: 'png' })
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 52, height: 52 } })
  }

  const lastCol = showIban ? 9 : 6
  ws.mergeCells(1, 2, 1, lastCol)
  ws.getCell(1, 2).value = t(locale, 'fin.advDoc.printTitle')
  ws.getCell(1, 2).font = { name: 'Georgia', size: 14, bold: true, color: { argb: INK } }

  ws.mergeCells(4, 1, 4, lastCol)
  ws.getCell(4, 1).value = `${doc.number} · ${monthTitle}`
  ws.getCell(4, 1).alignment = { horizontal: 'center' }
  ws.getCell(4, 1).font = { name: 'Georgia', size: 14, bold: true }

  ws.mergeCells(5, 1, 5, lastCol)
  ws.getCell(5, 1).value = t(locale, 'fin.bankTransfer.excelHint')
  ws.getCell(5, 1).font = { size: 9, italic: true, color: { argb: 'FF6B7280' } }

  const headerRow = 7
  const headers = [
    t(locale, 'fin.bankTransfer.colNo'),
    t(locale, 'fin.bankTransfer.colNameRu'),
    t(locale, 'fin.bankTransfer.colNameKa'),
    t(locale, 'fin.bankTransfer.colDept'),
    t(locale, 'fin.advDoc.colAmount'),
    ...(showIban
      ? [
          t(locale, 'fin.bankTransfer.colBank'),
          t(locale, 'fin.bankTransfer.colIban'),
          t(locale, 'fin.bankTransfer.colIbanCopy'),
        ]
      : []),
    t(locale, 'fin.advDoc.colSignature'),
  ]
  headers.forEach((text, i) => {
    const cell = ws.getRow(headerRow).getCell(i + 1)
    cell.value = text
    cell.font = { bold: true, color: { argb: HEADER_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } }
    cell.alignment = { wrapText: true, vertical: 'middle' }
  })
  ws.getRow(headerRow).height = 28

  let rowNum = headerRow + 1
  rows.forEach((row, i) => {
    const excelRow = ws.getRow(rowNum)
    const missingIban = showIban && row.emp && !primaryIbanRaw(row.emp)
    const ibanRaw = row.emp ? primaryIbanRaw(row.emp) : ''
    excelRow.getCell(1).value = i + 1
    excelRow.getCell(2).value = nameRu(row.emp, row.employeeName)
    excelRow.getCell(3).value = nameKa(row.emp, row.employeeName)
    excelRow.getCell(4).value = deptOf(row.emp)
    excelRow.getCell(5).value = row.line.amount
    excelRow.getCell(5).numFmt = '#,##0.00'
    if (showIban) {
      excelRow.getCell(6).value = row.emp ? primaryBankName(row.emp, bankLocale) : ''
      excelRow.getCell(7).value = missingIban ? '—' : row.emp ? primaryIbanDisplay(row.emp) : '—'
      excelRow.getCell(8).value = missingIban ? '' : ibanRaw
      excelRow.getCell(9).value = ''
    } else {
      excelRow.getCell(6).value = ''
    }
    for (let c = 1; c <= headers.length; c++) {
      const cell = excelRow.getCell(c)
      cell.border = thinBorder()
      if (showIban && c === 8 && !missingIban) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COPY_BG } }
        cell.font = { name: 'Consolas', size: 10 }
      } else if (missingIban && (c === 7 || c === 8)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_BG } }
        cell.font = { color: { argb: WARN_FG } }
      } else if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } }
      }
    }
    rowNum++
  })

  const dataEnd = rowNum - 1
  if (dataEnd >= headerRow) {
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: dataEnd, column: headers.length },
    }
  }

  const totalRow = ws.getRow(rowNum)
  ws.mergeCells(rowNum, 1, rowNum, 4)
  totalRow.getCell(1).value = t(locale, 'fin.bankTransfer.total')
  totalRow.getCell(5).value = total
  totalRow.getCell(5).numFmt = '#,##0.00'
  totalRow.getCell(5).font = { bold: true }
  totalRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } }

  // Лист для быстрого копирования счетов (жёлтая колонка — один клик + Ctrl+C)
  if (showIban) {
    const copyWs = wb.addWorksheet(t(locale, 'fin.bankTransfer.copySheet').slice(0, 31), {
      views: [{ showGridLines: true }],
    })
    copyWs.columns = [{ width: 32 }, { width: 36 }, { width: 24 }]
    copyWs.getCell('A1').value = t(locale, 'fin.bankTransfer.copySheetTitle')
    copyWs.getCell('A1').font = { bold: true, size: 12 }
    copyWs.mergeCells('A1:C1')
    copyWs.getCell('A2').value = t(locale, 'fin.bankTransfer.copySheetHint')
    copyWs.mergeCells('A2:C2')
    copyWs.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } }

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
    for (const row of rows) {
      const raw = row.emp ? primaryIbanRaw(row.emp) : ''
      if (!raw) continue
      copyWs.getRow(cr).getCell(1).value = nameRu(row.emp, row.employeeName)
      const ibanCell = copyWs.getRow(cr).getCell(2)
      ibanCell.value = raw
      ibanCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COPY_BG } }
      ibanCell.font = { name: 'Consolas', size: 11 }
      copyWs.getRow(cr).getCell(3).value = row.emp ? primaryBankName(row.emp, bankLocale) : ''
      cr++
    }
    if (cr > ch + 1) {
      copyWs.autoFilter = {
        from: { row: ch, column: 1 },
        to: { row: cr - 1, column: 3 },
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  downloadXlsx(buffer as ArrayBuffer, `${doc.number}.xlsx`)
}
