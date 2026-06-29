type XlsxModule = typeof import('xlsx')

let cached: XlsxModule | null = null

export async function loadXlsx(): Promise<XlsxModule> {
  if (!cached) cached = await import('xlsx')
  return cached
}
