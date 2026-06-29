import {
  emptyProductionOrder,
  normalizePlanner,
  normalizeProductionOrder,
} from '@/lib/planner/init'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionLineId } from '@/lib/production/types'
import { formatSalesOrderNumber } from '@/lib/sales/init'
import {
  buildCombinedLoadingShipmentInputFromSales,
  buildLoadingShipmentInputFromSales,
  loadingShipmentForSalesLine,
  syncSalesOrderLoadingInStore,
} from '@/lib/sales/loadingLink'
import type {
  SalesOrder,
  SalesOrderHistoryEntry,
  SalesOrderLine,
  SalesOrderStatus,
} from '@/lib/sales/types'
import { upsertLoadingShipment } from '@/lib/warehouse/loadingShipments'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

function historyEntry(
  type: SalesOrderHistoryEntry['type'],
  message: string,
): SalesOrderHistoryEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), type, message }
}

function buildPoFromSalesLine(
  order: SalesOrder,
  line: SalesOrderLine,
  orderId: string,
  productionLineId: ProductionLineId | undefined,
  dates: { startDate: string; endDate: string },
  fp: FinishedProduct | undefined,
): ProductionOrder {
  const recipeId = fp?.defaultFormulationRecipeId
  const hasRecipe = !!recipeId
  const base = emptyProductionOrder(dates.startDate, dates.endDate)
  return normalizeProductionOrder({
    ...base,
    counterpartyId: order.counterpartyId,
    customer: order.customer,
    finishedProductId: line.finishedProductId,
    productName: line.productName,
    category: line.category,
    colorLogo: line.colorLogo,
    productColor: line.productColor,
    totalQtyMp: line.qtyMp,
    lineId: productionLineId ?? '1',
    lineAssignmentPending: !productionLineId,
    priority: order.priority === 'urgent' ? 'urgent' : 'normal',
    rawMaterialKind: fp?.rawMaterialKind,
    rawMaterialItemId: fp?.defaultRawMaterialItemId,
    packagingRecipeId: fp?.defaultPackagingRecipeId,
    formulationRecipeId: recipeId,
    formulationRecipeStatus: hasRecipe ? 'assigned' : 'requested',
    targetGsm: line.targetGsm ?? fp?.grammageGsm,
    labelNote: line.labelNote,
    salesOrderId: orderId,
    salesLineId: line.id,
    metersPerRoll: fp?.metersPerRoll,
    status: 'draft',
    note: [
      `Из заказа клиента ${order.orderNumber}`,
      order.region,
      order.logistics,
      line.note,
    ]
      .filter(Boolean)
      .join(' · '),
  })
}

function planHistoryMessage(
  line: SalesOrderLine,
  productionLineId: ProductionLineId | undefined,
): string {
  return productionLineId
    ? `Создан произв. заказ на линию ${productionLineId} (${line.productName})`
    : `Создан произв. заказ (${line.productName}), линию определит мастер`
}

