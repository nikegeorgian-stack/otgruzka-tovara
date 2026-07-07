import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { linkedOrderIdsFromRequest } from '@/lib/planner/generateRequests'
import type { ProductionOrder } from '@/lib/planner/types'
import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import {
  ensureProductionWarehouseLocations,
  PRODUCTION_LOCATION_NAMES,
  warehouseLocationId,
} from '@/lib/warehouse/productionLocations'
import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'
import { summarizeRequest } from './stats'
import type { ProductionRequest } from './types'

export type PostProductionResult = {
  ok: boolean
  messageKey?: string
  detail?: string
  store: WarehouseStore
}

function addMovement(
  store: WarehouseStore,
  movement: Omit<StockMovement, 'id' | 'createdAt'>,
): WarehouseStore {
  return {
    ...store,
    movements: [
      ...store.movements,
      { ...movement, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
    ],
  }
}

function resolveFinishedProduct(
  request: ProductionRequest,
  orders: ProductionOrder[],
  products: FinishedProduct[],
): FinishedProduct | undefined {
  const orderIds = linkedOrderIdsFromRequest(request)
  for (const oid of orderIds) {
    const order = orders.find((o) => o.id === oid)
    if (!order?.finishedProductId) continue
    const fp = products.find((p) => p.id === order.finishedProductId)
    if (fp?.warehouseItemId) return fp
  }
  if (request.orderId) {
    const order = orders.find((o) => o.id === request.orderId)
    if (order?.finishedProductId) {
      return products.find((p) => p.id === order.finishedProductId)
    }
  }
  return undefined
}

export function postProductionRequestToWarehouse(
  warehouse: WarehouseStore,
  request: ProductionRequest,
  orders: ProductionOrder[],
  finishedProducts: FinishedProduct[],
): PostProductionResult {
  let store = ensureProductionWarehouseLocations(warehouse)
  const summary = summarizeRequest(request)
  const fp = resolveFinishedProduct(request, orders, finishedProducts)

  if (request.lineId === 'pack') {
    const wipId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.wip)
    const finId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.finished)
    if (!wipId || !finId) {
      return { ok: false, messageKey: 'production.post.noLocations', store }
    }

    const rolls = request.packaging?.rolls ?? []
    let moved = 0
    for (const row of rolls) {
      const qty = row.factQty ?? 0
      if (qty <= 0) continue
      const product =
        finishedProducts.find(
          (p) =>
            p.active &&
            p.warehouseItemId &&
            (p.name === row.name ||
              row.name.includes(p.name) ||
              p.name.includes(row.name)),
        ) ?? fp
      if (!product?.warehouseItemId) continue
      const itemId = product.warehouseItemId
      const comment = `Упаковка ${request.date} · ${row.name}`
      store = addMovement(store, {
        itemId,
        warehouseId: wipId,
        type: 'issue',
        quantity: qty,
        date: request.date,
        comment,
      })
      store = addMovement(store, {
        itemId,
        warehouseId: finId,
        type: 'receipt',
        quantity: qty,
        date: request.date,
        comment,
      })
      moved++
    }

    if (!moved && summary.factMp <= 0) {
      return { ok: false, messageKey: 'production.post.noFact', store }
    }
    if (!moved && fp?.warehouseItemId && summary.factMp > 0) {
      const itemId = fp.warehouseItemId
      const qty = summary.factMp
      const comment = `Упаковка ${request.date}`
      store = addMovement(store, {
        itemId,
        warehouseId: wipId,
        type: 'issue',
        quantity: qty,
        date: request.date,
        comment,
      })
      store = addMovement(store, {
        itemId,
        warehouseId: finId,
        type: 'receipt',
        quantity: qty,
        date: request.date,
        comment,
      })
      moved = 1
    }

    if (!moved) {
      return { ok: false, messageKey: 'production.post.noProduct', store }
    }
  } else {
    const wipId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.wip)
    if (!wipId) {
      return { ok: false, messageKey: 'production.post.noLocations', store }
    }

    const factMp =
      summary.factMp - (summary.byCategory.defect?.qtyMp ?? 0)
    if (factMp <= 0) {
      return { ok: false, messageKey: 'production.post.noFact', store }
    }
    if (!fp?.warehouseItemId) {
      return { ok: false, messageKey: 'production.post.noProduct', store }
    }

    store = addMovement(store, {
      itemId: fp.warehouseItemId,
      warehouseId: wipId,
      type: 'receipt',
      quantity: factMp,
      date: request.date,
      comment: `Выработка линия ${request.lineId} · ${request.date}`,
      brigade: request.brigadeName,
    })
  }

  store = appendWarehouseAudit(store, {
    action: 'document_post',
    detail: `Производство ${request.date} линия ${request.lineId} → склад`,
    productionRequestId: request.id,
  })

  return { ok: true, store }
}
