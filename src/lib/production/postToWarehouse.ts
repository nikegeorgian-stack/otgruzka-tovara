import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { PackagingRecipeStore } from '@/lib/packaging/types'
import { linkedOrderIdsFromRequest } from '@/lib/planner/generateRequests'
import type { ProductionOrder } from '@/lib/planner/types'
import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { suggestDocNumber } from '@/lib/warehouse/nomenclatureSearch'
import {
  ensureProductionWarehouseLocations,
  PRODUCTION_LOCATION_NAMES,
  warehouseLocationId,
} from '@/lib/warehouse/productionLocations'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { buildProductionConsumeLines, groupConsumeByWarehouse } from './consumeLines'
import { summarizeRequest } from './stats'
import type { ProductionRequest } from './types'

export type PostProductionResult = {
  ok: boolean
  messageKey?: string
  detail?: string
  store: WarehouseStore
  /** Созданные складские документы (списание / приход ГП). */
  documentIds?: string[]
}

function resolveFinishedProduct(
  request: ProductionRequest,
  orders: ProductionOrder[],
  finishedProducts: FinishedProduct[],
): FinishedProduct | undefined {
  const orderIds = linkedOrderIdsFromRequest(request)
  for (const oid of orderIds) {
    const order = orders.find((o) => o.id === oid)
    if (!order?.finishedProductId) continue
    const fp = productsFind(finishedProducts, order.finishedProductId)
    if (fp?.warehouseItemId) return fp
  }
  if (request.orderId) {
    const order = orders.find((o) => o.id === request.orderId)
    if (order?.finishedProductId) {
      return productsFind(finishedProducts, order.finishedProductId)
    }
  }
  return undefined
}

function productsFind(products: FinishedProduct[], id: string) {
  return products.find((p) => p.id === id)
}

/**
 * Проводка сменной заявки на склад:
 * создаёт формальные документы прихода ГП (и перемещения упаковки),
 * а не «голые» движения — для печати, журнала и выгрузки в Balance.
 */
function postConsumeDocuments(
  warehouse: WarehouseStore,
  request: ProductionRequest,
  orders: ProductionOrder[],
  finishedProducts: FinishedProduct[],
  packStore: PackagingRecipeStore,
  formulationRecipes: FormulationRecipe[],
  documentIds: string[],
): { store: WarehouseStore; ok: boolean; messageKey?: string } {
  const grouped = groupConsumeByWarehouse(
    buildProductionConsumeLines(
      request,
      orders,
      finishedProducts,
      warehouse.items,
      packStore,
      formulationRecipes,
    ),
  )
  let store = warehouse
  const day = request.date.replace(/-/g, '')
  for (const [warehouseId, lines] of grouped) {
    const number = suggestDocNumber(store.documents, 'issue', request.date) || `ПР-РХ-${day}`
    const out = postWarehouseDocument(store, {
      type: 'issue',
      number,
      date: request.date,
      warehouseId,
      purpose: 'production_issue',
      comment: `Автосписание расходников · линия ${request.lineId} · ${request.date}`,
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      brigade: request.brigadeName,
      productionRequestId: request.id,
      docRole: 'production_issue',
      skipAudit: true,
      skipValidation: true,
    })
    if (!out.result.ok) {
      return { store: out.store, ok: false, messageKey: out.result.error }
    }
    store = out.store
    documentIds.push(out.result.documentId)
  }
  return { store, ok: true }
}

