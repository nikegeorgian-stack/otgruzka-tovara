/**
 * Excel workbook adapter (exceljs).
 *
 * Product contract: import/export of user spreadsheets is **`.xlsx` only**.
 * Legacy `.xls` (BIFF) and `.ods` are rejected before parse — exceljs cannot
 * safely read them. Procurement file *attachments* may still store `.xls`
 * as opaque blobs without parsing.
 */
import { loadExcelJs } from '@/lib/lazy/exceljs'
import { EXCEL_LIMITS } from '@/lib/excel/limits'
import {
  ExcelAdapterError,
  type SheetCellValue,
  type SheetView,
  type WorkbookView,
} from '@/lib/excel/types'

export { EXCEL_LIMITS } from '@/lib/excel/limits'
export {
  ExcelAdapterError,
  isExcelAdapterError,
  type ExcelAdapterErrorCode,
  type SheetCellValue,
  type SheetView,
  type WorkbookView,
} from '@/lib/excel/types'

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const ALLOWED_EXT = '.xlsx'

function fileExtension(name: string): string {
  const base = name.trim().toLowerCase()
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i) : ''
}

/**
 * Reject non-`.xlsx` and oversized files before any parse.
 * Call from UI pickers and loadWorkbookFromFile.
 */
export function assertAllowedExcelFile(file: {
  name: string
  size: number
  type?: string
}): void {
  const ext = fileExtension(file.name)
  if (ext !== ALLOWED_EXT) {
    throw new ExcelAdapterError(
      'unsupported_extension',
      `Only .xlsx is supported (got ${ext || 'no extension'})`,
    )
  }
  if (file.size > EXCEL_LIMITS.maxFileBytes) {
    throw new ExcelAdapterError(
      'file_too_large',
      `File exceeds ${EXCEL_LIMITS.maxFileBytes} bytes`,
    )
  }
}

