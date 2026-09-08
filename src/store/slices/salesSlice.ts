import { appendAudit } from '@/lib/audit'
import {
  emptyProductionOrder,
  normalizePlanner,
  normalizeProductionOrder,
} from '@/lib/planner/init'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionLineId } from '@/lib/production/types'
import {
  applySalesLegacyStatusChange,
  formatSalesOrderNumber,
} from '@/lib/sales/init'
import {
  buildCombinedLoadingShipmentInputFromSales,
  buildLoadingShipmentInputFromSales,
  loadingShipmentForSalesLine,
  syncSalesOrderLoadingInStore,
} from '@/lib/sales/loadingLink'
import { buildPlanSalesLinePreview } from '@/lib/sales/planPreview'
import { recalculateSalesOrderProgress } from '@/lib/sales/progress'
import { appendSalesFgReserveMovement } from '@/lib/sales/reserveStock'
import { deriveLegacySalesStatus } from '@/lib/sales/statuses'
import type {
  SalesOrder,
  SalesOrderHistoryEntry,
  SalesOrderLine,
  SalesOrderStatus,
  SalesProductionAllocation,
  SalesStockReservation,
} from '@/lib/sales/types'
import { upsertLoadingShipment } from '@/lib/warehouse/loadingShipments'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { inheritPackagingFromProduct } from '@/lib/packaging/inherit'
import type { PackagingRecipeStore } from '@/lib/packaging/types'
import { estimatedOrderedRolls } from '@/lib/planner/rolls'
import { actorAuditFields } from './actorAuditFields'
import { patchStore, type StoreSliceDeps } from '../storeApi'
import type { AppStore } from '@/lib/types'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { isG5SalesPlanningActive } from '@/lib/planner/g5Activation'

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
  qtyMp: number,
  packStore: PackagingRecipeStore,
): ProductionOrder {
  const recipeId = fp?.defaultFormulationRecipeId
  const hasRecipe = !!recipeId
  const inherited = inheritPackagingFromProduct(fp, packStore)
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
    totalQtyMp: qtyMp,
    lineId: productionLineId ?? '1',
    lineAssignmentPending: !productionLineId,
    priority: order.priority === 'urgent' ? 'urgent' : 'normal',
    rawMaterialKind: fp?.rawMaterialKind,
    rawMaterialItemId: fp?.defaultRawMaterialItemId,
    packagingRecipeId: inherited.packagingRecipeId ?? fp?.defaultPackagingRecipeId,
    boxRecipeId: inherited.boxRecipeId,
    rollsPerBox: inherited.rollsPerBox,
    boxItemId: inherited.boxItemId,
    formulationRecipeId: recipeId,
    formulationRecipeStatus: hasRecipe ? 'assigned' : 'requested',
    targetGsm: line.targetGsm ?? fp?.grammageGsm,
    meshCellSize: inherited.meshCellSize ?? fp?.meshCellSize,
    orderedRolls: estimatedOrderedRolls(qtyMp, fp?.metersPerRoll),
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
  preview: { proposeReserveMp: number; proposeProduceMp: number },
  productionLineId: ProductionLineId | undefined,
): string {
  const parts: string[] = []
  if (preview.proposeReserveMp > 0) {
    parts.push(`резерв ГП ${preview.proposeReserveMp} п.м`)
  }
  if (preview.proposeProduceMp > 0) {
    parts.push(
      productionLineId
        ? `ПЗ ${preview.proposeProduceMp} п.м → линия ${productionLineId}`
        : `ПЗ ${preview.proposeProduceMp} п.м (линию определит мастер)`,
    )
  }
  if (!parts.length) return `Планирование: ${line.productName} — уже обеспечено`
  return `Планирование (${line.productName}): ${parts.join('; ')}`
}

function syncOrderAfterPlan(
  order: SalesOrder,
  allocations: SalesProductionAllocation[],
  reservations: SalesStockReservation[],
): SalesOrder {
  const next = recalculateSalesOrderProgress(order, allocations, reservations)
  return {
    ...next,
    status: deriveLegacySalesStatus(next.commercialStatus, next.fulfillmentStatus),
    updatedAt: new Date().toISOString(),
  }
}

