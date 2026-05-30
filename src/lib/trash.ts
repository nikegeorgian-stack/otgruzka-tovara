import type { AppStore, MonthSheet, TrashEmployee, TrashMonth } from './types'
import { TRASH_RETENTION_DAYS } from './types'

export function purgeExpiredTrash(store: AppStore): AppStore {
  const trash = store.trash ?? { employees: [], months: [] }
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000
  return {
    ...store,
    trash: {
      employees: (trash.employees ?? []).filter(
        (t) => new Date(t.deletedAt).getTime() > cutoff,
      ),
      months: (trash.months ?? []).filter(
        (t) => new Date(t.deletedAt).getTime() > cutoff,
      ),
    },
  }
}

export function trashEmployee(store: AppStore, id: string): AppStore {
  const emp = store.employees.find((e) => e.id === id)
  if (!emp) return store
  const item: TrashEmployee = { employee: emp, deletedAt: new Date().toISOString() }
  let next: AppStore = {
    ...store,
    employees: store.employees.filter((e) => e.id !== id),
    trash: {
      ...store.trash,
      employees: [item, ...store.trash.employees],
    },
    months: Object.fromEntries(
      Object.entries(store.months).map(([k, sheet]) => [
        k,
        {
          ...sheet,
          rows: sheet.rows.map((r) =>
            r.employeeId === id ? { ...r, employeeId: null } : r,
          ),
        },
      ]),
    ),
  }
  return purgeExpiredTrash(next)
}

export function trashMonth(store: AppStore, month: string): AppStore {
  const sheet = store.months[month]
  if (!sheet) return store
  const item: TrashMonth = { sheet, deletedAt: new Date().toISOString() }
  const { [month]: _, ...rest } = store.months
  let next: AppStore = {
    ...store,
    months: rest,
    trash: { ...store.trash, months: [item, ...store.trash.months] },
  }
  return purgeExpiredTrash(next)
}

export function restoreTrashEmployee(store: AppStore, deletedAt: string): AppStore {
  const item = store.trash.employees.find((t) => t.deletedAt === deletedAt)
  if (!item) return store
  return purgeExpiredTrash({
    ...store,
    employees: [...store.employees, item.employee],
    trash: {
      ...store.trash,
      employees: store.trash.employees.filter((t) => t.deletedAt !== deletedAt),
    },
  })
}

export function restoreTrashMonth(store: AppStore, deletedAt: string): AppStore {
  const item = store.trash.months.find((t) => t.deletedAt === deletedAt)
  if (!item) return store
  return purgeExpiredTrash({
    ...store,
    months: { ...store.months, [item.sheet.month]: item.sheet },
    trash: {
      ...store.trash,
      months: store.trash.months.filter((t) => t.deletedAt !== deletedAt),
    },
  })
}

export function permanentlyDeleteTrashEmployee(store: AppStore, deletedAt: string): AppStore {
  return purgeExpiredTrash({
    ...store,
    trash: {
      ...store.trash,
      employees: store.trash.employees.filter((t) => t.deletedAt !== deletedAt),
    },
  })
}

export function permanentlyDeleteTrashMonth(store: AppStore, deletedAt: string): AppStore {
  return purgeExpiredTrash({
    ...store,
    trash: {
      ...store.trash,
      months: store.trash.months.filter((t) => t.deletedAt !== deletedAt),
    },
  })
}

export function normalizeMonthSheet(sheet: MonthSheet): MonthSheet {
  return { ...sheet, comments: sheet.comments ?? {} }
}
