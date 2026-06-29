import { upsertWarehouseItemInStore } from '@/lib/warehouse/itemHistory'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { computeAllBalances, validateIssueLines } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'
import type { WorkwearCatalogItem } from './types'

export const WORKWEAR_WAREHOUSE_CATEGORY = 'СИЗ'

function findOrCreateSizCategory(warehouse: WarehouseStore): {
  warehouse: WarehouseStore
  categoryId: string
} {
  const cat = warehouse.categories.find(
    (c) => c.name.toLowerCase() === WORKWEAR_WAREHOUSE_CATEGORY.toLowerCase(),
  )
  if (cat) return { warehouse, categoryId: cat.id }
  const id = crypto.randomUUID()
  return {
    warehouse: {
      ...warehouse,
      categories: [
        ...warehouse.categories,
        { id, name: WORKWEAR_WAREHOUSE_CATEGORY, sortOrder: warehouse.categories.length },
      ],
    },
    categoryId: id,
  }
}

function defaultWarehouseId(warehouse: WarehouseStore, preferred?: string): string {
  if (preferred && warehouse.locations.some((l) => l.id === preferred)) return preferred
  return warehouse.locations[0]?.id ?? ''
}

/** Связать позицию спецодежды с номенклатурой склада (категория СИЗ) */
export function syncWorkwearCatalogToWarehouse(
  warehouse: WarehouseStore,
  catalogItem: WorkwearCatalogItem,
): { warehouse: WarehouseStore; catalogItem: WorkwearCatalogItem } {
  const warehouseId = defaultWarehouseId(warehouse, catalogItem.warehouseId)
  const { warehouse: whWithCat, categoryId } = findOrCreateSizCategory(warehouse)
  warehouse = whWithCat
  const now = new Date().toISOString()

  let existing: WarehouseItem | undefined
  if (catalogItem.warehouseItemId) {
    existing = warehouse.items.find((i) => i.id === catalogItem.warehouseItemId)
  }
  if (!existing) {
    existing = warehouse.items.find(
      (i) =>
        i.active &&
        i.name.trim().toLowerCase() === catalogItem.name.trim().toLowerCase() &&
        i.categoryId === categoryId,
    )
  }

  const item: WarehouseItem = existing
    ? {
        ...existing,
        name: catalogItem.name,
        price: catalogItem.unitPrice,
        categoryId,
        warehouseId: existing.warehouseId || warehouseId,
        note: catalogItem.note ?? existing.note,
      }
    : {
        id: crypto.randomUUID(),
        internalCode: '',
        name: catalogItem.name,
        categoryId,
        warehouseId,
        unit: 'шт',
        price: catalogItem.unitPrice,
        active: catalogItem.active,
        sortOrder: warehouse.items.length,
        note: catalogItem.note,
        createdAt: now,
      }

  let next = upsertWarehouseItemInStore(warehouse, item)
  const saved = next.items.find((i) => i.id === item.id)!

  return {
    warehouse: next,
    catalogItem: {
      ...catalogItem,
      warehouseItemId: saved.id,
      warehouseId: saved.warehouseId,
    },
  }
}

export type WorkwearStockIssueResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'no_warehouse_link' | 'insufficient_stock' | 'no_warehouse' }

/** Списать со склада при выдаче спецодежды */
export function postWorkwearWarehouseIssue(
  warehouse: WarehouseStore,
  args: {
    warehouseItemId: string
    warehouseId: string
    quantity: number
    date: string
    documentNumber: string
    employeeName: string
    comment?: string
  },
): { warehouse: WarehouseStore; result: WorkwearStockIssueResult } {
  const item = warehouse.items.find((i) => i.id === args.warehouseItemId)
  if (!item) {
    return { warehouse, result: { ok: false, error: 'no_warehouse_link' } }
  }
  if (!args.warehouseId) {
    return { warehouse, result: { ok: false, error: 'no_warehouse' } }
  }

  const balances = computeAllBalances(warehouse, args.warehouseId)
  const check = validateIssueLines(warehouse.items, balances, [
    { itemId: args.warehouseItemId, quantity: args.quantity },
  ])
  if (!check.ok) {
    return { warehouse, result: { ok: false, error: 'insufficient_stock' } }
  }

  const posted = postWarehouseDocument(warehouse, {
    type: 'issue',
    number: args.documentNumber,
    date: args.date,
    warehouseId: args.warehouseId,
    purpose: 'production_issue',
    comment: args.comment ?? `Выдача СО: ${args.employeeName}`,
    lines: [{ itemId: args.warehouseItemId, quantity: args.quantity }],
    skipValidation: true,
  })

  const doc = posted.store.documents[posted.store.documents.length - 1]!
  return { warehouse: posted.store, result: { ok: true, documentId: doc.id } }
}

export function warehouseStockForCatalogItem(
  warehouse: WarehouseStore,
  catalogItem: WorkwearCatalogItem,
): { available: number; warehouseId: string } | null {
  if (!catalogItem.warehouseItemId) return null
  const warehouseId = defaultWarehouseId(warehouse, catalogItem.warehouseId)
  const balances = computeAllBalances(warehouse, warehouseId)
  return {
    available: balances.get(catalogItem.warehouseItemId)?.available ?? 0,
    warehouseId,
  }
}
