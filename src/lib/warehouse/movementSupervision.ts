import type { WarehouseStore, WarehouseLocation, WarehouseDocument, StockMovement } from './types'

export type MovementSupervisionKind =
  | 'transfer'
  | 'receipt'
  | 'issue'
  | 'inventory'
  | 'adjustment'
  | 'reserve'
  | 'unreserve'
  | 'other'

export type MovementSupervisionRow = {
  key: string
  kind: MovementSupervisionKind
  itemId: string
  itemName: string
  date: string
  /** Псевдо-направление для UI: откуда пришло/куда ушло */
  fromWarehouseId?: string
  toWarehouseId?: string
  fromWarehouseName?: string
  toWarehouseName?: string
  /** Кол-во “по направлению” (для перемещений: ушло/пришло; для прихода/расхода: вход/выход) */
  qtyAbs: number
  /** Для корректировок: signed delta (+/-) */
  delta?: number
  /** Связанные документы */
  docIssueId?: string
  docReceiptId?: string
  docIds: string[]
  docNumbers: string[]
  docRoles: (string | undefined)[]
}

function locName(locations: WarehouseLocation[], id?: string): string | undefined {
  if (!id) return undefined
  return locations.find((l) => l.id === id)?.name
}

function docForMovement(warehouse: WarehouseStore, movement: StockMovement): WarehouseDocument | undefined {
  if (!movement.documentId) return undefined
  return warehouse.documents.find((d) => d.id === movement.documentId)
}

function kindFromMovement(movement: StockMovement, doc?: WarehouseDocument): MovementSupervisionKind {
  if (doc?.transferPairId) {
    // transfer docs are issue/receipt roles; UI will show kind=transfer at the group level
    return movement.type === 'issue' ? 'transfer' : 'transfer'
  }
  if (doc?.type === 'receipt') return 'receipt'
  if (doc?.type === 'issue') return 'issue'
  if (doc?.type === 'inventory') return 'inventory'

  if (movement.type === 'adjustment') return 'adjustment'
  if (movement.type === 'reserve') return 'reserve'
  if (movement.type === 'unreserve') return 'unreserve'

  return 'other'
}

function transferPairDocs(warehouse: WarehouseStore, transferPairId: string): { issue?: WarehouseDocument; receipt?: WarehouseDocument } {
  const docs = warehouse.documents.filter((d) => d.transferPairId === transferPairId && (d.status ?? 'posted') !== 'cancelled')
  const issue = docs.find((d) => d.docRole === 'transfer_issue')
  const receipt = docs.find((d) => d.docRole === 'transfer_receipt')
  return { issue, receipt }
}

export type MovementSupervisionFilters = {
  itemId: string
  warehouseId?: string | null
  fromDate?: string
  toDate?: string
  asOfIso?: string | null
  /** Для перемещений: фильтр по откуда */
  fromWarehouseId?: string | null
  /** Для перемещений: фильтр по куда */
  toWarehouseId?: string | null
  /** Тип (укрупнённо) */
  kind?: 'all' | MovementSupervisionKind
}

/**
 * “Надзор движения номенклатуры”: откуда→куда + кол-во + привязка к документам.
 * Источник правды: `warehouse.movements` и `warehouse.documents`.
 */
