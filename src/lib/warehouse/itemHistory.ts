import { withSuggestedLocalizedNames } from '@/lib/i18n/localizedNames'
import { applyTechnicalNameOnUpsert } from './technicalName'
import {
  allocateUniqueInternalCode,
  assertSkuAvailable,
  nextInternalCodeNumber as nextIcNum,
  resolveCreateInternalCode,
} from './itemIdentity'
import type {
  WarehouseCategory,
  WarehouseItem,
  WarehouseItemHistoryEntry,
  WarehouseLocation,
  WarehouseStore,
} from './types'
import type { AccessRoleId } from '@/lib/access/types'

export {
  WarehouseItemIdentityError,
  formatInternalCode,
  parseInternalCodeNum,
  nextInternalCodeNumber,
  allocateUniqueInternalCode,
} from './itemIdentity'

export function allocateInternalCode(store: WarehouseStore): string {
  return allocateUniqueInternalCode(store).code
}

function newHistoryId(): string {
  return crypto.randomUUID()
}

function entry(
  partial: Omit<WarehouseItemHistoryEntry, 'id' | 'at'>,
): WarehouseItemHistoryEntry {
  return {
    id: newHistoryId(),
    at: new Date().toISOString(),
    ...partial,
  }
}

function catName(categories: WarehouseCategory[], id: string): string {
  return categories.find((c) => c.id === id)?.name ?? id
}

function locName(locations: WarehouseLocation[], id: string): string {
  return locations.find((l) => l.id === id)?.name ?? id
}

export function diffItemHistory(
  before: WarehouseItem,
  after: WarehouseItem,
  categories: WarehouseCategory[],
  locations: WarehouseLocation[],
): WarehouseItemHistoryEntry[] {
  const entries: WarehouseItemHistoryEntry[] = []

  if (before.name.trim() !== after.name.trim()) {
    entries.push(
      entry({
        kind: 'renamed',
        field: 'name',
        oldValue: before.name,
        newValue: after.name,
        detail: `Переименование: «${before.name}» → «${after.name}»`,
      }),
    )
  }

  const scalarChanges: {
    field: keyof WarehouseItem
    label: string
    fmt?: (v: unknown) => string
  }[] = [
    { field: 'categoryId', label: 'Категория', fmt: (v) => catName(categories, String(v)) },
    { field: 'warehouseId', label: 'Склад', fmt: (v) => locName(locations, String(v)) },
    { field: 'unit', label: 'Ед. изм.' },
    { field: 'sku', label: 'Артикул' },
    { field: 'barcode', label: 'Штрихкод' },
    { field: 'price', label: 'Цена', fmt: (v) => (v == null ? '—' : String(v)) },
    { field: 'minStock', label: 'Мин. остаток', fmt: (v) => (v == null ? '—' : String(v)) },
    { field: 'note', label: 'Примечание' },
    { field: 'technicalName', label: 'Техническое название' },
  ]

  for (const { field, label, fmt } of scalarChanges) {
    const oldV = before[field]
    const newV = after[field]
    if (oldV === newV) continue
    if (field === 'sku' || field === 'barcode' || field === 'note' || field === 'technicalName') {
      if ((oldV ?? '') === (newV ?? '')) continue
    }
    const oldS = fmt ? fmt(oldV) : String(oldV ?? '—')
    const newS = fmt ? fmt(newV) : String(newV ?? '—')
    entries.push(
      entry({
        kind: 'field_change',
        field,
        oldValue: oldS,
        newValue: newS,
        detail: `${label}: ${oldS} → ${newS}`,
      }),
    )
  }

  const oldPhoto = !!before.photoDataUrl
  const newPhoto = !!after.photoDataUrl
  if (oldPhoto !== newPhoto) {
    entries.push(
      entry({
        kind: 'field_change',
        field: 'photoDataUrl',
        detail: newPhoto ? 'Добавлено фото' : 'Удалено фото',
      }),
    )
  }

  const oldConv = JSON.stringify(before.unitConversions ?? [])
  const newConv = JSON.stringify(after.unitConversions ?? [])
  if (oldConv !== newConv) {
    entries.push(
      entry({
        kind: 'field_change',
        field: 'unitConversions',
        oldValue: oldConv === '[]' ? '—' : oldConv,
        newValue: newConv === '[]' ? '—' : newConv,
        detail: 'Изменены единицы пересчёта',
      }),
    )
  }

  return entries
}

