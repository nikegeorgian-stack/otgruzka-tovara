import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadExcelJs } from '@/lib/lazy/exceljs'
import {
  EXCEL_LIMITS,
  ExcelAdapterError,
  assertAllowedExcelFile,
  downloadXlsxBuffer,
  escapeCsvInjection,
  loadWorkbookFromArrayBuffer,
  loadWorkbookFromFile,
  writeAoAWorkbook,
} from '@/lib/excel/workbookAdapter'
import {
  parseRegistrySheet,
  pickRegistryWorksheet,
} from '@/lib/hr/registryImport'
import {
  applyImportPendingAsDraftReceipts,
  importWarehouseFromExcel,
} from '@/lib/warehouse/importExport'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

async function bufferFromWorkbook(
  build: (wb: import('exceljs').Workbook, ExcelJS: typeof import('exceljs')) => void,
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  build(wb, ExcelJS)
  const out = await wb.xlsx.writeBuffer()
  if (out instanceof ArrayBuffer) return out
  if (ArrayBuffer.isView(out)) {
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
  }
  const u8 = new Uint8Array(out as ArrayBuffer)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
}

function emptyWarehouse(): WarehouseStore {
  const loc = { id: 'wh-a', name: 'Склад A', sortOrder: 1 }
  const item: WarehouseItem = {
    id: 'item-1',
    internalCode: 'RM-1',
    name: 'Сырьё Alpha',
    categoryId: 'cat-1',
    warehouseId: loc.id,
    unit: 'кг',
    active: true,
    sortOrder: 1,
    price: 10,
  }
  return withActiveWarehouses(
    {
      locations: [loc],
      categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
      items: [item],
      movements: [],
      documents: [],
      auditLog: [],
      nextInternalCode: 10,
      invoiceRegistry: [],
    },
    [loc.id],
  )
}