/** Prefix `'` when value could be interpreted as a spreadsheet formula / CSV injection. */
export function escapeCsvInjection(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`
  return value
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err ?? '')
}

function mapLoadError(err: unknown): ExcelAdapterError {
  if (err instanceof ExcelAdapterError) return err
  const msg = errorMessage(err)
  if (/password|encrypt|encrypted/i.test(msg)) {
    return new ExcelAdapterError('encrypted_workbook', 'Workbook is encrypted')
  }
  if (/corrupt|invalid|zip|central directory|end of central/i.test(msg)) {
    return new ExcelAdapterError('corrupt_workbook', 'Workbook appears corrupt')
  }
  return new ExcelAdapterError('read_failed', 'Failed to read workbook')
}

type ExcelJsCell = {
  value: unknown
  type?: number
  isMerged?: boolean
  master?: { value: unknown; hyperlink?: string }
  hyperlink?: string
  text?: string
}

function excelSerialToDate(serial: number): Date {
  const epoch = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(epoch)
}

function unwrapCellValue(raw: unknown, cell: ExcelJsCell): SheetCellValue {
  const linkFromCell =
    typeof cell.hyperlink === 'string' && cell.hyperlink
      ? cell.hyperlink
      : undefined

  if (raw == null || raw === '') {
    return { v: raw ?? null, link: linkFromCell }
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>

    if ('richText' in obj && Array.isArray(obj.richText)) {
      const text = (obj.richText as { text?: string }[])
        .map((t) => t.text ?? '')
        .join('')
      return { v: text, link: linkFromCell }
    }

    if ('hyperlink' in obj) {
      const href = typeof obj.hyperlink === 'string' ? obj.hyperlink : undefined
      const text =
        typeof obj.text === 'string'
          ? obj.text
          : href
            ? String(href)
            : ''
      // Store href string only — do not follow external links.
      return { v: text, link: href ?? linkFromCell }
    }

    if ('formula' in obj || 'sharedFormula' in obj) {
      const formula =
        typeof obj.formula === 'string'
          ? obj.formula
          : typeof obj.sharedFormula === 'string'
            ? obj.sharedFormula
            : undefined
      // Cached result only — never evaluate.
      const result = 'result' in obj ? obj.result : null
      return { v: result ?? null, formula, link: linkFromCell }
    }

    if ('error' in obj) {
      return { v: null, link: linkFromCell }
    }

    if (raw instanceof Date) {
      return { v: raw, link: linkFromCell }
    }
  }

  // exceljs ValueType.Date often already yields Date; serial numbers may remain.
  if (typeof raw === 'number' && cell.type === 4 /* Date */) {
    const d = excelSerialToDate(raw)
    if (!Number.isNaN(d.getTime())) return { v: d, link: linkFromCell }
  }

  return { v: raw, link: linkFromCell }
}

function readCell(ws: {
  getCell(row: number, col: number): ExcelJsCell
}, r0: number, c0: number): SheetCellValue {
  const cell = ws.getCell(r0 + 1, c0 + 1)
  const source =
    cell.isMerged && cell.master ? cell.master : cell
  const value = source.value
  const linkCarrier = source.hyperlink ? source : cell
  return unwrapCellValue(value, linkCarrier as ExcelJsCell)
}

function sheetDimensions(ws: {
  rowCount: number
  columnCount: number
  actualRowCount?: number
  actualColumnCount?: number
  dimensions?: { top?: number; left?: number; bottom?: number; right?: number } | null
}): { rowCount: number; colCount: number } {
  let rowCount = Math.max(ws.rowCount || 0, ws.actualRowCount || 0)
  let colCount = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0)
  const dim = ws.dimensions
  if (dim && typeof dim.bottom === 'number' && typeof dim.right === 'number') {
    rowCount = Math.max(rowCount, dim.bottom)
    colCount = Math.max(colCount, dim.right)
  }
  return { rowCount, colCount }
}

function wrapSheet(name: string, ws: {
  rowCount: number
  columnCount: number
  actualRowCount?: number
  actualColumnCount?: number
  dimensions?: { top?: number; left?: number; bottom?: number; right?: number } | null
  getCell(row: number, col: number): ExcelJsCell
}): SheetView {
  const { rowCount, colCount } = sheetDimensions(ws)

  const view: SheetView = {
    name,
    rowCount,
    colCount,
    cell(r0: number, c0: number): SheetCellValue {
      if (r0 < 0 || c0 < 0 || r0 >= rowCount || c0 >= colCount) {
        return { v: null }
      }
      return readCell(ws, r0, c0)
    },
    toAoA(): unknown[][] {
      const rows: unknown[][] = []
      for (let r = 0; r < rowCount; r++) {
        const row: unknown[] = []
        for (let c = 0; c < colCount; c++) {
          row.push(view.cell(r, c).v)
        }
        rows.push(row)
      }
      return rows
    },
  }
  return view
}

function assertWorkbookLimits(sheets: SheetView[]): void {
  if (sheets.length > EXCEL_LIMITS.maxSheets) {
    throw new ExcelAdapterError(
      'limits_exceeded',
      `Too many sheets (${sheets.length} > ${EXCEL_LIMITS.maxSheets})`,
    )
  }
  let cells = 0
  for (const s of sheets) {
    if (s.rowCount > EXCEL_LIMITS.maxRowsPerSheet) {
      throw new ExcelAdapterError(
        'limits_exceeded',
        `Sheet "${s.name}" has too many rows`,
      )
    }
    if (s.colCount > EXCEL_LIMITS.maxColsPerSheet) {
      throw new ExcelAdapterError(
        'limits_exceeded',
        `Sheet "${s.name}" has too many columns`,
      )
    }
    cells += s.rowCount * s.colCount
    if (cells > EXCEL_LIMITS.maxCellsTotal) {
      throw new ExcelAdapterError('limits_exceeded', 'Workbook cell budget exceeded')
    }
  }
}

function toWorkbookView(workbook: {
  workbooks?: unknown
  worksheets: { name: string; state?: string }[]
}): WorkbookView {
  const sheets: SheetView[] = []
  for (const ws of workbook.worksheets as Array<{
    name: string
    state?: string
    rowCount: number
    columnCount: number
    actualRowCount?: number
    actualColumnCount?: number
    dimensions?: { top?: number; left?: number; bottom?: number; right?: number } | null
    getCell(row: number, col: number): ExcelJsCell
  }>) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue
    sheets.push(wrapSheet(ws.name, ws))
  }

  if (!sheets.length) {
    throw new ExcelAdapterError('empty_workbook', 'Workbook has no visible sheets')
  }

  assertWorkbookLimits(sheets)

  const byName = new Map(sheets.map((s) => [s.name, s]))
  return {
    sheetNames: sheets.map((s) => s.name),
    sheet(name: string) {
      return byName.get(name) ?? null
    },
    sheets() {
      return sheets.slice()
    },
  }
}

export async function loadWorkbookFromArrayBuffer(
  buf: ArrayBuffer,
  opts?: { fileName?: string },
): Promise<WorkbookView> {
  if (opts?.fileName) {
    assertAllowedExcelFile({ name: opts.fileName, size: buf.byteLength })
  } else if (buf.byteLength > EXCEL_LIMITS.maxFileBytes) {
    throw new ExcelAdapterError('file_too_large')
  }

  if (buf.byteLength === 0) {
    throw new ExcelAdapterError('empty_workbook', 'Empty file')
  }

  try {
    const ExcelJS = await loadExcelJs()
    const workbook = new ExcelJS.Workbook()
    // Do not log file contents.
    await workbook.xlsx.load(buf)
    return toWorkbookView(workbook as never)
  } catch (err) {
    throw mapLoadError(err)
  }
}

export async function loadWorkbookFromFile(file: File): Promise<WorkbookView> {
  assertAllowedExcelFile(file)
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    throw new ExcelAdapterError('read_failed', 'Could not read file bytes')
  }
  return loadWorkbookFromArrayBuffer(buf, { fileName: file.name })
}

export type AoACell = string | number | boolean | null | undefined | Date

export async function writeAoAWorkbook(
  sheets: { name: string; rows: AoACell[][] }[],
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()

  for (const sheet of sheets) {
    const name = (sheet.name || 'Sheet1').slice(0, 31)
    const ws = workbook.addWorksheet(name)
    for (const row of sheet.rows) {
      ws.addRow(
        row.map((cell) => {
          if (typeof cell === 'string') return escapeCsvInjection(cell)
          if (cell === undefined) return null
          return cell
        }),
      )
    }
  }

  const out = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(out as ArrayBuffer)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function downloadXlsxBuffer(buffer: ArrayBuffer, filename: string): void {
  const safeName = filename.toLowerCase().endsWith('.xlsx')
    ? filename
    : `${filename}.xlsx`
  const blob = new Blob([buffer], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = safeName
    a.rel = 'noopener'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
