import { t, tf } from '@/i18n'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { loadBrandLogoPng } from '@/lib/export/brandLogoPng'
import { loadExcelJs } from '@/lib/lazy/exceljs'
import type { OfficeStaffFieldId } from './staffListFields'

const ACCENT = 'FFFF5500'
const INK = 'FF1A1A1A'
const MUTED = 'FF6B7280'
const HEADER_BG = 'FFFFF5F0'
const HEADER_FG = 'FF9A3412'
const BORDER = 'FFE5E7EB'
const ROW_ALT = 'FFFAFAF9'

const HEADER_ROW = 6

const FIELD_WIDTH: Record<OfficeStaffFieldId, number> = {
  fullName: 28,
  nameKa: 28,
  tabNumber: 12,
  employeeNumber: 14,
  position: 22,
  unit: 22,
  brigade: 16,
  status: 14,
  phone: 16,
  email: 26,
  personalId: 16,
  address: 32,
  citizenship: 16,
  birthDate: 14,
  hireDate: 14,
  schedule: 16,
  gender: 10,
}

export function officeStaffExcelColumnWidths(fields: readonly OfficeStaffFieldId[]): number[] {
  return [5, ...fields.map((id) => FIELD_WIDTH[id] ?? 16)]
}

function thinBorder() {
  return {
    top: { style: 'thin' as const, color: { argb: BORDER } },
    left: { style: 'thin' as const, color: { argb: BORDER } },
    bottom: { style: 'thin' as const, color: { argb: BORDER } },
    right: { style: 'thin' as const, color: { argb: BORDER } },
  }
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

export async function exportOfficeStaffExcel(opts: {
  headers: string[]
  rows: string[][]
  fields: readonly OfficeStaffFieldId[]
  filename: string
  locale: Locale
  site: string
}): Promise<void> {
  const { headers, rows, fields, filename, locale, site } = opts
  const colCount = 1 + headers.length
  const ExcelJS = await loadExcelJs()
  const logo = await loadBrandLogoPng()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FiberCell Otgruzka'
  wb.created = new Date()

  const sheetName = t(locale, 'office.excel.sheetName').slice(0, 31)
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.25 },
    },
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  })
  ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`
  ws.headerFooter = {
    oddFooter: `&L${t(locale, 'office.printTitle')}&C&P / &N&R${site || 'FiberCell'}`,
  }

  const widths = officeStaffExcelColumnWidths(fields)
  while (widths.length < colCount) widths.push(16)
  ws.columns = widths.slice(0, colCount).map((width) => ({ width }))

  if (logo) {
    const imageId = wb.addImage({ base64: logo.base64, extension: 'png' })
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 44, height: 44 } })
  }

  const lastCol = colCount
  ws.mergeCells(1, 2, 1, lastCol)
  ws.getCell(1, 2).value = site.trim() || 'FiberCell'
  ws.getCell(1, 2).font = { name: 'Georgia', size: 13, bold: true, color: { argb: INK } }

  ws.mergeCells(2, 1, 2, lastCol)
  ws.getCell(2, 1).value = t(locale, 'office.printTitle')
  ws.getCell(2, 1).font = { name: 'Georgia', size: 16, bold: true, color: { argb: INK } }
  ws.getCell(2, 1).alignment = { horizontal: 'center' }

  const printedAt = new Date().toLocaleString(intlLocale(locale), {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  ws.mergeCells(3, 1, 3, lastCol)
  ws.getCell(3, 1).value = [site, printedAt, tf(locale, 'office.printCount', { n: rows.length })]
    .filter(Boolean)
    .join(' · ')
  ws.getCell(3, 1).font = { size: 10, color: { argb: MUTED } }
  ws.getCell(3, 1).alignment = { horizontal: 'center' }

  ws.mergeCells(4, 1, 4, lastCol)
  ws.getCell(4, 1).value = t(locale, 'office.excel.filterHint')
  ws.getCell(4, 1).font = { size: 9, italic: true, color: { argb: MUTED } }
  ws.getCell(4, 1).alignment = { horizontal: 'center' }

  const headerLabels = [t(locale, 'office.excel.colNo'), ...headers]
  const headerRow = ws.getRow(HEADER_ROW)
  headerLabels.forEach((text, i) => {
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
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 26

  rows.forEach((line, i) => {
    const excelRow = ws.getRow(HEADER_ROW + 1 + i)
    excelRow.getCell(1).value = i + 1
    excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    line.forEach((value, c) => {
      const cell = excelRow.getCell(c + 2)
      cell.value = value || '—'
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    for (let c = 1; c <= colCount; c++) {
      const cell = excelRow.getCell(c)
      cell.border = thinBorder()
      cell.font = { name: 'Calibri', size: 10, color: { argb: INK } }
      if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } }
      }
    }
    excelRow.height = 20
  })

  const lastDataRow = HEADER_ROW + Math.max(rows.length, 1)
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: lastDataRow, column: colCount },
  }
  ws.pageSetup.printArea = `A1:${ws.getRow(Math.max(lastDataRow, HEADER_ROW)).getCell(colCount).address}`

  const buffer = await wb.xlsx.writeBuffer()
  downloadXlsx(buffer as ArrayBuffer, filename)
}
