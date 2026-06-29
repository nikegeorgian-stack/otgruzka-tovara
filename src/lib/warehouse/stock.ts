import type {
  ItemBalance,
  StockMovement,
  StockMovementType,
  TurnoverRow,
  WarehouseItem,
  WarehouseStore,
} from './types'

export function movementDelta(type: StockMovementType, quantity: number): number {
  const q = Math.abs(quantity)
  if (type === 'receipt') return q
  if (type === 'issue') return -q
  if (type === 'reserve') return 0
  if (type === 'unreserve') return 0
  return quantity
}

export function toBaseQty(item: WarehouseItem, qty: number, inputUnit?: string): number {
  if (!inputUnit || inputUnit === item.unit) return qty
  const conv = item.unitConversions?.find((c) => c.unit === inputUnit)
  return conv ? qty * conv.factor : qty
}

export function computeItemBalance(
  itemId: string,
  movements: StockMovement[],
  warehouseId?: string,
): ItemBalance {
  let receipt = 0
  let issue = 0
  let adjustment = 0
  let reserved = 0
  for (const m of movements) {
    if (m.itemId !== itemId) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    if (m.type === 'receipt') receipt += Math.abs(m.quantity)
    else if (m.type === 'issue') issue += Math.abs(m.quantity)
    else if (m.type === 'adjustment' || m.type === 'inventory') adjustment += m.quantity
    else if (m.type === 'reserve') reserved += Math.abs(m.quantity)
    else if (m.type === 'unreserve') reserved -= Math.abs(m.quantity)
  }
  reserved = Math.max(0, reserved)
  const balance = receipt - issue + adjustment
  return {
    itemId,
    receipt,
    issue,
    adjustment,
    reserved,
    balance,
    available: balance - reserved,
  }
}

export function computeAllBalances(
  warehouse: WarehouseStore,
  warehouseId?: string,
): Map<string, ItemBalance> {
  const map = new Map<string, ItemBalance>()
  for (const item of warehouse.items) {
    map.set(item.id, computeItemBalance(item.id, warehouse.movements, warehouseId))
  }
  return map
}

export function lowStockItems(
  items: WarehouseItem[],
  balances: Map<string, ItemBalance>,
): WarehouseItem[] {
  return items.filter((item) => {
    if (!item.active || item.minStock == null) return false
    return (balances.get(item.id)?.available ?? 0) < item.minStock
  })
}

export function turnoverForPeriod(
  warehouse: WarehouseStore,
  from: string,
  to: string,
  warehouseId?: string,
): TurnoverRow[] {
  const map = new Map<string, TurnoverRow>()
  for (const m of warehouse.movements) {
    if (m.date < from || m.date > to) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    if (m.type !== 'receipt' && m.type !== 'issue') continue
    const row = map.get(m.itemId) ?? { itemId: m.itemId, receipt: 0, issue: 0, net: 0 }
    if (m.type === 'receipt') row.receipt += Math.abs(m.quantity)
    else row.issue += Math.abs(m.quantity)
    row.net = row.receipt - row.issue
    map.set(m.itemId, row)
  }
  return [...map.values()].sort((a, b) => b.issue - a.issue)
}

export function itemStockValue(item: WarehouseItem, balance: number): number {
  if (!item.price) return 0
  return balance * item.price
}

/**
 * Средневзвешенная себестоимость единицы по приходам, у которых указана цена.
 * Возвращает undefined, если цен в приходах нет.
 */
export function avgCostForItem(
  movements: StockMovement[],
  itemId: string,
  warehouseId?: string,
): number | undefined {
  let qty = 0
  let cost = 0
  for (const m of movements) {
    if (m.itemId !== itemId) continue
    if (m.type !== 'receipt') continue
    if (m.unitCost == null) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    const q = Math.abs(m.quantity)
    qty += q
    cost += q * m.unitCost
  }
  return qty > 0 ? cost / qty : undefined
}

/** Стоимость остатка с учётом средневзвешенной себестоимости (фолбэк — статичная цена). */
export function itemStockValueSmart(
  item: WarehouseItem,
  balance: number,
  movements: StockMovement[],
  warehouseId?: string,
): number {
  const avg = avgCostForItem(movements, item.id, warehouseId)
  const unit = avg ?? item.price ?? 0
  return balance * unit
}

export type PriceHistoryRow = {
  date: string
  unitCost: number
  quantity: number
  documentNo?: string
}

