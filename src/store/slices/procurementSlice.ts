import { allocateOrderNumber } from '@/lib/procurement/codes'
import { normalizeProcurementStore } from '@/lib/procurement/init'
import {
  applyPurchaseOrderReceiptAck,
  buildAuthoritativePurchaseOrderReceiptPlan,
  preparePurchaseOrderReceipt,
  receivePurchaseOrderInStore,
  type ReceiveOrderResult,
} from '@/lib/procurement/receive'
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
import { isG1WebAuthoritativePath } from '@/lib/warehouse/g1ServerClient'

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
  const api = {
    async upsertPurchaseOrder(order: PurchaseOrder, statusNote?: string) {
      if (isG5ProcurementActive(getStore())) {
        const {
          g5ProcurementCommandFingerprint,
          isG5WebPath,
          executeG5Command,
          mirrorG5Ack,
          validateG5ProcurementOrderAck,
        } = await import('@/lib/planner/g5ServerClient')
        if (isG5WebPath()) {
          const before = getStore()
          const existing = before.procurement.orders.find((row) => row.id === order.id)
          const statusTransitions: Record<string, { commandType: string; operation: 'submit' | 'approve' | 'markOrdered' | 'cancel' }> = {
            submitted: { commandType: 'procurement.order.submit', operation: 'submit' },
            approved: { commandType: 'procurement.order.approve', operation: 'approve' },
            ordered: { commandType: 'procurement.order.markOrdered', operation: 'markOrdered' },
            cancelled: { commandType: 'procurement.order.cancel', operation: 'cancel' },
          }
          const transition =
            existing && existing.status !== order.status
              ? statusTransitions[String(order.status)]
              : undefined
          const isCreate = !existing
          const commandType = isCreate
            ? 'procurement.draft.create'
            : transition?.commandType ??
              (order.status === 'draft'
                ? 'procurement.draft.edit'
                : 'procurement.order.change')
          const command = transition
            ? { id: order.id, note: statusNote }
            : {
                id: order.id,
                supplierId: order.counterpartyId,
                destinationWarehouseId: order.destinationWarehouseId,
                orderDate: order.orderDate,
                requestedDeliveryDate: order.requestedDeliveryDate,
                scope: order.scope,
                category: order.category,
                categoryId: order.categoryId,
                currency: order.currency,
                ...(statusNote ? { reason: statusNote } : {}),
                lines: (order.lines ?? []).map((line) => ({
                  lineId: line.id,
                  itemId: line.warehouseItemId,
                  requestedQty: line.quantity,
                  unit: line.unit,
                  unitPrice: line.unitPrice,
                })),
              }
          const createFingerprint = isCreate
            ? g5ProcurementCommandFingerprint(
                'procurement.draft.create',
                command as Record<string, unknown>,
              )
            : undefined
          const conf = await executeG5Command({
            idempotencyKey: isCreate
              ? `g5-po-create-${createFingerprint}`
              : `g5-po-${commandType}-${order.id}-${order.updatedAt || Date.now()}`,
            commandType,
            command,
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          const sourceOrder = transition && existing ? existing : order
          const expectedLines = sourceOrder.lines.map((line) => ({
            ...(isCreate ? {} : { lineId: line.id }),
            itemId: String(line.warehouseItemId ?? ''),
            requestedQty: line.quantity,
            unit: line.unit,
          }))
          const validated = validateG5ProcurementOrderAck(
            conf.data,
            Number(
              (before.production as { g5CriticalRevision?: number }).g5CriticalRevision ?? 0,
            ),
            {
              operation: isCreate ? 'create' : transition?.operation ?? 'edit',
              ...(isCreate ? {} : { orderId: order.id }),
              status: String(order.status || 'draft'),
              supplierId: sourceOrder.counterpartyId,
              destinationWarehouseId: sourceOrder.destinationWarehouseId,
              commandFingerprint: createFingerprint,
              lines: expectedLines,
            },
          )
          if (!validated.ok) throw new Error(validated.error)
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return validated.order.id
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
      return order.id
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
          const now = new Date().toISOString()
          const id = partial.id ?? crypto.randomUUID()
          const order: PurchaseOrder = {
            ...partial,
            id,
            orderNumber: '',
            status: 'draft',
            lines: partial.lines ?? [],
            legs: partial.legs ?? [],
            milestones: partial.milestones ?? [],
            statusHistory: [],
            attachments: partial.attachments ?? [],
            warehouseDocumentIds: partial.warehouseDocumentIds ?? [],
            createdAt: now,
            updatedAt: now,
          }
          return (await api.upsertPurchaseOrder(order)) ?? id
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
      if (isG5ProcurementActive(getStore()) || isG1WebAuthoritativePath()) {
        return { ok: false, error: 'warehouse.g1.errUseAuthoritativePost' }
      }
      let result: ReceiveOrderResult = { ok: false, error: 'procurement.receive.errNotFound' }
      patchStore(setStore, (s) => {
        const out = receivePurchaseOrderInStore(s, orderId, opts)
        result = out.result
        return out.result.ok ? out.store : s
      })
      return result
    },

    async receivePurchaseOrderAuthoritative(
      orderId: string,
      opts?: import('@/lib/procurement/receive').ReceiveOrderOpts,
    ): Promise<ReceiveOrderResult> {
      if (isG5ProcurementActive(getStore())) {
        const before = getStore()
        const prepared = buildAuthoritativePurchaseOrderReceiptPlan(before, orderId, opts)
        if (!prepared.ok) return { ok: false, error: prepared.error }
        try {
          const data = await api.receivePurchaseOrderViaG5(orderId, {
            warehouseId: prepared.warehouseId,
            date: prepared.date,
            lines: prepared.lines,
          })
          const {
            g5ProcurementCommandFingerprint,
            mirrorG5Ack,
            validateG5ProcurementReceiptAck,
          } = await import('@/lib/planner/g5ServerClient')
          const expectedCommandFingerprint = g5ProcurementCommandFingerprint(
            'procurement.receipt.post',
            {
              id: orderId,
              purchaseOrderId: orderId,
              warehouseId: prepared.warehouseId,
              date: prepared.date,
              lines: prepared.lines.map((line) => ({
                lineId: line.lineId,
                itemId: line.itemId,
                quantity: line.quantity,
                unit: line.unit,
                ...(line.locationId ? { locationId: line.locationId } : {}),
                ...(line.batchNo ? { batchNo: line.batchNo } : {}),
                ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
              })),
            },
          )
          const validated = validateG5ProcurementReceiptAck(
            data,
            Number(
              (before.production as { g5CriticalRevision?: number }).g5CriticalRevision ?? 0,
            ),
            {
              purchaseOrderId: prepared.purchaseOrderId,
              warehouseId: prepared.warehouseId,
              date: prepared.date,
              commandFingerprint: expectedCommandFingerprint,
              lines: prepared.lines,
            },
            before.warehouse,
          )
          if (!validated.ok) return { ok: false, error: validated.error }
          setStore((s) => mirrorG5Ack(s, data), { origin: 'system' })
          return { ok: true, documentId: validated.documentId }
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : 'g5.error.use_g5_gateway',
          }
        }
      }

      if (!isG1WebAuthoritativePath()) {
        return api.receivePurchaseOrder(orderId, opts)
      }

      const prepared = preparePurchaseOrderReceipt(getStore(), orderId, opts)
      if (!prepared.ok) return { ok: false, error: prepared.error }

      patchStore(setStore, (s) => ({
        ...s,
        warehouse: prepared.warehouseWithItems,
      }))

      const { g1PostWarehouseDocument, mirrorAuthoritativeWarehousePost } = await import(
        '@/lib/warehouse/g1ServerClient'
      )
      const idempotencyKey = `po-receipt-${orderId}-${prepared.number}-${[
        ...prepared.receivedAdd.entries(),
      ]
        .map(([id, q]) => `${id}:${q}`)
        .join('|')}`

      const server = await g1PostWarehouseDocument({
        idempotencyKey,
        command: {
          type: 'receipt',
          warehouseId: prepared.documentInput.warehouseId,
          date: prepared.documentInput.date,
          number: prepared.documentInput.number,
          lines: prepared.documentInput.lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            inputUnit: line.inputUnit,
            itemNameSnapshot: line.itemNameSnapshot,
            itemCodeSnapshot: line.itemCodeSnapshot,
            unitSnapshot: line.unitSnapshot,
          })),
          purpose: 'purchase',
        },
      })
      if (!server.ok) {
        return { ok: false, error: server.error || 'warehouse.g1.errServer' }
      }

      setStore(
        (s) => {
          const withWh = {
            ...s,
            warehouse: mirrorAuthoritativeWarehousePost(s.warehouse, server.data.warehouse),
          }
          return applyPurchaseOrderReceiptAck(
            withWh,
            prepared,
            server.data.documentId,
            withWh.warehouse,
          )
        },
        { origin: 'user' },
      )
      return { ok: true, documentId: server.data.documentId }
    },

    async receivePurchaseOrderViaG5(
      orderId: string,
      opts: {
        warehouseId: string
        date: string
        lines: Array<{
          lineId: string
          itemId: string
          quantity: number
          unit: string
          batchNo?: string
          expiryDate?: string
          locationId?: string
          expectedReceivedQty?: number
        }>
        note?: string
      },
    ) {
      if (!isG5ProcurementActive(getStore())) {
        throw new Error('g5.error.use_g5_gateway')
      }
      const {
        g5ProcurementCommandFingerprint,
        isG5WebPath,
        g5ProcurementReceiptPost,
      } = await import(
        '@/lib/planner/g5ServerClient'
      )
      if (!isG5WebPath()) {
        throw new Error('g5.error.use_g5_gateway')
      }
      const command = {
        id: orderId,
        purchaseOrderId: orderId,
        warehouseId: opts.warehouseId,
        date: opts.date,
        lines: opts.lines.map((line) => ({
          lineId: line.lineId,
          itemId: line.itemId,
          quantity: line.quantity,
          unit: line.unit,
          ...(line.locationId ? { locationId: line.locationId } : {}),
          ...(line.batchNo ? { batchNo: line.batchNo } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
        })),
        note: opts.note,
      }
      const commandFingerprint = g5ProcurementCommandFingerprint(
        'procurement.receipt.post',
        command,
      )
      const conf = await g5ProcurementReceiptPost({
        idempotencyKey: `g5-po-receipt-${commandFingerprint}`,
        command,
      })
      if (!conf.ok) {
        throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
      }
      return conf.data
    },

    async setPurchaseOrderStatus(
      orderId: string,
      status: PurchaseOrder['status'],
      note?: string,
    ) {
      if (isG5ProcurementActive(getStore())) {
        const { isG5WebPath } = await import('@/lib/planner/g5ServerClient')
        if (isG5WebPath()) {
          const order = getStore().procurement.orders.find((row) => row.id === orderId)
          if (!order) throw new Error('procurement.receive.errNotFound')
          await api.upsertPurchaseOrder({ ...order, status }, note)
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
  return api
}
