import type { ItMaintenanceRecord, ItOfficeStore } from './types'

export function upsertItMaintenance(
  store: ItOfficeStore,
  record: ItMaintenanceRecord,
): ItOfficeStore {
  const exists = store.maintenance.some((m) => m.id === record.id)
  const maintenance = exists
    ? store.maintenance.map((m) => (m.id === record.id ? record : m))
    : [...store.maintenance, record]

  let assets = store.assets
  const asset = store.assets.find((a) => a.id === record.assetId)
  if (asset && record.kind === 'repair' && asset.status === 'issued') {
    assets = store.assets.map((a) =>
      a.id === record.assetId ? { ...a, status: 'repair', updatedAt: new Date().toISOString() } : a,
    )
  }

  return { ...store, maintenance, assets }
}

export function removeItMaintenance(store: ItOfficeStore, id: string): ItOfficeStore {
  return { ...store, maintenance: store.maintenance.filter((m) => m.id !== id) }
}

export function listMaintenanceDue(store: ItOfficeStore, withinDays = 30) {
  const today = new Date()
  const limit = new Date(today)
  limit.setDate(limit.getDate() + withinDays)
  const limitIso = limit.toISOString().slice(0, 10)
  const todayIso = today.toISOString().slice(0, 10)

  return store.maintenance.filter(
    (m) => m.nextDueDate && m.nextDueDate <= limitIso && m.nextDueDate >= todayIso,
  )
}

export function listMaintenanceOverdue(store: ItOfficeStore) {
  const todayIso = new Date().toISOString().slice(0, 10)
  return store.maintenance.filter((m) => m.nextDueDate && m.nextDueDate < todayIso)
}
