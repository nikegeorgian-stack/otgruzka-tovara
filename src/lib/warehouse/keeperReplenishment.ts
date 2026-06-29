import { appendWarehouseAudit } from './audit'
import { nextDocumentNumber } from './docNumbering'
import { postWarehouseDocument } from './documents'
import { computeAllBalances, computeReorderRows } from './stock'
import { filterConsumableItems } from './locationKindFilter'
import type {
  KeeperReplenishmentRequest,
  KeeperReplenishmentStatus,
  WarehouseStore,
} from './types'

export type CreateReplenishmentInput = {
  warehouseId: string
  keeperId: string
  keeperName: string
  comment?: string
  lines?: { itemId: string; requestedQty: number; note?: string }[]
}

export type ReceiveReplenishmentLine = {
  itemId: string
  quantity: number
}

export type ReceiveReplenishmentResult =
  | { ok: true; documentId: string; documentNumber: string }
  | { ok: false; error: string }

function suggestRequestNumber(requests: KeeperReplenishmentRequest[], date: string): string {
  const day = date.replace(/-/g, '')
  const prefix = `ЗКл-${day}`
  const used = new Set(requests.filter((r) => r.date === date).map((r) => r.number))
  if (!used.has(`${prefix}-01`)) return `${prefix}-01`
  for (let n = 2; n < 100; n++) {
    const num = `${prefix}-${String(n).padStart(2, '0')}`
    if (!used.has(num)) return num
  }
  return `${prefix}-${Date.now().toString(36).slice(-4)}`
}

function recomputeStatus(req: KeeperReplenishmentRequest): KeeperReplenishmentStatus {
  if (req.status === 'cancelled' || req.status === 'draft' || req.status === 'submitted') {
    return req.status
  }
  const hasLines = req.lines.length > 0
  if (!hasLines) return req.status
  const allReceived = req.lines.every((l) => l.receivedQty >= l.requestedQty - 1e-9)
  const anyReceived = req.lines.some((l) => l.receivedQty > 0)
  if (allReceived) return 'received'
  if (anyReceived) return 'partial'
  return 'submitted'
}

export function activeReplenishmentRequests(store: WarehouseStore): KeeperReplenishmentRequest[] {
  return (store.replenishmentRequests ?? []).filter((r) =>
    ['draft', 'submitted', 'partial'].includes(r.status),
  )
}

export function archivedReplenishmentRequests(store: WarehouseStore): KeeperReplenishmentRequest[] {
  return (store.replenishmentRequests ?? []).filter((r) =>
    ['received', 'cancelled'].includes(r.status),
  )
}

export function createKeeperReplenishment(
  store: WarehouseStore,
  input: CreateReplenishmentInput,
): { store: WarehouseStore; request: KeeperReplenishmentRequest } {
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  const requests = store.replenishmentRequests ?? []
  const request: KeeperReplenishmentRequest = {
    id: crypto.randomUUID(),
    number: suggestRequestNumber(requests, date),
    date,
    warehouseId: input.warehouseId,
    keeperId: input.keeperId,
    keeperName: input.keeperName,
    status: 'draft',
    lines: (input.lines ?? []).map((l) => ({
      itemId: l.itemId,
      requestedQty: l.requestedQty,
      receivedQty: 0,
      note: l.note,
    })),
    warehouseDocumentIds: [],
    comment: input.comment?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }

  let next: WarehouseStore = {
    ...store,
    replenishmentRequests: [...requests, request],
  }
  next = appendWarehouseAudit(next, {
    action: 'item_request',
    detail: `Заявка на пополнение ${request.number} · ${input.keeperName}`,
    actorId: input.keeperId,
    actorName: input.keeperName,
  })
  return { store: next, request }
}

export function createReplenishmentFromDeficit(
  store: WarehouseStore,
  input: Omit<CreateReplenishmentInput, 'lines'>,
): { store: WarehouseStore; request: KeeperReplenishmentRequest | null } {
  const items = filterConsumableItems(
    store.items,
    store.categories,
    input.warehouseId,
    store.locations,
  )
  const balances = computeAllBalances(store, input.warehouseId)
  const deficit = computeReorderRows(items, balances)
  if (deficit.length === 0) return { store, request: null }
  const lines = deficit.map((d) => ({
    itemId: d.item.id,
    requestedQty: d.suggested,
    note: `мин. ${d.minStock}, ост. ${d.available}`,
  }))
  const out = createKeeperReplenishment(store, { ...input, lines })
  return { store: out.store, request: out.request }
}

