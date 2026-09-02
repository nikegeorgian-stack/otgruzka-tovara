type ExcelJsModule = typeof import('exceljs')

let cached: ExcelJsModule | null = null

export async function loadExcelJs(): Promise<ExcelJsModule> {
  if (!cached) cached = await import('exceljs')
  return cached
}