export function buildItemMovementSupervisionRows(warehouse: WarehouseStore, filters: MovementSupervisionFilters): MovementSupervisionRow[] {
  const { itemId, warehouseId, fromDate, toDate, asOfIso, fromWarehouseId, toWarehouseId } = filters
  const item = warehouse.items.find((i) => i.id === itemId)
  if (!item) return []

  const isInRange = (date: string) => {
    if (fromDate && date < fromDate) return false
    if (toDate && date > toDate) return false
    return true
  }

  const movements = warehouse.movements
    .filter((m) => m.itemId === itemId)
    .filter((m) => !warehouseId || m.warehouseId === warehouseId)
    .filter((m) => (!asOfIso ? true : m.createdAt <= asOfIso))
    .filter((m) => isInRange(m.date))

  const transferGroups = new Map<
    string,
    {
      transferPairId: string
      itemId: string
      qtyIn: number
      qtyOut: number
      date: string
      handledMovementIds: Set<string>
    }
  >()

  const singleGroups = new Map<
    string,
    {
      movement: StockMovement
      doc?: WarehouseDocument
    }
  >()

  const handled = new Set<string>()

  for (const m of movements) {
    const doc = docForMovement(warehouse, m)
    const transferPairId = doc?.transferPairId
    const isTransferDoc = Boolean(
      transferPairId && (doc?.docRole === 'transfer_issue' || doc?.docRole === 'transfer_receipt'),
    )

    if (isTransferDoc && transferPairId) {
      const key = `tp:${transferPairId}:${itemId}`
      const g =
        transferGroups.get(key) ??
        ({
          transferPairId,
          itemId,
          qtyIn: 0,
          qtyOut: 0,
          date: m.date,
          handledMovementIds: new Set<string>(),
        } as {
          transferPairId: string
          itemId: string
          qtyIn: number
          qtyOut: number
          date: string
          handledMovementIds: Set<string>
        })
      g.handledMovementIds.add(m.id)
      if (!transferGroups.has(key)) transferGroups.set(key, g)

      const { issue, receipt } = transferPairDocs(warehouse, transferPairId)
      // We derive “direction qty” by which side the current doc belongs to.
      if (doc?.docRole === 'transfer_receipt') {
        g.qtyIn += Math.abs(m.quantity)
      } else if (doc?.docRole === 'transfer_issue') {
        g.qtyOut += Math.abs(m.quantity)
      }
      g.date = receipt?.date ?? issue?.date ?? m.date
      handled.add(m.id)
      continue
    }

    const groupKey = `m:${m.id}`
    singleGroups.set(groupKey, { movement: m, doc })
  }

  const rows: MovementSupervisionRow[] = []

  // Transfer rows
  for (const [key, g] of transferGroups.entries()) {
    const { issue, receipt } = transferPairDocs(warehouse, g.transferPairId)
    const fromId = issue?.warehouseId ?? issue?.targetWarehouseId ?? undefined
    const toId = receipt?.warehouseId ?? receipt?.targetWarehouseId ?? undefined
    const fromName = locName(warehouse.locations, fromId)
    const toName = locName(warehouse.locations, toId)

    const qtyAbs = g.qtyOut > 0 ? g.qtyOut : g.qtyIn

    const docIds = [issue?.id, receipt?.id].filter(Boolean) as string[]
    const docNumbers = [issue?.number, receipt?.number].filter(Boolean) as string[]
    const docRoles = [issue?.docRole, receipt?.docRole]

    const kind: MovementSupervisionKind = 'transfer'

    // filter by from/to warehouse for transfers
    if (fromWarehouseId && fromId !== fromWarehouseId) continue
    if (toWarehouseId && toId !== toWarehouseId) continue

    if (filters.kind && filters.kind !== 'all' && kind !== filters.kind) continue

    rows.push({
      key,
      kind,
      itemId,
      itemName: item.name,
      date: g.date,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      fromWarehouseName: fromName,
      toWarehouseName: toName,
      qtyAbs,
      docIssueId: issue?.id,
      docReceiptId: receipt?.id,
      delta: undefined,
      docIds,
      docNumbers,
      docRoles,
    })
  }

  // Single rows
  for (const { movement: m, doc } of singleGroups.values()) {
    if (handled.has(m.id)) continue

    const qtyAbs = Math.abs(m.quantity)
    const kind = kindFromMovement(m, doc)
    if (filters.kind && filters.kind !== 'all' && kind !== filters.kind) continue

    let fromId: string | undefined
    let toId: string | undefined
    if (doc?.type === 'receipt') {
      toId = doc.warehouseId
    } else if (doc?.type === 'issue') {
      fromId = doc.warehouseId
    } else if (doc?.type === 'inventory') {
      fromId = doc.warehouseId
      toId = doc.warehouseId
    } else {
      fromId = m.warehouseId
      toId = m.warehouseId
    }

    // optional transfer from/to filtering is only meaningful for transfer rows
    if (fromWarehouseId && fromId !== fromWarehouseId && kind !== 'transfer') continue
    if (toWarehouseId && toId !== toWarehouseId && kind !== 'transfer') continue

    const fromName = locName(warehouse.locations, fromId)
    const toName = locName(warehouse.locations, toId)

    const docIds = doc?.id ? [doc.id] : []
    const docNumbers = doc?.number ? [doc.number] : []
    const docRoles = [doc?.docRole]

    rows.push({
      key: `single:${m.id}`,
      kind,
      itemId,
      itemName: item.name,
      date: m.date,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      fromWarehouseName: fromName,
      toWarehouseName: toName,
      qtyAbs,
      delta: kind === 'adjustment' || kind === 'inventory' ? m.quantity : undefined,
      docIds,
      docNumbers,
      docRoles,
    })
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
}