export function appendItemHistory(
  histories: Record<string, WarehouseItemHistoryEntry[]>,
  itemId: string,
  newEntries: WarehouseItemHistoryEntry[],
): Record<string, WarehouseItemHistoryEntry[]> {
  if (!newEntries.length) return histories
  const prev = histories[itemId] ?? []
  return {
    ...histories,
    [itemId]: [...newEntries, ...prev].slice(0, 200),
  }
}

export function getItemHistory(
  store: WarehouseStore,
  itemId: string,
): WarehouseItemHistoryEntry[] {
  return store.itemHistories?.[itemId] ?? []
}

export function upsertWarehouseItemInStore(
  store: WarehouseStore,
  incoming: WarehouseItem,
  actorRole?: AccessRoleId | string | null,
): WarehouseStore {
  const existing = store.items.find((i) => i.id === incoming.id)
  incoming = applyTechnicalNameOnUpsert(existing, incoming, store.locations, actorRole)
  let itemHistories = store.itemHistories ?? {}

  if (!existing) {
    assertSkuAvailable(store.items, incoming.sku, incoming.id)
    const { code: internalCode, nextCounter } = resolveCreateInternalCode(
      store,
      incoming.internalCode,
      incoming.id,
    )
    const now = new Date().toISOString()
    const item: WarehouseItem = withSuggestedLocalizedNames({
      ...incoming,
      internalCode,
      createdAt: now,
    })
    itemHistories = appendItemHistory(itemHistories, item.id, [
      entry({
        kind: 'created',
        newValue: item.name,
        detail: `Создана позиция «${item.name}» · код ${internalCode}`,
      }),
    ])
    return {
      ...store,
      nextInternalCode: nextCounter,
      items: [...store.items, item],
      itemHistories,
    }
  }

  assertSkuAvailable(store.items, incoming.sku, existing.id)

  const item: WarehouseItem = {
    ...incoming,
    internalCode: existing.internalCode,
    createdAt: existing.createdAt ?? incoming.createdAt,
  }

  const changes = diffItemHistory(existing, item, store.categories, store.locations)
  itemHistories = appendItemHistory(itemHistories, item.id, changes)

  return {
    ...store,
    items: store.items.map((i) => (i.id === item.id ? item : i)),
    itemHistories,
  }
}

export function recordItemArchiveHistory(
  store: WarehouseStore,
  itemId: string,
  itemName: string,
  archived: boolean,
): WarehouseStore {
  const itemHistories = appendItemHistory(store.itemHistories ?? {}, itemId, [
    entry({
      kind: archived ? 'archived' : 'restored',
      detail: archived ? `В архив: «${itemName}»` : `Из архива: «${itemName}»`,
    }),
  ])
  return { ...store, itemHistories }
}

/** Присвоить коды существующим позициям без internalCode */
export function assignMissingInternalCodes(store: WarehouseStore): WarehouseStore {
  let workingItems = [...store.items]
  let nextInternalCode = store.nextInternalCode
  let changed = false

  workingItems = workingItems.map((row) => {
    if (row.internalCode?.trim()) return row
    changed = true
    const { code, nextCounter } = allocateUniqueInternalCode(
      { items: workingItems, nextInternalCode },
      row.id,
    )
    nextInternalCode = nextCounter
    return {
      ...row,
      internalCode: code,
      createdAt: row.createdAt ?? new Date().toISOString(),
    }
  })

  if (!changed && store.nextInternalCode) return store
  return {
    ...store,
    items: workingItems,
    nextInternalCode: nextIcNum({ items: workingItems, nextInternalCode }),
    itemHistories: store.itemHistories ?? {},
  }
}
