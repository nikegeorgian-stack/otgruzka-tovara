import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderStatusChange,
} from './types'

export function createStatusChange(
  fromStatus: PurchaseOrderStatus | undefined,
  toStatus: PurchaseOrderStatus,
  note?: string,
): PurchaseOrderStatusChange {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    fromStatus,
    toStatus,
    note: note?.trim() || undefined,
  }
}

export function normalizeStatusChange(
  raw: Partial<PurchaseOrderStatusChange>,
): PurchaseOrderStatusChange {
  return {
    id: raw.id ?? crypto.randomUUID(),
    at: raw.at ?? new Date().toISOString(),
    fromStatus: raw.fromStatus as PurchaseOrderStatus | undefined,
    toStatus: (raw.toStatus ?? 'draft') as PurchaseOrderStatus,
    note: raw.note?.trim() || undefined,
  }
}

/** Собирает журнал при сохранении: не дублирует, если статус не менялся */
export function applyStatusHistory(
  previous: PurchaseOrder | undefined,
  next: PurchaseOrder,
  statusNote?: string,
): PurchaseOrderStatusChange[] {
  const history = (previous?.statusHistory ?? next.statusHistory ?? []).map(normalizeStatusChange)

  if (!previous) {
    return [createStatusChange(undefined, next.status, statusNote)]
  }

  if (previous.status === next.status) {
    return history
  }

  return [...history, createStatusChange(previous.status, next.status, statusNote)]
}

export function backfillStatusHistory(order: PurchaseOrder): PurchaseOrderStatusChange[] {
  if (order.statusHistory?.length) {
    return order.statusHistory.map(normalizeStatusChange)
  }
  return [
    {
      id: crypto.randomUUID(),
      at: order.createdAt,
      toStatus: order.status,
    },
  ]
}