export function updateKeeperReplenishment(
  store: WarehouseStore,
  requestId: string,
  patch: {
    comment?: string
    lines?: { itemId: string; requestedQty: number; note?: string }[]
  },
): WarehouseStore {
  const requests = store.replenishmentRequests ?? []
  const idx = requests.findIndex((r) => r.id === requestId && r.status === 'draft')
  if (idx < 0) return store
  const prev = requests[idx]!
  const nextRequests = [...requests]
  nextRequests[idx] = {
    ...prev,
    comment: patch.comment !== undefined ? patch.comment.trim() || undefined : prev.comment,
    lines:
      patch.lines !== undefined
        ? patch.lines.map((l) => ({
            itemId: l.itemId,
            requestedQty: l.requestedQty,
            receivedQty: 0,
            note: l.note,
          }))
        : prev.lines,
    updatedAt: new Date().toISOString(),
  }
  return { ...store, replenishmentRequests: nextRequests }
}

export function submitKeeperReplenishment(
  store: WarehouseStore,
  requestId: string,
): WarehouseStore {
  const requests = store.replenishmentRequests ?? []
  const idx = requests.findIndex((r) => r.id === requestId && r.status === 'draft')
  if (idx < 0) return store
  const prev = requests[idx]!
  if (prev.lines.length === 0 || prev.lines.every((l) => l.requestedQty <= 0)) return store
  const now = new Date().toISOString()
  const nextRequests = [...requests]
  nextRequests[idx] = {
    ...prev,
    status: 'submitted',
    submittedAt: now,
    updatedAt: now,
  }
  let next: WarehouseStore = { ...store, replenishmentRequests: nextRequests }
  next = appendWarehouseAudit(next, {
    action: 'item_request',
    detail: `Отправлена заявка ${prev.number} · ${prev.lines.length} поз.`,
    actorName: prev.keeperName,
  })
  return next
}

export function cancelKeeperReplenishment(
  store: WarehouseStore,
  requestId: string,
): WarehouseStore {
  const requests = store.replenishmentRequests ?? []
  const idx = requests.findIndex(
    (r) => r.id === requestId && ['draft', 'submitted', 'partial'].includes(r.status),
  )
  if (idx < 0) return store
  const prev = requests[idx]!
  const now = new Date().toISOString()
  const nextRequests = [...requests]
  nextRequests[idx] = {
    ...prev,
    status: 'cancelled',
    closedAt: now,
    updatedAt: now,
  }
  return { ...store, replenishmentRequests: nextRequests }
}

export function receiveKeeperReplenishment(
  store: WarehouseStore,
  requestId: string,
  receiveLines: ReceiveReplenishmentLine[],
  args: {
    date?: string
    keeperId?: string
    keeperName?: string
    allowNegativeStock?: boolean
  },
): { store: WarehouseStore; result: ReceiveReplenishmentResult } {
  const requests = store.replenishmentRequests ?? []
  const idx = requests.findIndex(
    (r) => r.id === requestId && ['submitted', 'partial'].includes(r.status),
  )
  if (idx < 0) {
    return { store, result: { ok: false, error: 'warehouse.replenishment.errNotFound' } }
  }

  const prev = requests[idx]!
  const date = args.date ?? new Date().toISOString().slice(0, 10)
  const docLines: { itemId: string; quantity: number }[] = []

  const updatedLines = prev.lines.map((line) => {
    const recv = receiveLines.find((r) => r.itemId === line.itemId)
    if (!recv || recv.quantity <= 0) return line
    const remaining = Math.max(0, line.requestedQty - line.receivedQty)
    const qty = Math.min(recv.quantity, remaining)
    if (qty <= 0) return line
    docLines.push({ itemId: line.itemId, quantity: qty })
    return { ...line, receivedQty: line.receivedQty + qty }
  })

  if (docLines.length === 0) {
    return { store, result: { ok: false, error: 'warehouse.replenishment.errNothing' } }
  }

  const number = nextDocumentNumber(store.documents, 'receipt', date)
  const { store: afterDoc, result } = postWarehouseDocument(store, {
    type: 'receipt',
    number,
    date,
    warehouseId: prev.warehouseId,
    purpose: 'other',
    comment: `На основании ${prev.number}`,
    keeperRequestId: prev.id,
    keeperId: args.keeperId,
    keeperName: args.keeperName,
    lines: docLines,
  })

  if (!result.ok) {
    return { store, result: { ok: false, error: result.error } }
  }

  const documentId = result.documentId
  const now = new Date().toISOString()
  const merged: KeeperReplenishmentRequest = {
    ...prev,
    lines: updatedLines,
    warehouseDocumentIds: [...prev.warehouseDocumentIds, documentId],
    updatedAt: now,
    status: 'submitted',
  }
  merged.status = recomputeStatus(merged)
  if (merged.status === 'received') merged.closedAt = now

  const nextRequests = [...(afterDoc.replenishmentRequests ?? requests)]
  const reqIdx = nextRequests.findIndex((r) => r.id === requestId)
  if (reqIdx >= 0) nextRequests[reqIdx] = merged

  let next: WarehouseStore = { ...afterDoc, replenishmentRequests: nextRequests }
  next = appendWarehouseAudit(next, {
    action: 'document_post',
    detail: `Приход по заявке ${prev.number} → ${number}`,
    actorName: args.keeperName,
  })

  return {
    store: next,
    result: { ok: true, documentId, documentNumber: number },
  }
}