export function createSalesSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertSalesOrder(order: SalesOrder): SalesOrder {
      let saved = order
      patchStore(setStore, (s) => {
        const exists = s.sales.orders.some((o) => o.id === order.id)
        let nextSeq = s.sales.nextOrderSeq
        const next: SalesOrder = { ...order, updatedAt: new Date().toISOString() }
        if (!next.orderNumber) {
          next.orderNumber = formatSalesOrderNumber(new Date().getFullYear(), nextSeq)
          nextSeq += 1
          next.history = [
            ...next.history,
            historyEntry('created', `Создан заказ ${next.orderNumber}`),
          ]
        }
        saved = next
        const orders = exists
          ? s.sales.orders.map((o) => (o.id === order.id ? next : o))
          : [...s.sales.orders, next]
        return { ...s, sales: { orders, nextOrderSeq: nextSeq } }
      })
      return saved
    },

    removeSalesOrder(id: string) {
      patchStore(setStore, (s) => ({
        ...s,
        sales: { ...s.sales, orders: s.sales.orders.filter((o) => o.id !== id) },
      }))
    },

    setSalesOrderStatus(id: string, status: SalesOrderStatus, message?: string) {
      patchStore(setStore, (s) => ({
        ...s,
        sales: {
          ...s.sales,
          orders: s.sales.orders.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status,
                  updatedAt: new Date().toISOString(),
                  history: [
                    ...o.history,
                    historyEntry('status', message ?? `Статус: ${status}`),
                  ],
                }
              : o,
          ),
        },
      }))
    },

    /**
     * Создать производственный заказ (планировщик) из позиции заказа клиента.
     * productionLineId — необязателен: мастер цеха распределит по линиям позже.
     * Возвращает id созданного заказа или null.
     */
    planSalesLine(
      orderId: string,
      salesLineId: string,
      productionLineId: ProductionLineId | undefined,
      dates: { startDate: string; endDate: string },
    ): string | null {
      let createdId: string | null = null
      patchStore(setStore, (s) => {
        const order = s.sales.orders.find((o) => o.id === orderId)
        if (!order) return s
        const line = order.lines.find((l) => l.id === salesLineId)
        if (!line) return s

        const fp = s.finishedProducts.items.find((f) => f.id === line.finishedProductId)
        const po = buildPoFromSalesLine(
          order,
          line,
          orderId,
          productionLineId,
          dates,
          fp,
        )
        createdId = po.id

        const plannerOrders = [...s.production.planner.orders, po]
        const newStatus: SalesOrderStatus =
          order.status === 'draft' || order.status === 'confirmed'
            ? 'in_production'
            : order.status
        const orders = s.sales.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: newStatus,
                updatedAt: new Date().toISOString(),
                lines: o.lines.map((l) =>
                  l.id === salesLineId
                    ? { ...l, productionOrderIds: [...l.productionOrderIds, po.id] }
                    : l,
                ),
                history: [
                  ...o.history,
                  historyEntry('planned', planHistoryMessage(line, productionLineId)),
                ],
              }
            : o,
        )

        return {
          ...s,
          sales: { ...s.sales, orders },
          production: {
            ...s.production,
            planner: normalizePlanner({ ...s.production.planner, orders: plannerOrders }),
          },
        }
      })
      return createdId
    },

    /** Создать произв. заказы по всем незапланированным позициям заказа клиента */
    planAllSalesLines(
      orderId: string,
      dates: { startDate: string; endDate: string },
      productionLineId?: ProductionLineId,
    ): { created: string[]; skipped: number } {
      const result = { created: [] as string[], skipped: 0 }
      patchStore(setStore, (s) => {
        const order = s.sales.orders.find((o) => o.id === orderId)
        if (!order) return s

        const newPos: ProductionOrder[] = []
        const historyMsgs: SalesOrderHistoryEntry[] = []
        let lines = order.lines

        for (const line of order.lines) {
          if (line.productionOrderIds.length > 0) {
            result.skipped += 1
            continue
          }
          const fp = s.finishedProducts.items.find((f) => f.id === line.finishedProductId)
          const po = buildPoFromSalesLine(
            order,
            line,
            orderId,
            productionLineId,
            dates,
            fp,
          )
          newPos.push(po)
          result.created.push(po.id)
          historyMsgs.push(historyEntry('planned', planHistoryMessage(line, productionLineId)))
          lines = lines.map((l) =>
            l.id === line.id
              ? { ...l, productionOrderIds: [...l.productionOrderIds, po.id] }
              : l,
          )
        }

        if (!newPos.length) return s

        const newStatus: SalesOrderStatus =
          order.status === 'draft' || order.status === 'confirmed'
            ? 'in_production'
            : order.status

        return {
          ...s,
          sales: {
            ...s.sales,
            orders: s.sales.orders.map((o) =>
              o.id === orderId
                ? {
                    ...o,
                    status: newStatus,
                    lines,
                    updatedAt: new Date().toISOString(),
                    history: [...o.history, ...historyMsgs],
                  }
                : o,
            ),
          },
          production: {
            ...s.production,
            planner: normalizePlanner({
              ...s.production.planner,
              orders: [...s.production.planner.orders, ...newPos],
            }),
          },
        }
      })
      return result
    },

    /** Создать черновики погрузки на складе по позициям заказа клиента */
    createLoadingShipmentsFromSalesOrder(orderId: string): {
      created: string[]
      skipped: number
    } {
      const result = { created: [] as string[], skipped: 0 }
      patchStore(setStore, (s) => {
        const order = s.sales.orders.find((o) => o.id === orderId)
        if (!order) return s

        let warehouse = s.warehouse
        let shipmentList = [...(warehouse.loadingShipments ?? [])]
        const newIds = [...(order.loadingShipmentIds ?? [])]
        const historyMsgs: SalesOrderHistoryEntry[] = []

        for (const line of order.lines) {
          if (loadingShipmentForSalesLine(shipmentList, orderId, line.id)) {
            result.skipped += 1
            continue
          }
          const input = buildLoadingShipmentInputFromSales(
            order,
            line,
            warehouse,
            s.finishedProducts.items,
          )
          if (!input) {
            result.skipped += 1
            continue
          }
          const out = upsertLoadingShipment(warehouse, input)
          warehouse = out.store
          shipmentList = warehouse.loadingShipments ?? []
          newIds.push(out.shipment.id)
          result.created.push(out.shipment.id)
          historyMsgs.push(
            historyEntry(
              'note',
              `Погрузка ${out.shipment.number} (${line.productName})`,
            ),
          )
        }

        if (!result.created.length) return s

        let next = {
          ...s,
          warehouse,
        }
        next = syncSalesOrderLoadingInStore(next, orderId)
        const synced = next.sales.orders.find((o) => o.id === orderId)
        if (synced) {
          next = {
            ...next,
            sales: {
              ...next.sales,
              orders: next.sales.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...synced,
                      history: [...synced.history, ...historyMsgs],
                    }
                  : o,
              ),
            },
          }
        }
        return next
      })
      return result
    },

    /** Сводная калькуляция погрузки — все позиции заказа в одном документе */
    createCombinedLoadingFromSalesOrder(orderId: string): {
      created: string | null
      skipped: boolean
      number?: string
    } {
      const result = { created: null as string | null, skipped: false, number: undefined as string | undefined }
      patchStore(setStore, (s) => {
        const order = s.sales.orders.find((o) => o.id === orderId)
        if (!order) return s

        const existing = (s.warehouse.loadingShipments ?? []).find(
          (sh) => sh.salesOrderId === orderId && !sh.salesLineId,
        )
        if (existing || order.combinedLoadingShipmentId) {
          result.skipped = true
          return syncSalesOrderLoadingInStore(s, orderId)
        }

        const input = buildCombinedLoadingShipmentInputFromSales(
          order,
          s.warehouse,
          s.finishedProducts.items,
        )
        if (!input) {
          result.skipped = true
          return s
        }

        const out = upsertLoadingShipment(s.warehouse, input)
        result.created = out.shipment.id
        result.number = out.shipment.number
        let next: typeof s = {
          ...s,
          warehouse: out.store,
        }
        next = syncSalesOrderLoadingInStore(next, orderId)
        const synced = next.sales.orders.find((o) => o.id === orderId)
        if (synced) {
          next = {
            ...next,
            sales: {
              ...next.sales,
              orders: next.sales.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...synced,
                      history: [
                        ...synced.history,
                        historyEntry(
                          'note',
                          `Сводная калькуляция ${out.shipment.number}`,
                        ),
                      ],
                    }
                  : o,
              ),
            },
          }
        }
        return next
      })
      return result
    },
  }
}