export function postProductionRequestToWarehouse(
  warehouse: WarehouseStore,
  request: ProductionRequest,
  orders: ProductionOrder[],
  finishedProducts: FinishedProduct[],
  packStore: PackagingRecipeStore = { items: [], nextCode: 1, boxes: [], nextBoxCode: 1 },
  formulationRecipes: FormulationRecipe[] = [],
): PostProductionResult {
  let store = ensureProductionWarehouseLocations(warehouse)

  const alreadyPosted = store.documents.filter(
    (d) => d.productionRequestId === request.id && d.status === 'posted',
  )
  if (alreadyPosted.length > 0) {
    return {
      ok: false,
      messageKey: 'production.post.alreadyPosted',
      store,
      documentIds: alreadyPosted.map((d) => d.id),
    }
  }

  const summary = summarizeRequest(request)
  const fp = resolveFinishedProduct(request, orders, finishedProducts)
  const documentIds: string[] = []
  const day = request.date.replace(/-/g, '')

  if (request.lineId === 'pack') {
    const wipId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.wip)
    const finId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.finished)
    if (!wipId || !finId) {
      return { ok: false, messageKey: 'production.post.noLocations', store }
    }

    const rolls = request.packaging?.rolls ?? []
    type PackLine = { itemId: string; quantity: number; name: string }
    const packLines: PackLine[] = []

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
      packLines.push({ itemId: product.warehouseItemId, quantity: qty, name: row.name })
    }

    if (!packLines.length && fp?.warehouseItemId && summary.factMp > 0) {
      packLines.push({
        itemId: fp.warehouseItemId,
        quantity: summary.factMp,
        name: fp.name,
      })
    }

    if (!packLines.length) {
      return {
        ok: false,
        messageKey: summary.factMp <= 0 ? 'production.post.noFact' : 'production.post.noProduct',
        store,
      }
    }

    const issueNo = suggestDocNumber(store.documents, 'issue', request.date)
    const issueOut = postWarehouseDocument(store, {
      type: 'issue',
      number: issueNo || `ПР-УП-${day}-Р`,
      date: request.date,
      warehouseId: wipId,
      purpose: 'production_issue',
      comment: `Упаковка → ГП · ${request.date}`,
      lines: packLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      brigade: request.brigadeName,
      productionRequestId: request.id,
      docRole: 'production_issue',
      skipAudit: true,
      skipValidation: true,
    })
    if (!issueOut.result.ok) {
      return { ok: false, messageKey: issueOut.result.error, store: issueOut.store }
    }
    store = issueOut.store
    documentIds.push(issueOut.result.documentId)

    const receiptNo = suggestDocNumber(store.documents, 'receipt', request.date)
    const receiptOut = postWarehouseDocument(store, {
      type: 'receipt',
      number: receiptNo || `ПР-УП-${day}-П`,
      date: request.date,
      warehouseId: finId,
      purpose: 'production_receipt',
      comment: `Приход ГП с упаковки · ${request.date}`,
      lines: packLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      brigade: request.brigadeName,
      productionRequestId: request.id,
      docRole: 'production_receipt',
      skipAudit: true,
      skipValidation: true,
    })
    if (!receiptOut.result.ok) {
      return { ok: false, messageKey: receiptOut.result.error, store: receiptOut.store }
    }
    store = receiptOut.store
    documentIds.push(receiptOut.result.documentId)
  } else {
    const wipId = warehouseLocationId(store, PRODUCTION_LOCATION_NAMES.wip)
    if (!wipId) {
      return { ok: false, messageKey: 'production.post.noLocations', store }
    }

    const factMp = summary.factMp - (summary.byCategory.defect?.qtyMp ?? 0)
    if (factMp <= 0) {
      return { ok: false, messageKey: 'production.post.noFact', store }
    }
    if (!fp?.warehouseItemId) {
      return { ok: false, messageKey: 'production.post.noProduct', store }
    }

    const receiptNo = suggestDocNumber(store.documents, 'receipt', request.date)
    const receiptOut = postWarehouseDocument(store, {
      type: 'receipt',
      number: receiptNo || `ПР-${request.lineId}-${day}`,
      date: request.date,
      warehouseId: wipId,
      purpose: 'production_receipt',
      comment: `Выработка линия ${request.lineId} · ${request.date}`,
      lines: [{ itemId: fp.warehouseItemId, quantity: factMp }],
      brigade: request.brigadeName,
      productionRequestId: request.id,
      docRole: 'production_receipt',
      skipAudit: true,
      skipValidation: true,
    })
    if (!receiptOut.result.ok) {
      return { ok: false, messageKey: receiptOut.result.error, store: receiptOut.store }
    }
    store = receiptOut.store
    documentIds.push(receiptOut.result.documentId)
  }

  const consume = postConsumeDocuments(
    store,
    request,
    orders,
    finishedProducts,
    packStore,
    formulationRecipes,
    documentIds,
  )
  if (!consume.ok) {
    return { ok: false, messageKey: consume.messageKey, store: consume.store }
  }
  store = consume.store

  store = appendWarehouseAudit(store, {
    action: 'document_post',
    detail: `Производство ${request.date} линия ${request.lineId} → склад · док. ${documentIds.length}`,
    productionRequestId: request.id,
  })

  return { ok: true, store, documentIds }
}
