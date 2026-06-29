import { allocateOrderNumber } from '@/lib/procurement/codes'
import { normalizeProcurementStore } from '@/lib/procurement/init'
import { receivePurchaseOrderInStore, type ReceiveOrderResult } from '@/lib/procurement/receive'
import { applyStatusHistory, createStatusChange } from '@/lib/procurement/statusHistory'
import type { PurchaseOrder, ProcurementStore, ShipmentMilestone } from '@/lib/procurement/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

function patchProcurement(
  setStore: StoreSliceDeps['setStore'],
  fn: (p: ProcurementStore) => ProcurementStore,
) {
  patchStore(setStore, (s) => ({
    ...s,
    procurement: fn(s.procurement ?? normalizeProcurementStore(undefined)),
  }))
}

export function createProcurementSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertPurchaseOrder(order: PurchaseOrder, statusNote?: string) {
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

    createPurchaseOrder(
      partial: Omit<PurchaseOrder, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'> & {
        id?: string
        orderNumber?: string
      },
    ): string {
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

    receivePurchaseOrder(orderId: string): ReceiveOrderResult {
      let result: ReceiveOrderResult = { ok: false, error: 'procurement.receive.errNotFound' }
      patchStore(setStore, (s) => {
        const out = receivePurchaseOrderInStore(s, orderId)
        result = out.result
        return out.result.ok ? out.store : s
      })
      return result
    },

    setPurchaseOrderStatus(orderId: string, status: PurchaseOrder['status'], note?: string) {
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
  }
}