export function createSalesSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  return {
    async upsertSalesOrder(order: SalesOrder): Promise<SalesOrder> {
      if (isG5SalesPlanningActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const prev = getStore().sales.orders.find((o) => o.id === order.id)
          const commercial = order.commercialStatus ?? order.status
          const isDraft = !commercial || commercial === 'draft'
          const priorityOnly =
            !isDraft &&
            prev &&
            (prev.priority === 'urgent' ? 10 : 1) !== (order.priority === 'urgent' ? 10 : 1) &&
            prev.counterpartyId === order.counterpartyId &&
            JSON.stringify(prev.lines.map((l) => [l.id, l.finishedProductId, l.qtyMp])) ===
              JSON.stringify(order.lines.map((l) => [l.id, l.finishedProductId, l.qtyMp]))
          const commandType = priorityOnly
            ? 'sales.order.priority.set'
            : isDraft
              ? 'sales.order.draft.save'
              : 'sales.order.change'
          const conf = await executeG5Command({
            idempotencyKey: `g5-so-${order.id}-${order.updatedAt || Date.now()}`,
            commandType,
            command: priorityOnly
              ? { id: order.id, priority: order.priority === 'urgent' ? 10 : 1 }
              : {
                  id: order.id,
                  customerId: order.counterpartyId,
                  priority: order.priority === 'urgent' ? 10 : 1,
                  lines: order.lines.map((l) => ({
                    lineId: l.id,
                    finishedProductId: l.finishedProductId,
                    quantity: l.qtyMp,
                    unit: 'm2',
                    requestedShipDate: order.dueDate,
                  })),
                },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return getStore().sales.orders.find((o) => o.id === order.id) ?? order
        }
      }

      let saved = order
      patchStore(setStore, (s) => {
        const exists = s.sales.orders.some((o) => o.id === order.id)
        let nextSeq = s.sales.nextOrderSeq
        const fromLegacy = applySalesLegacyStatusChange(order, order.status ?? 'draft')
        const commercialStatus = order.commercialStatus ?? fromLegacy.commercialStatus
        const fulfillmentStatus = order.fulfillmentStatus ?? fromLegacy.fulfillmentStatus
        const next: SalesOrder = {
          ...order,
          commercialStatus,
          fulfillmentStatus,
          status: deriveLegacySalesStatus(commercialStatus, fulfillmentStatus),
          updatedAt: new Date().toISOString(),
        }
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
        return { ...s, sales: { ...s.sales, orders, nextOrderSeq: nextSeq } }
      })
      return saved
    },

    async removeSalesOrder(id: string) {
      if (isG5SalesPlanningActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const order = getStore().sales.orders.find((o) => o.id === id)
          const commercial = order?.commercialStatus ?? order?.status
          const commandType =
            !commercial || commercial === 'draft'
              ? 'sales.order.draft.delete'
              : 'sales.order.cancel'
          const conf = await executeG5Command({
            idempotencyKey: `g5-so-remove-${id}-${Date.now()}`,
            commandType,
            command: { id },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

      recordSliceExplicitDelete('sales.orders', id, actorFromGetter(getActor))
      patchStore(setStore, (s) => ({
        ...s,
        sales: {
          ...s.sales,
          orders: s.sales.orders.filter((o) => o.id !== id),
          reservations: (s.sales.reservations ?? []).filter((r) => r.salesOrderId !== id),
          allocations: (s.sales.allocations ?? []).filter((a) => a.salesOrderId !== id),
        },
      }))
    },

    async setSalesOrderStatus(id: string, status: SalesOrderStatus, message?: string) {
      if (isG5SalesPlanningActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const commandType =
            status === 'confirmed'
              ? 'sales.order.confirm'
              : status === 'cancelled'
                ? 'sales.order.cancel'
                : 'sales.order.change'
          const conf = await executeG5Command({
            idempotencyKey: `g5-so-status-${id}-${status}-${Date.now()}`,
            commandType,
            command: { id },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      } else {
        const { isG5WebPath } = await import('@/lib/planner/g5ServerClient')
        if (isG5WebPath() && (status === 'confirmed' || status === 'cancelled')) {
          const { G5_SALES_PLANNING_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
          throw new Error(G5_SALES_PLANNING_INACTIVE)
        }
      }

      patchStore(setStore, (s) => {
        const orders = s.sales.orders.map((o) => {
          if (o.id !== id) return o
          const dual = applySalesLegacyStatusChange(o, status)
          return {
            ...o,
            ...dual,
            updatedAt: new Date().toISOString(),
            history: [
              ...o.history,
              historyEntry('status', message ?? `Статус: ${status}`),
            ],
          }
        })
        let next = { ...s, sales: { ...s.sales, orders } }
        next = appendAudit(next, {
          action: 'sales_order_status',
          detail: `ЗК статус → ${status}`,
          ...actorAuditFields(getActor),
        })
        return next
      })
    },

    /**
     * Обеспечить строку ЗК: резерв доступной ГП + ПЗ только на остаток.
     * Не ставит fulfillment=in_production (только planned / partially_planned).
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

        const commercial = order.commercialStatus ?? splitCommercial(order.status)
        // Планируем только подтверждённый ЗК (не draft / on_hold / cancelled / completed)
        if (commercial !== 'confirmed') return s

        const reservations = [...(s.sales.reservations ?? [])]
        const allocations = [...(s.sales.allocations ?? [])]
        const preview = buildPlanSalesLinePreview({
          order,
          line,
          warehouse: s.warehouse,
          finishedProducts: s.finishedProducts.items,
          reservations,
          allocations,
        })

        if (preview.remainingToEnsureMp <= 0) return s

        let warehouse = s.warehouse
        const now = new Date().toISOString()
        const historyMsgs: SalesOrderHistoryEntry[] = []
        let newPo: ProductionOrder | null = null

        if (preview.proposeReserveMp > 0 && preview.warehouseItemId) {
          const moved = appendSalesFgReserveMovement(warehouse, {
            warehouseItemId: preview.warehouseItemId,
            quantity: preview.proposeReserveMp,
            comment: `Резерв ЗК ${order.orderNumber} · ${line.productName}`,
          })
          if (moved) {
            warehouse = moved.store
            const reservation: SalesStockReservation = {
              id: crypto.randomUUID(),
              salesOrderId: orderId,
              salesLineId: line.id,
              warehouseItemId: preview.warehouseItemId,
              quantity: preview.proposeReserveMp,
              reservationType: 'sales_order',
              status: 'active',
              warehouseMovementId: moved.movement.id,
              createdAt: now,
            }
            reservations.push(reservation)
          }
        }

        if (preview.proposeProduceMp > 0) {
          const fp = s.finishedProducts.items.find((f) => f.id === line.finishedProductId)
          newPo = buildPoFromSalesLine(
            order,
            line,
            orderId,
            productionLineId,
            dates,
            fp,
            preview.proposeProduceMp,
            s.packagingRecipes,
          )
          createdId = newPo.id
          allocations.push({
            id: crypto.randomUUID(),
            salesOrderId: orderId,
            salesLineId: line.id,
            productionOrderId: newPo.id,
            plannedGoodQty: preview.proposeProduceMp,
            producedAllocatedQty: 0,
            readyAllocatedQty: 0,
            shippedQty: 0,
            status: 'active',
            createdAt: now,
          })
        }

        historyMsgs.push(
          historyEntry('planned', planHistoryMessage(line, preview, productionLineId)),
        )

        const plannerOrders = newPo
          ? [...s.production.planner.orders, newPo]
          : s.production.planner.orders

        let nextOrder: SalesOrder = {
          ...order,
          commercialStatus: 'confirmed',
          lines: order.lines.map((l) =>
            l.id === salesLineId
              ? {
                  ...l,
                  productionOrderIds: newPo
                    ? [...l.productionOrderIds, newPo.id]
                    : l.productionOrderIds,
                }
              : l,
          ),
          history: [...order.history, ...historyMsgs],
        }
        nextOrder = syncOrderAfterPlan(nextOrder, allocations, reservations)

        let next: AppStore = {
          ...s,
          warehouse,
          sales: {
            ...s.sales,
            orders: s.sales.orders.map((o) => (o.id === orderId ? nextOrder : o)),
            reservations,
            allocations,
          },
          production: {
            ...s.production,
            planner: normalizePlanner({ ...s.production.planner, orders: plannerOrders }),
          },
        }
        next = appendAudit(next, {
          action: 'sales_order_plan',
          detail: `Планирование ЗК ${order.orderNumber}: резерв ${preview.proposeReserveMp}, ПЗ ${preview.proposeProduceMp} п.м`,
          ...actorAuditFields(getActor),
        })
        return next
      })
      return createdId
    },

    /** Обеспечить все незакрытые позиции заказа клиента */
    planAllSalesLines(
      orderId: string,
      dates: { startDate: string; endDate: string },
      productionLineId?: ProductionLineId,
    ): { created: string[]; skipped: number; reservedMp: number } {
      const result = { created: [] as string[], skipped: 0, reservedMp: 0 }
      patchStore(setStore, (s) => {
        const order = s.sales.orders.find((o) => o.id === orderId)
        if (!order) return s
        const commercial = order.commercialStatus ?? splitCommercial(order.status)
        if (commercial !== 'confirmed') return s

        let warehouse = s.warehouse
        const reservations = [...(s.sales.reservations ?? [])]
        const allocations = [...(s.sales.allocations ?? [])]
        let lines = order.lines
        const newPos: ProductionOrder[] = []
        const historyMsgs: SalesOrderHistoryEntry[] = []
        const now = new Date().toISOString()

        for (const line of order.lines) {
          const preview = buildPlanSalesLinePreview({
            order: { ...order, lines },
            line,
            warehouse,
            finishedProducts: s.finishedProducts.items,
            reservations,
            allocations,
          })
          if (preview.remainingToEnsureMp <= 0) {
            result.skipped += 1
            continue
          }

          let newPo: ProductionOrder | null = null
          if (preview.proposeReserveMp > 0 && preview.warehouseItemId) {
            const moved = appendSalesFgReserveMovement(warehouse, {
              warehouseItemId: preview.warehouseItemId,
              quantity: preview.proposeReserveMp,
              comment: `Резерв ЗК ${order.orderNumber} · ${line.productName}`,
            })
            if (moved) {
              warehouse = moved.store
              reservations.push({
                id: crypto.randomUUID(),
                salesOrderId: orderId,
                salesLineId: line.id,
                warehouseItemId: preview.warehouseItemId,
                quantity: preview.proposeReserveMp,
                reservationType: 'sales_order',
                status: 'active',
                warehouseMovementId: moved.movement.id,
                createdAt: now,
              })
              result.reservedMp += preview.proposeReserveMp
            }
          }
          if (preview.proposeProduceMp > 0) {
            const fp = s.finishedProducts.items.find((f) => f.id === line.finishedProductId)
            newPo = buildPoFromSalesLine(
              order,
              line,
              orderId,
              productionLineId,
              dates,
              fp,
              preview.proposeProduceMp,
              s.packagingRecipes,
            )
            newPos.push(newPo)
            result.created.push(newPo.id)
            allocations.push({
              id: crypto.randomUUID(),
              salesOrderId: orderId,
              salesLineId: line.id,
              productionOrderId: newPo.id,
              plannedGoodQty: preview.proposeProduceMp,
              producedAllocatedQty: 0,
              readyAllocatedQty: 0,
              shippedQty: 0,
              status: 'active',
              createdAt: now,
            })
          }
          historyMsgs.push(
            historyEntry('planned', planHistoryMessage(line, preview, productionLineId)),
          )
          if (newPo) {
            lines = lines.map((l) =>
              l.id === line.id
                ? { ...l, productionOrderIds: [...l.productionOrderIds, newPo!.id] }
                : l,
            )
          }
        }

        if (!historyMsgs.length) return s

        let nextOrder: SalesOrder = {
          ...order,
          commercialStatus: 'confirmed',
          lines,
          history: [...order.history, ...historyMsgs],
        }
        nextOrder = syncOrderAfterPlan(nextOrder, allocations, reservations)

        let next: AppStore = {
          ...s,
          warehouse,
          sales: {
            ...s.sales,
            orders: s.sales.orders.map((o) => (o.id === orderId ? nextOrder : o)),
            reservations,
            allocations,
          },
          production: {
            ...s.production,
            planner: normalizePlanner({
              ...s.production.planner,
              orders: [...s.production.planner.orders, ...newPos],
            }),
          },
        }
        next = appendAudit(next, {
          action: 'sales_order_plan',
          detail: `Планирование всех позиций ЗК ${order.orderNumber}: ПЗ ${result.created.length}, резерв ${result.reservedMp} п.м`,
          ...actorAuditFields(getActor),
        })
        return next
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

function splitCommercial(status: SalesOrderStatus): SalesOrder['commercialStatus'] {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'completed'
  if (status === 'draft') return 'draft'
  return 'confirmed'
}