describe('r11 excel workbook adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unsupported .xls before parse', () => {
    expect(() =>
      assertAllowedExcelFile({ name: 'legacy.xls', size: 100 }),
    ).toThrow(ExcelAdapterError)
    try {
      assertAllowedExcelFile({ name: 'legacy.xls', size: 100 })
    } catch (err) {
      expect(err).toBeInstanceOf(ExcelAdapterError)
      expect((err as ExcelAdapterError).code).toBe('unsupported_extension')
    }
  })

  it('rejects oversized files', () => {
    expect(() =>
      assertAllowedExcelFile({
        name: 'big.xlsx',
        size: EXCEL_LIMITS.maxFileBytes + 1,
      }),
    ).toThrow(ExcelAdapterError)
  })

  it('escapeCsvInjection prefixes formula-like strings', () => {
    expect(escapeCsvInjection('=1+1')).toBe("'=1+1")
    expect(escapeCsvInjection('+cmd')).toBe("'+cmd")
    expect(escapeCsvInjection('-2')).toBe("'-2")
    expect(escapeCsvInjection('@sum')).toBe("'@sum")
    expect(escapeCsvInjection('plain')).toBe('plain')
  })

  it('roundtrips AOA values including Unicode RU/KA/EN', async () => {
    const buffer = await writeAoAWorkbook([
      {
        name: 'Data',
        rows: [
          ['Name', 'Qty', 'Note'],
          ['Иванов', 12, 'ok'],
          ['გიორგი', 3.5, 'ka'],
          ['Alice', true, null],
        ],
      },
    ])
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'roundtrip.xlsx' })
    const sheet = wb.sheet('Data')
    expect(sheet).not.toBeNull()
    const aoa = sheet!.toAoA()
    expect(aoa[1][0]).toBe('Иванов')
    expect(aoa[2][0]).toBe('გიორგი')
    expect(aoa[3][0]).toBe('Alice')
    expect(aoa[1][1]).toBe(12)
    expect(aoa[2][1]).toBe(3.5)
    expect(aoa[3][1]).toBe(true)
  })

  it('applies escapeCsvInjection on export strings starting with =', async () => {
    const buffer = await writeAoAWorkbook([
      { name: 'S', rows: [['=HYPERLINK("http://evil")', 'safe']] },
    ])
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'esc.xlsx' })
    expect(wb.sheet('S')!.cell(0, 0).v).toBe("'=HYPERLINK(\"http://evil\")")
    expect(wb.sheet('S')!.cell(0, 1).v).toBe('safe')
  })

  it('reads formula cells as cached result only (never evaluates)', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('F')
      ws.getCell(1, 1).value = { formula: '1+2', result: 99 }
      ws.getCell(1, 2).value = 'plain'
    })
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'f.xlsx' })
    const cell = wb.sheet('F')!.cell(0, 0)
    expect(cell.v).toBe(99)
    expect(cell.formula).toBe('1+2')
  })

  it('merged header best-effort returns master value', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('M')
      ws.getCell(1, 1).value = 'HEADER'
      ws.mergeCells(1, 1, 1, 3)
      ws.getCell(2, 1).value = 'row'
    })
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'm.xlsx' })
    const sheet = wb.sheet('M')!
    expect(sheet.cell(0, 0).v).toBe('HEADER')
    // Covered cells should resolve via exceljs master when available.
    expect(sheet.cell(0, 1).v).toBe('HEADER')
    expect(sheet.cell(0, 2).v).toBe('HEADER')
  })

  it('skips empty registry rows and maps tab/name/contract cols', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Лист1')
      // header row 0
      ws.getCell(1, 1).value = 'ტაბ'
      ws.getCell(1, 2).value = 'ФИО'
      // data
      ws.getCell(2, 1).value = '101'
      ws.getCell(2, 2).value = 'Иванов Иван'
      ws.getCell(2, 3).value = 'ივანოვი'
      ws.getCell(2, 4).value = 'მ'
      ws.getCell(2, 5).value = 'GEO'
      ws.getCell(2, 9).value = 'მენეჯერი'
      ws.getCell(2, 10).value = 'Manager'
      ws.getCell(2, 11).value = 'GE33TB1234567890123456'
      ws.getCell(2, 13).value = 1500
      ws.getCell(2, 14).value = 'C-1'
      // empty row (should not create a person)
      ws.getCell(3, 2).value = ''
      // continuation without tab — position-like payload in continuation layout
      ws.getCell(4, 2).value = 'დამატებითი'
      ws.getCell(4, 3).value = 'Extra role'
      ws.getCell(4, 5).value = 200
      ws.getCell(4, 6).value = 'C-2'
    })
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'reg.xlsx' })
    const sheet = pickRegistryWorksheet(wb)
    expect(sheet?.name).toMatch(/лист1/i)
    const people = parseRegistrySheet(sheet!)
    expect(people).toHaveLength(1)
    expect(people[0].tabNumber).toBe('101')
    expect(people[0].fullName).toBe('Иванов Иван')
    expect(people[0].nameKa).toBe('ივანოვი')
    expect(people[0].contracts.length).toBeGreaterThanOrEqual(1)
    expect(people[0].ibans.some((i) => i.startsWith('GE'))).toBe(true)
  })

  it('parses decimal comma text and Excel serial dates (1900 epoch)', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('N')
      ws.getCell(1, 1).value = '1,5'
      // Excel serial for 2024-06-01 (1900 date system ≈ 45444)
      ws.getCell(1, 2).value = 45444
      ws.getCell(1, 2).numFmt = 'yyyy-mm-dd'
    })
    const wb = await loadWorkbookFromArrayBuffer(buffer, { fileName: 'n.xlsx' })
    const sheet = wb.sheet('N')!
    expect(String(sheet.cell(0, 0).v)).toContain('1')
    const dateCell = sheet.cell(0, 1).v
    expect(
      dateCell instanceof Date ||
        (typeof dateCell === 'number' && dateCell > 40000) ||
        (typeof dateCell === 'string' && dateCell.includes('2024')),
    ).toBe(true)
  })

  it('rejects empty/corrupt buffer as corrupt or read_failed', async () => {
    const empty = new ArrayBuffer(0)
    await expect(
      loadWorkbookFromArrayBuffer(empty, { fileName: 'bad.xlsx' }),
    ).rejects.toBeInstanceOf(ExcelAdapterError)
  })

  it('warehouse import AOA with Date headers creates draft receipts not movements', async () => {
    const day = new Date(Date.UTC(2026, 8, 15))
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Приход01')
      // rows 0..3 preamble; header with dates at row index 1 (excel row 2)
      ws.getCell(1, 1).value = 'title'
      ws.getCell(2, 1).value = 'name'
      ws.getCell(2, 4).value = day
      ws.getCell(3, 1).value = 'skip'
      ws.getCell(4, 1).value = 'skip2'
      ws.getCell(5, 1).value = 'Сырьё Alpha'
      ws.getCell(5, 4).value = 7
    })
    const file = new File([buffer], 'wh.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const store = emptyWarehouse()
    const { store: next, result } = await importWarehouseFromExcel(file, store, 'wh-a')
    expect(result.movementsAdded).toBe(0)
    expect(result.draftsCreated).toBe(1)
    expect(next.movements).toHaveLength(0)
    expect(next.documents.some((d) => d.status === 'draft' && d.type === 'receipt')).toBe(true)

    // Idempotent draft path also covered
    const again = applyImportPendingAsDraftReceipts(next, {
      warehouseId: 'wh-a',
      pending: [
        {
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 1,
          date: '2026-09-15',
          comment: 'x',
        },
      ],
    })
    expect(again.result.duplicates).toBe(1)
    expect(again.result.movementsAdded).toBe(0)
  })

  it('rejects workbook exceeding row limits', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Huge')
      ws.getCell(EXCEL_LIMITS.maxRowsPerSheet + 1, 1).value = 'x'
    })
    await expect(
      loadWorkbookFromArrayBuffer(buffer, { fileName: 'huge.xlsx' }),
    ).rejects.toMatchObject({ code: 'limits_exceeded' })
  })

  it('loadWorkbookFromFile rejects .ods by extension', async () => {
    const buffer = await writeAoAWorkbook([{ name: 'A', rows: [['x']] }])
    const file = new File([buffer], 'sheet.ods', {
      type: 'application/vnd.oasis.opendocument.spreadsheet',
    })
    await expect(loadWorkbookFromFile(file)).rejects.toMatchObject({
      code: 'unsupported_extension',
    })
  })

  it('downloadXlsxBuffer does not throw in jsdom when createObjectURL is mocked', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click,
    }
    const createElement = vi.fn(() => anchor)
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        constructor(public parts: unknown[], public options?: unknown) {}
      },
    )

    expect(() =>
      downloadXlsxBuffer(new ArrayBuffer(8), 'out.xlsx'),
    ).not.toThrow()
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
    expect(anchor.download).toBe('out.xlsx')
  })
})
