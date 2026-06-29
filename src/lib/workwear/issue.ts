import type { Employee } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { checkWorkwearEligibility } from './eligibility'
import {
  postWorkwearWarehouseIssue,
  syncWorkwearCatalogToWarehouse,
  warehouseStockForCatalogItem,
} from './warehouseSync'
import type {
  WorkwearCatalogItem,
  WorkwearIssuance,
  WorkwearSeason,
  WorkwearStore,
} from './types'
import { WORKWEAR_AMORTIZATION_MONTHS } from './types'

export type PostWorkwearIssueInput = {
  employeeId: string
  itemId: string
  size: string
  quantity: number
  issueDate: string
  unitPrice?: number
  comment?: string
  issuedBy: string
  issuedByName: string
}

export type PostWorkwearIssueResult =
  | { ok: true; issuance: WorkwearIssuance }
  | { ok: false; error: string }

function nextDocumentNumber(store: WorkwearStore, issueDate: string): string {
  const compact = issueDate.replace(/-/g, '')
  const prefix = `СО-${compact}-`
  const sameDay = store.issuances.filter((i) => i.documentNumber.startsWith(prefix))
  const maxSeq = sameDay.reduce((max, i) => {
    const tail = i.documentNumber.slice(prefix.length)
    const n = parseInt(tail, 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

export function upsertWorkwearCatalogItem(
  store: WorkwearStore,
  item: WorkwearCatalogItem,
): WorkwearStore {
  const exists = store.catalog.some((c) => c.id === item.id)
  const catalog = exists
    ? store.catalog.map((c) => (c.id === item.id ? item : c))
    : [...store.catalog, item]
  return { ...store, catalog }
}

export function upsertWorkwearCatalogWithWarehouse(
  workwear: WorkwearStore,
  warehouse: WarehouseStore,
  item: WorkwearCatalogItem,
): { workwear: WorkwearStore; warehouse: WarehouseStore } {
  const { warehouse: nextWh, catalogItem } = syncWorkwearCatalogToWarehouse(warehouse, item)
  const nextWorkwear = upsertWorkwearCatalogItem(workwear, catalogItem)
  return { workwear: nextWorkwear, warehouse: nextWh }
}

export function postWorkwearIssuance(
  workwear: WorkwearStore,
  warehouse: WarehouseStore,
  employees: Employee[],
  input: PostWorkwearIssueInput,
): { workwear: WorkwearStore; warehouse: WarehouseStore; result: PostWorkwearIssueResult } {
  const employee = employees.find((e) => e.id === input.employeeId)
  if (!employee) {
    return { workwear, warehouse, result: { ok: false, error: 'employee_not_found' } }
  }

  const eligibility = checkWorkwearEligibility(employee)
  if (!eligibility.ok) {
    return { workwear, warehouse, result: { ok: false, error: eligibility.reason } }
  }

  let catalogItem = workwear.catalog.find((c) => c.id === input.itemId && c.active)
  if (!catalogItem) {
    return { workwear, warehouse, result: { ok: false, error: 'item_not_found' } }
  }

  if (!catalogItem.warehouseItemId) {
    const synced = syncWorkwearCatalogToWarehouse(warehouse, catalogItem)
    warehouse = synced.warehouse
    catalogItem = synced.catalogItem
    workwear = upsertWorkwearCatalogItem(workwear, catalogItem)
  }

  const size = input.size.trim()
  if (!size) {
    return { workwear, warehouse, result: { ok: false, error: 'size_required' } }
  }
  if (catalogItem.sizes.length > 0 && !catalogItem.sizes.includes(size)) {
    return { workwear, warehouse, result: { ok: false, error: 'invalid_size' } }
  }

  const quantity = Math.max(1, Math.floor(input.quantity) || 1)
  const unitPrice = input.unitPrice ?? catalogItem.unitPrice
  if (unitPrice <= 0) {
    return { workwear, warehouse, result: { ok: false, error: 'price_required' } }
  }

  const stock = warehouseStockForCatalogItem(warehouse, catalogItem)
  if (!stock || stock.available < quantity) {
    return { workwear, warehouse, result: { ok: false, error: 'insufficient_stock' } }
  }

  const season: WorkwearSeason = catalogItem.season
  const documentNumber = nextDocumentNumber(workwear, input.issueDate)

  const whIssue = postWorkwearWarehouseIssue(warehouse, {
    warehouseItemId: catalogItem.warehouseItemId!,
    warehouseId: stock.warehouseId,
    quantity,
    date: input.issueDate,
    documentNumber,
    employeeName: employee.fullName,
    comment: input.comment,
  })

  if (!whIssue.result.ok) {
    return { workwear, warehouse, result: { ok: false, error: whIssue.result.error } }
  }

  warehouse = whIssue.warehouse

  const issuance: WorkwearIssuance = {
    id: crypto.randomUUID(),
    documentNumber,
    employeeId: input.employeeId,
    itemId: input.itemId,
    size,
    quantity,
    unitPrice,
    currency: catalogItem.currency,
    season,
    ppeCategory: catalogItem.ppeCategory,
    amortizationMonths: WORKWEAR_AMORTIZATION_MONTHS[season],
    issueDate: input.issueDate,
    issuedBy: input.issuedBy,
    issuedByName: input.issuedByName,
    warehouseItemId: catalogItem.warehouseItemId,
    warehouseDocumentId: whIssue.result.documentId,
    comment: input.comment?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }

  return {
    workwear: { ...workwear, issuances: [...workwear.issuances, issuance] },
    warehouse,
    result: { ok: true, issuance },
  }
}
