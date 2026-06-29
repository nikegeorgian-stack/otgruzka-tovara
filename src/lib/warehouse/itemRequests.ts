import { appendWarehouseAudit } from './audit'
import type { WarehouseItemRequest, WarehouseStore } from './types'

export type CreateItemRequestInput = {
  name: string
  unit?: string
  categoryHint?: string
  note?: string
  recipeCode?: string
  requestedBy: string
  requestedByName: string
}

export function createWarehouseItemRequest(
  store: WarehouseStore,
  input: CreateItemRequestInput,
): WarehouseStore {
  const name = input.name.trim()
  if (!name) return store

  const row: WarehouseItemRequest = {
    id: crypto.randomUUID(),
    name,
    unit: input.unit?.trim() || 'кг',
    categoryHint: input.categoryHint?.trim() || undefined,
    note: input.note?.trim() || undefined,
    recipeCode: input.recipeCode?.trim() || undefined,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    status: 'open',
    createdAt: new Date().toISOString(),
  }

  let next: WarehouseStore = {
    ...store,
    itemRequests: [...(store.itemRequests ?? []), row],
  }
  next = appendWarehouseAudit(next, {
    action: 'item_request',
    detail: `Заявка на номенклатуру: ${name} · ${input.requestedByName}`,
    actorId: input.requestedBy,
    actorName: input.requestedByName,
  })
  return next
}

export function resolveWarehouseItemRequest(
  store: WarehouseStore,
  requestId: string,
  status: 'fulfilled' | 'rejected',
  opts?: { fulfilledItemId?: string; keeperNote?: string; keeperName?: string },
): WarehouseStore {
  const requests = store.itemRequests ?? []
  const idx = requests.findIndex((r) => r.id === requestId)
  if (idx < 0) return store

  const prev = requests[idx]!
  if (prev.status !== 'open') return store

  const now = new Date().toISOString()
  const nextRequests = [...requests]
  nextRequests[idx] = {
    ...prev,
    status,
    fulfilledItemId: opts?.fulfilledItemId,
    keeperNote: opts?.keeperNote,
    resolvedAt: now,
  }

  let next: WarehouseStore = { ...store, itemRequests: nextRequests }
  const keeper = opts?.keeperName ?? 'Кладовщик'
  next = appendWarehouseAudit(next, {
    action: 'item_request',
    detail:
      status === 'fulfilled'
        ? `Заявка выполнена: ${prev.name} · ${keeper}`
        : `Заявка отклонена: ${prev.name} · ${keeper}`,
    itemId: opts?.fulfilledItemId,
    actorName: keeper,
  })
  return next
}

export function openItemRequests(store: WarehouseStore): WarehouseItemRequest[] {
  return (store.itemRequests ?? []).filter((r) => r.status === 'open')
}