/** История цен прихода по позиции (новые сверху). */
export function priceHistoryForItem(
  movements: StockMovement[],
  itemId: string,
): PriceHistoryRow[] {
  return movements
    .filter((m) => m.itemId === itemId && m.type === 'receipt' && m.unitCost != null)
    .map((m) => ({
      date: m.date,
      unitCost: m.unitCost as number,
      quantity: Math.abs(m.quantity),
      documentNo: m.documentNo,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export type ExpiringBatchRow = {
  itemId: string
  name: string
  batchNo?: string
  expiryDate: string
  quantity: number
  daysLeft: number
}

/**
 * Партии приходов со сроком годности, истекающим в ближайшие `withinDays` дней
 * (включая уже просроченные). Информативно по приходам.
 */
export function expiringBatches(
  movements: StockMovement[],
  items: WarehouseItem[],
  withinDays: number,
  today = new Date().toISOString().slice(0, 10),
): ExpiringBatchRow[] {
  const nameById = new Map(items.map((i) => [i.id, i.name]))
  const todayMs = new Date(today).getTime()
  const rows: ExpiringBatchRow[] = []
  for (const m of movements) {
    if (m.type !== 'receipt' || !m.expiryDate) continue
    const daysLeft = Math.round((new Date(m.expiryDate).getTime() - todayMs) / 86_400_000)
    if (daysLeft > withinDays) continue
    rows.push({
      itemId: m.itemId,
      name: nameById.get(m.itemId) ?? m.itemId,
      batchNo: m.batchNo,
      expiryDate: m.expiryDate,
      quantity: Math.abs(m.quantity),
      daysLeft,
    })
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft)
}

export type ReorderRow = {
  item: WarehouseItem
  available: number
  minStock: number
  /** Сколько докупить, чтобы выйти на минимум (>= 0). */
  suggested: number
}

/**
 * Позиции к пополнению: доступно ниже минимума. Отсортированы по «глубине дефицита»
 * (насколько сильно ниже минимума), чтобы кладовщик видел самое критичное сверху.
 */
export function computeReorderRows(
  items: WarehouseItem[],
  balances: Map<string, ItemBalance>,
): ReorderRow[] {
  const rows: ReorderRow[] = []
  for (const item of items) {
    if (!item.active || item.minStock == null) continue
    const available = balances.get(item.id)?.available ?? 0
    if (available >= item.minStock) continue
    rows.push({
      item,
      available,
      minStock: item.minStock,
      suggested: Math.max(0, item.minStock - available),
    })
  }
  return rows.sort((a, b) => a.available - a.minStock - (b.available - b.minStock))
}

export type CategoryValueRow = {
  categoryId: string
  name: string
  value: number
  positions: number
}

/** Стоимость склада в разбивке по категориям (по убыванию суммы). */
export function valueByCategory(
  warehouse: WarehouseStore,
  balances: Map<string, ItemBalance>,
  warehouseId?: string,
): CategoryValueRow[] {
  const catName = new Map(warehouse.categories.map((c) => [c.id, c.name]))
  const map = new Map<string, CategoryValueRow>()
  for (const item of warehouse.items) {
    if (!item.active) continue
    if (warehouseId && item.warehouseId !== warehouseId) continue
    const value = itemStockValueSmart(
      item,
      balances.get(item.id)?.balance ?? 0,
      warehouse.movements,
      warehouseId,
    )
    const row = map.get(item.categoryId) ?? {
      categoryId: item.categoryId,
      name: catName.get(item.categoryId) ?? '—',
      value: 0,
      positions: 0,
    }
    row.value += value
    row.positions += 1
    map.set(item.categoryId, row)
  }
  return [...map.values()].sort((a, b) => b.value - a.value)
}

export function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

export function findItemBySkuOrBarcode(
  items: WarehouseItem[],
  query: string,
): WarehouseItem | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return items.find(
    (i) =>
      i.active &&
      (i.internalCode?.toLowerCase() === q ||
        i.sku?.toLowerCase() === q ||
        i.barcode?.toLowerCase() === q ||
        i.name.toLowerCase().includes(q)),
  )
}

export type IssueShortage = {
  itemId: string
  name: string
  requested: number
  available: number
}

/** Проверка расхода: сумма по строкам не должна превышать доступный остаток */
export function validateIssueLines(
  items: WarehouseItem[],
  balances: Map<string, ItemBalance>,
  lines: { itemId: string; quantity: number }[],
): { ok: true } | { ok: false; shortages: IssueShortage[] } {
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const requestedByItem = new Map<string, number>()
  for (const line of lines) {
    if (line.quantity <= 0) continue
    requestedByItem.set(
      line.itemId,
      (requestedByItem.get(line.itemId) ?? 0) + line.quantity,
    )
  }
  const shortages: IssueShortage[] = []
  for (const [itemId, requested] of requestedByItem) {
    const available = balances.get(itemId)?.available ?? 0
    if (requested > available + 1e-9) {
      shortages.push({
        itemId,
        name: itemMap.get(itemId)?.name ?? itemId,
        requested,
        available,
      })
    }
  }
  return shortages.length === 0 ? { ok: true } : { ok: false, shortages }
}

export function formatIssueShortages(shortages: IssueShortage[]): string {
  return shortages
    .map((s) => `${s.name}: ${formatQty(s.requested)} (доступно ${formatQty(s.available)})`)
    .join('; ')
}
