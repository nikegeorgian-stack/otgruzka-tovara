/**
 * Product Excel contract: **`.xlsx` only** (OOXML).
 * exceljs cannot safely read legacy BIFF `.xls` or `.ods`; UI accept attrs must match.
 */
export const EXCEL_LIMITS = {
  maxFileBytes: 12 * 1024 * 1024,
  maxSheets: 40,
  maxRowsPerSheet: 25_000,
  maxColsPerSheet: 256,
  maxCellsTotal: 1_500_000,
} as const
