import { allocateOrderNumber } from '@/lib/procurement/codes'
import { normalizeProcurementStore } from '@/lib/procurement/init'
import { receivePurchaseOrderInStore, type ReceiveOrderResult } from '@/lib/procurement/receive'
import { applyStatusHistory, createStatusChange } from '@/lib/procurement/statusHistory'
import type {
  ProcurementCategoryNode,
  PurchaseOrder,
  ProcurementStore,
  RoutePoint,
  ShipmentMilestone,
} from '@/lib/procurement/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { isG5ProcurementActive } from '@/lib/planner/g5Activation'

function patchProcurement(
  setStore: StoreSliceDeps['setStore'],
  fn: (p: ProcurementStore) => ProcurementStore,
) {
  patchStore(setStore, (s) => ({
    ...s,
    procurement: fn(s.procurement ?? normalizeProcurementStore(undefined)),
  }))
}

export function createProcurementSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  return {
    async upsertPurchaseOrder(order: PurchaseOrder, statusNote?: string) {
      if (isG5ProcurementActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const isDraft = !order.status || order.status === 'draft'
          const conf = await executeG5Command({
            idempotencyKey: `g5-po-${order.id}-${order.updatedAt || Date.now()}`,
            commandType: isDraft ? 'procurement.draft.edit' : 'procurement.order.change',
            command: {
              id: order.id,
              supplierId: order.counterpartyId,
              lines: (order.lines ?? []).map((l) => ({
                lineId: l.id,
                itemId: l.warehouseItemId,
                requestedQty: l.quantity,
                unit: l.unit,
              })),
            },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

      patchProcurement(setStore, (p) => {
        const existing = p.orders.find((o) => o.id === order.id)
        const exists = Boolean(existing)
        const now = new Date().toISOString()
        const normalized: PurchaseOrder = {
          ...order,
          statusHistory: applyStatusHistory(existing, order, statusNote),
          updatedAt: now,
          createdAt: order.createdAt ?? now,
        }
        let nextOrderSeq = p.nextOrderSeq
        if (!exists) {
          const m = order.orderNumber.match(/-(\d+)$/)
          if (m) nextOrderSeq = Math.max(nextOrderSeq, Number(m[1]) + 1)
        }
        return {
          ...p,
          nextOrderSeq,
          orders: exists
            ? p.orders.map((o) => (o.id === order.id ? normalized : o))
            : [...p.orders, normalized],
        }
      })
    },

    async createPurchaseOrder(
      partial: Omit<PurchaseOrder, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'> & {
        id?: string
        orderNumber?: string
      },
    ): Promise<string> {
      if (isG5ProcurementActive(getStore())) {
        const { isG5WebPath } = await import('@/lib/planner/g5ServerClient')
        if (isG5WebPath()) {
          // Freehand PO create is not a G5 command — drafts come from MRP generateDraftsFromMrp.
          throw new Error('g5.error.use_g5_gateway')
        }
      }

      let newId = ''
      patchProcurement(setStore, (p) => {
        const { orderNumber, nextOrderSeq } = allocateOrderNumber(p)
        const now = new Date().toISOString()
        newId = partial.id ?? crypto.randomUUID()
        const order: PurchaseOrder = {
          ...partial,
          id: newId,
          orderNumber: partial.orderNumber ?? orderNumber,
          lines: partial.lines ?? [],
          legs: partial.legs ?? [],
          milestones: partial.milestones ?? [],
          statusHistory: [
            createStatusChange(undefined, partial.status ?? 'draft'),
          ],
          attachments: partial.attachments ?? [],
          warehouseDocumentIds: partial.warehouseDocumentIds ?? [],
          createdAt: now,
          updatedAt: now,
        }
        return {
          ...p,
          nextOrderSeq,
          orders: [...p.orders, order],
        }
      })
      return newId
    },

    removePurchaseOrder(id: string) {
      recordSliceExplicitDelete('procurement.orders', id, actorFromGetter(getActor))
      patchProcurement(setStore, (p) => ({
        ...p,
        orders: p.orders.filter((o) => o.id !== id),
      }))
    },

    addPurchaseOrderMilestone(orderId: string, milestone: Omit<ShipmentMilestone, 'id'>) {
      patchProcurement(setStore, (p) => ({
        ...p,
        orders: p.orders.map((o) => {
          if (o.id !== orderId) return o
          return {
            ...o,
            milestones: [
              ...o.milestones,
              { ...milestone, id: crypto.randomUUID() },
            ],
            updatedAt: new Date().toISOString(),
          }
        }),
      }))
    },

    receivePurchaseOrder(
      orderId: string,
      opts?: import('@/lib/procurement/receive').ReceiveOrderOpts,
    ): ReceiveOrderResult {
      if (isG5ProcurementActive(getStore())) {
        return { ok: false, error: 'g5.error.use_g5_gateway' }
      }
      let result: ReceiveOrderResult = { ok: false, error: 'procurement.receive.errNotFound' }
      patchStore(setStore, (s) => {
        const out = receivePurchaseOrderInStore(s, orderId, opts)
        result = out.result
        return out.result.ok ? out.store : s
      })
      return result
    },

    async receivePurchaseOrderViaG5(
      orderId: string,
      opts: {
        lines: Array<{
          lineId: string
          quantity: number
          batchId?: string
          expiryDate?: string
          warehouseId?: string
          locationId?: string
        }>
        note?: string
      },
    ) {
      if (!isG5ProcurementActive(getStore())) {
        throw new Error('g5.error.use_g5_gateway')
      }
      const { isG5WebPath, g5ProcurementReceiptPost, mirrorG5Ack } = await import(
        '@/lib/planner/g5ServerClient'
      )
      if (!isG5WebPath()) {
        throw new Error('g5.error.use_g5_gateway')
      }
      const conf = await g5ProcurementReceiptPost({
        idempotencyKey: `g5-po-receipt-${orderId}-${Date.now()}`,
        command: { id: orderId, orderId, lines: opts.lines, note: opts.note },
      })
      if (!conf.ok) {
        throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
      }
      setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
      return conf.data
    },

    async setPurchaseOrderStatus(
      orderId: string,
      status: PurchaseOrder['status'],
      note?: string,
    ) {
      if (isG5ProcurementActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const map: Record<string, string> = {
            ordered: 'procurement.order.markOrdered',
            submitted: 'procurement.order.submit',
            approved: 'procurement.order.approve',
            cancelled: 'procurement.order.cancel',
          }
          // Legacy status names → G5 commands where possible
          const commandType =
            map[status] ??
            (status === 'received' || status === 'partial'
              ? null
              : status === 'draft'
                ? 'procurement.draft.edit'
                : 'procurement.order.change')
          if (!commandType) {
            throw new Error('g5.error.use_g5_gateway')
          }
          const conf = await executeG5Command({
            idempotencyKey: `g5-po-status-${orderId}-${status}-${Date.now()}`,
            commandType,
            command: { id: orderId, note },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

      patchProcurement(setStore, (p) => ({
        ...p,
        orders: p.orders.map((o) => {
          if (o.id !== orderId) return o
          if (o.status === status) return o
          const now = new Date().toISOString()
          return {
            ...o,
            status,
            statusHistory: [
              ...o.statusHistory,
              createStatusChange(o.status, status, note),
            ],
            updatedAt: now,
          }
        }),
      }))
    },

    upsertProcurementCategory(cat: ProcurementCategoryNode) {
      patchProcurement(setStore, (p) => {
        const exists = p.categories.some((c) => c.id === cat.id)
        return {
          ...p,
          categories: exists
            ? p.categories.map((c) => (c.id === cat.id ? cat : c))
            : [...p.categories, cat],
        }
      })
    },

    removeProcurementCategory(id: string): boolean {
      let ok = false
      patchProcurement(setStore, (p) => {
        const hasKids = p.categories.some((c) => c.parentId === id)
        const inUse = p.orders.some((o) => o.categoryId === id)
        if (hasKids || inUse) return p
        ok = true
        return { ...p, categories: p.categories.filter((c) => c.id !== id) }
      })
      if (ok) recordSliceExplicitDelete('procurement.categories', id, actorFromGetter(getActor))
      return ok
    },

    upsertRoutePoint(point: RoutePoint) {
      patchProcurement(setStore, (p) => {
        const exists = p.routePoints.some((r) => r.id === point.id)
        return {
          ...p,
          routePoints: exists
            ? p.routePoints.map((r) => (r.id === point.id ? point : r))
            : [...p.routePoints, point],
        }
      })
    },

    removeRoutePoint(id: string): boolean {
      let ok = false
      patchProcurement(setStore, (p) => {
        const inUse = p.orders.some((o) =>
          o.legs.some((l) => l.originPointId === id || l.destinationPointId === id),
        )
        if (inUse) return p
        ok = true
        return { ...p, routePoints: p.routePoints.filter((r) => r.id !== id) }
      })
      if (ok) recordSliceExplicitDelete('procurement.routePoints', id, actorFromGetter(getActor))
      return ok
    },
  }
}
