export type ExcelAdapterErrorCode =
  | 'unsupported_extension'
  | 'file_too_large'
  | 'empty_workbook'
  | 'corrupt_workbook'
  | 'encrypted_workbook'
  | 'limits_exceeded'
  | 'read_failed'

/** Formula text is optional metadata only — NEVER execute formulas. */
export type SheetCellValue = {
  v: unknown
  link?: string
  formula?: string
}

export type SheetView = {
  name: string
  rowCount: number
  colCount: number
  /** 0-based row/col. Merged coverage is best-effort via exceljs master cell. */
  cell(r0: number, c0: number): SheetCellValue
  toAoA(): unknown[][]
}

export type WorkbookView = {
  sheetNames: string[]
  sheet(name: string): SheetView | null
  sheets(): SheetView[]
}

export class ExcelAdapterError extends Error {
  readonly code: ExcelAdapterErrorCode

  constructor(code: ExcelAdapterErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ExcelAdapterError'
    this.code = code
  }
}

export function isExcelAdapterError(err: unknown): err is ExcelAdapterError {
  return err instanceof ExcelAdapterError
}
