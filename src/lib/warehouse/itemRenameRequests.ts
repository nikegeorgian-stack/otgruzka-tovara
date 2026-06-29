import { appendWarehouseAudit } from './audit'
import { upsertWarehouseItemInStore } from './itemHistory'
import type { WarehouseItemRenameRequest, WarehouseStore } from './types'

export type CreateItemRenameRequestInput = {
  itemId: string
  proposedName: string
  proposedUnit?: string
  proposedSku?: string
  note?: string
  requestedBy: string
  requestedByName: string
}

export function openItemRenameRequests(store: WarehouseStore): WarehouseItemRenameRequest[] {
  return (store.itemRenameRequests ?? []).filter((r) => r.status === 'open')
}

export function createWarehouseItemRenameRequest(
  store: WarehouseStore,
  input: CreateItemRenameRequestInput,
): { store: WarehouseStore; ok: boolean; error?: string } {
  const item = store.items.find((i) => i.id === input.itemId && i.active)
  if (!item) return { store, ok: false, error: 'item_not_found' }

  const proposedName = input.proposedName.trim()
  if (!proposedName) return { store, ok: false, error: 'empty_name' }

  const hasOpen = (store.itemRenameRequests ?? []).some(
    (r) => r.itemId === input.itemId && r.status === 'open',
  )
  if (hasOpen) return { store, ok: false, error: 'already_open' }

  const row: WarehouseItemRenameRequest = {
    id: crypto.randomUUID(),
    itemId: item.id,
    previousName: item.name,
    previousUnit: item.unit,
    proposedName,
    proposedUnit: input.proposedUnit?.trim() || undefined,
    proposedSku: input.proposedSku?.trim() || undefined,
    note: input.note?.trim() || undefined,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    status: 'open',
    createdAt: new Date().toISOString(),
  }

  let next: WarehouseStore = {
    ...store,
    itemRenameRequests: [...(store.itemRenameRequests ?? []), row],
  }
  next = appendWarehouseAudit(next, {
    action: 'item_rename',
    detail: `Предложено имя: «${item.name}» → «${proposedName}» · ${input.requestedByName}`,
    itemId: item.id,
    actorId: input.requestedBy,
    actorName: input.requestedByName,
  })
  return { store: next, ok: true }
}

export function resolveWarehouseItemRenameRequest(
  store: WarehouseStore,
  requestId: string,
  status: 'accepted' | 'rejected',
  opts?: { keeperNote?: string; keeperId?: string; keeperName?: string },
): WarehouseStore {
  const requests = store.itemRenameRequests ?? []
  const idx = requests.findIndex((r) => r.id === requestId)
  if (idx < 0) return store

  const prev = requests[idx]!
  if (prev.status !== 'open') return store

  const now = new Date().toISOString()
  const keeper = opts?.keeperName ?? 'Кладовщик'

  let next: WarehouseStore = { ...store }
  const nextRequests = [...requests]
  nextRequests[idx] = {
    ...prev,
    status,
    keeperNote: opts?.keeperNote,
    resolvedBy: opts?.keeperId,
    resolvedByName: keeper,
    resolvedAt: now,
  }
  next = { ...next, itemRenameRequests: nextRequests }

  if (status === 'accepted') {
    const item = next.items.find((i) => i.id === prev.itemId)
    if (item) {
      next = upsertWarehouseItemInStore(next, {
        ...item,
        name: prev.proposedName,
        unit: prev.proposedUnit?.trim() || item.unit,
        sku: prev.proposedSku?.trim() || item.sku,
      })
    }
    next = appendWarehouseAudit(next, {
      action: 'item_rename',
      detail: `Принято: «${prev.previousName}» → «${prev.proposedName}» · ${keeper}`,
      itemId: prev.itemId,
      actorId: opts?.keeperId,
      actorName: keeper,
    })
  } else {
    next = appendWarehouseAudit(next, {
      action: 'item_rename',
      detail: `Отклонено: «${prev.previousName}» → «${prev.proposedName}» · ${keeper}`,
      itemId: prev.itemId,
      actorName: keeper,
    })
  }

  return next
}

export function itemRenameRequestJournal(
  store: WarehouseStore,
): WarehouseItemRenameRequest[] {
  return [...(store.itemRenameRequests ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}
