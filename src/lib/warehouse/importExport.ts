import type { WorkSheet } from 'xlsx'
import { loadXlsx } from '@/lib/lazy/xlsx'
import { appendWarehouseAudit } from './audit'
import type { StockMovement, WarehouseItem, WarehouseStore } from './types'

export type ImportResult = {
  movementsAdded: number
  itemsMatched: number
  sheetsProcessed: number
  warnings: string[]
}

export type WarehouseImportErrorCode = 'emptyWorkbook' | 'noData' | 'readFailed'

export function warehouseImportError(code: WarehouseImportErrorCode): Error {
  const err = new Error(code)
  ;(err as Error & { code: WarehouseImportErrorCode }).code = code
  return err
}

export function isWarehouseImportError(err: unknown): err is Error & { code: WarehouseImportErrorCode } {
  return err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string'
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function findItemByName(items: WarehouseItem[], name: string): WarehouseItem | undefined {
  const n = normName(name)
  const exact = items.find((i) => normName(i.name) === n)
  if (exact) return exact
  return items.find((i) => normName(i.name).includes(n) || n.includes(normName(i.name)))
}

function isCategoryHeader(name: string, row: unknown[]): boolean {
  if (!name) return true
  if (row[1] || row[2]) return false
  if (/^\d+$/.test(name.replace(/\s/g, ''))) return false
  return name.length < 35 && !/\d+\*\d+/.test(name) && name === name.toUpperCase()
}

function parseSheetMovements(
  xlsx: Awaited<ReturnType<typeof loadXlsx>>,
  ws: WorkSheet,
  sheetName: string,
  items: WarehouseItem[],
  warehouseId: string,
  warnings: string[],
): Omit<StockMovement, 'id' | 'createdAt'>[] {
  const data = xlsx.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  })
  if (data.length < 5) return []

  const headerRow = data[1] ?? data[2]
  const dateCols: { col: number; date: string }[] = []
  if (headerRow) {
    for (let c = 3; c < headerRow.length; c++) {
      const v = headerRow[c]
      if (v != null && typeof v === 'object' && (v as unknown) instanceof Date) {
        dateCols.push({
          col: c,
          date: (v as Date).toISOString().slice(0, 10),
        })
      }
    }
  }

  const out: Omit<StockMovement, 'id' | 'createdAt'>[] = []
  const monthFallback = sheetName.replace(/[^\d]/g, '').padStart(2, '0')
  const year = new Date().getFullYear()
  const defaultDate = `${year}-${monthFallback || '01'}-01`

  for (let r = 4; r < data.length; r++) {
    const row = data[r] ?? []
    const rawName = row[0]
    if (typeof rawName !== 'string' || !rawName.trim()) continue
    const name = rawName.trim()
    if (isCategoryHeader(name, row)) continue

    const item = findItemByName(items, name)
    if (!item) {
      warnings.push(`Не найдено: ${name.slice(0, 40)} (${sheetName})`)
      continue
    }

    if (dateCols.length) {
      for (const { col, date } of dateCols) {
        const val = row[col]
        const qty = typeof val === 'number' ? val : Number(String(val ?? '').replace(',', '.'))
        if (!qty || qty <= 0) continue
        out.push({
          itemId: item.id,
          warehouseId,
          type: 'receipt',
          quantity: qty,
          date,
          comment: `Импорт: ${sheetName}`,
          documentNo: sheetName,
        })
      }
    } else {
      let sum = 0
      for (let c = 3; c < row.length; c++) {
        const val = row[c]
        if (typeof val === 'number' && val > 0) sum += val
      }
      if (sum > 0) {
        out.push({
          itemId: item.id,
          warehouseId,
          type: 'receipt',
          quantity: sum,
          date: defaultDate,
          comment: `Импорт (итого): ${sheetName}`,
          documentNo: sheetName,
        })
      }
    }
  }
  return out
}

export async function importWarehouseFromExcel(
  file: File,
  store: WarehouseStore,
  warehouseId?: string,
): Promise<{ store: WarehouseStore; result: ImportResult }> {
  const XLSX = await loadXlsx()
  let wb: import('xlsx').WorkBook
  try {
    const buf = await file.arrayBuffer()
    wb = XLSX.read(buf, { type: 'array', cellDates: true })
  } catch {
    throw warehouseImportError('readFailed')
  }
  if (!wb.SheetNames.length) {
    throw warehouseImportError('emptyWorkbook')
  }
  const whId = warehouseId ?? store.locations[0]?.id ?? ''
  const warnings: string[] = []
  const pending: Omit<StockMovement, 'id' | 'createdAt'>[] = []
  let sheetsProcessed = 0

  for (const name of wb.SheetNames) {
    if (/лист5|расход/i.test(name) && !/приход/i.test(name)) continue
    const ws = wb.Sheets[name]
    if (!ws) continue
    const chunk = parseSheetMovements(XLSX, ws, name, store.items, whId, warnings)
    if (chunk.length) {
      pending.push(...chunk)
      sheetsProcessed++
    }
  }

  const createdAt = new Date().toISOString()
  const movements: StockMovement[] = pending.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    createdAt,
  }))

  const matchedItems = new Set(movements.map((m) => m.itemId))

  let next: WarehouseStore = {
    ...store,
    movements: [...store.movements, ...movements],
  }
  next = appendWarehouseAudit(next, {
    action: 'import',
    detail: `Excel: +${movements.length} операций, листов ${sheetsProcessed}`,
  })

  if (movements.length === 0) {
    if (warnings.length === 0) {
      throw warehouseImportError('noData')
    }
    return {
      store,
      result: {
        movementsAdded: 0,
        itemsMatched: 0,
        sheetsProcessed,
        warnings: warnings.slice(0, 30),
      },
    }
  }

  return {
    store: next,
    result: {
      movementsAdded: movements.length,
      itemsMatched: matchedItems.size,
      sheetsProcessed,
      warnings: warnings.slice(0, 30),
    },
  }
}

export async function exportWarehouseBalancesExcel(
  store: WarehouseStore,
  balances: Map<string, import('./types').ItemBalance>,
  warehouseId?: string,
): Promise<void> {
  const XLSX = await loadXlsx()
  const loc = warehouseId
    ? store.locations.find((l) => l.id === warehouseId)?.name
    : 'Все склады'
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const rows: (string | number)[][] = [
    ['Категория', 'Наименование', 'Ед.', 'Приход', 'Расход', 'Резерв', 'Остаток', 'Доступно', 'Цена', 'Сумма'],
  ]

  for (const item of store.items.filter((i) => i.active)) {
    if (warehouseId && item.warehouseId !== warehouseId) continue
    const b = balances.get(item.id)
    if (!b) continue
    rows.push([
      catMap.get(item.categoryId) ?? '',
      item.name,
      item.unit,
      b.receipt,
      b.issue,
      b.reserved,
      b.balance,
      b.available,
      item.price ?? '',
      item.price ? Math.round(b.balance * item.price * 100) / 100 : '',
    ])
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, (loc ?? 'Остатки').slice(0, 31))
  XLSX.writeFile(wb, `fibercell-sklad-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const today = () => new Date().toISOString().slice(0, 10)

export async function exportWarehouseReorderExcel(
  store: WarehouseStore,
  rows: { item: WarehouseItem; available: number; minStock: number; suggested: number }[],
): Promise<void> {
  const XLSX = await loadXlsx()
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const locMap = new Map(store.locations.map((l) => [l.id, l.name]))
  const aoa: (string | number)[][] = [
    ['Категория', 'Наименование', 'Склад', 'Ед.', 'Доступно', 'Минимум', 'Докупить'],
  ]
  for (const r of rows) {
    aoa.push([
      catMap.get(r.item.categoryId) ?? '',
      r.item.name,
      locMap.get(r.item.warehouseId) ?? '',
      r.item.unit,
      r.available,
      r.minStock,
      r.suggested,
    ])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'К пополнению')
  XLSX.writeFile(wb, `fibercell-popolnenie-${today()}.xlsx`)
}

export async function exportWarehouseTurnoverExcel(
  store: WarehouseStore,
  rows: { itemId: string; receipt: number; issue: number; net: number }[],
  period: { from: string; to: string },
): Promise<void> {
  const XLSX = await loadXlsx()
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const aoa: (string | number)[][] = [
    [`Обороты ${period.from} — ${period.to}`],
    ['Категория', 'Наименование', 'Ед.', 'Приход', 'Расход', 'Итого'],
  ]
  for (const r of rows) {
    const item = itemMap.get(r.itemId)
    aoa.push([
      item ? catMap.get(item.categoryId) ?? '' : '',
      item?.name ?? r.itemId,
      item?.unit ?? '',
      r.receipt,
      r.issue,
      r.net,
    ])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Обороты')
  XLSX.writeFile(wb, `fibercell-oboroty-${today()}.xlsx`)
}

export async function exportWarehouseAuditExcel(
  entries: { at: string; action: string; detail: string }[],
  labelFor: (action: string) => string,
): Promise<void> {
  const XLSX = await loadXlsx()
  const aoa: (string | number)[][] = [['Когда', 'Действие', 'Детали']]
  for (const e of entries) {
    aoa.push([e.at.slice(0, 16).replace('T', ' '), labelFor(e.action), e.detail])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Журнал')
  XLSX.writeFile(wb, `fibercell-audit-${today()}.xlsx`)
}
