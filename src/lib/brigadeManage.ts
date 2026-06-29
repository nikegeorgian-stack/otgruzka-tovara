import { createEmptyBrigadeRow } from './brigadeRows'
import { buildPlanRow } from './schedule'
import type { AppStore, MonthSheet } from './types'

export function mergeBrigadeIntoSheet(
  sheet: MonthSheet,
  brigade: string,
  employees: AppStore['employees'],
): MonthSheet {
  if (sheet.rows.some((r) => r.brigade === brigade)) return sheet
  const startOrder =
    sheet.rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1
  let order = startOrder

  const inBrigade = employees
    .filter((e) => e.active && e.brigade === brigade)
    .sort((a, b) => a.tabNumber.localeCompare(b.tabNumber, 'ru'))

  const newRows = []
  for (const emp of inBrigade) {
    newRows.push({
      id: crypto.randomUUID(),
      brigade,
      employeeId: emp.id,
      sortOrder: order++,
    })
  }
  newRows.push(createEmptyBrigadeRow(brigade, order++))

  const rows = [...sheet.rows, ...newRows]
  const plan = { ...sheet.plan }
  const fact = { ...sheet.fact }

  for (const row of newRows) {
    if (!row.employeeId) continue
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!emp) continue
    plan[row.id] = buildPlanRow(emp, sheet.month)
    fact[row.id] = { ...plan[row.id] }
  }

  return { ...sheet, rows, plan, fact }
}

/** Убедиться, что у каждого месяца есть строки для всех бригад из справочника. */
export function syncAllBrigadesIntoMonths(store: AppStore): AppStore {
  if (!store.brigades.length) return store
  let changed = false
  const months: AppStore['months'] = { ...store.months }
  for (const [key, sheet] of Object.entries(store.months)) {
    let next = sheet
    for (const brigade of store.brigades) {
      const merged = mergeBrigadeIntoSheet(next, brigade, store.employees)
      if (merged !== next) {
        next = merged
        changed = true
      }
    }
    if (next !== sheet) months[key] = next
  }
  if (!changed) return store
  return { ...store, months }
}

export function addBrigadeToStore(store: AppStore, name: string): AppStore {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('empty')
  if (store.brigades.some((b) => b === trimmed)) throw new Error('duplicate')

  const brigades = [...store.brigades, trimmed]
  const withBrigade = { ...store, brigades }
  return syncAllBrigadesIntoMonths(withBrigade)
}

export function renameBrigadeInStore(
  store: AppStore,
  oldName: string,
  newName: string,
): AppStore {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('empty')
  if (!store.brigades.includes(oldName)) throw new Error('missing')
  if (trimmed !== oldName && store.brigades.some((b) => b === trimmed)) {
    throw new Error('duplicate')
  }

  const brigades = store.brigades.map((b) => (b === oldName ? trimmed : b))
  const employees = store.employees.map((e) =>
    e.brigade === oldName ? { ...e, brigade: trimmed } : e,
  )
  const months = Object.fromEntries(
    Object.entries(store.months).map(([key, sheet]) => [
      key,
      {
        ...sheet,
        rows: sheet.rows.map((r) =>
          r.brigade === oldName ? { ...r, brigade: trimmed } : r,
        ),
      },
    ]),
  )

  return { ...store, brigades, employees, months }
}

export function removeBrigadeFromStore(store: AppStore, name: string): AppStore {
  if (!store.brigades.includes(name)) throw new Error('missing')
  if (store.brigades.length <= 1) throw new Error('last')

  const brigades = store.brigades.filter((b) => b !== name)
  const employees = store.employees.map((e) =>
    e.brigade === name ? { ...e, brigade: '' } : e,
  )
  const months = Object.fromEntries(
    Object.entries(store.months).map(([key, sheet]) => {
      const dropIds = new Set(
        sheet.rows.filter((r) => r.brigade === name).map((r) => r.id),
      )
      if (dropIds.size === 0) return [key, sheet]

      const plan = { ...sheet.plan }
      const fact = { ...sheet.fact }
      for (const id of dropIds) {
        delete plan[id]
        delete fact[id]
      }
      const rows = sheet.rows.filter((r) => r.brigade !== name)
      const byRowKey = (k: string) => dropIds.has(k.split('|')[0] ?? '')
      const factOverrides = sheet.factOverrides.filter((k) => !byRowKey(k))
      const comments = Object.fromEntries(
        Object.entries(sheet.comments ?? {}).filter(([k]) => !byRowKey(k)),
      )
      const substitutions = Object.fromEntries(
        Object.entries(sheet.substitutions ?? {}).filter(([k]) => !byRowKey(k)),
      )
      const factExtraHours = Object.fromEntries(
        Object.entries(sheet.factExtraHours ?? {}).filter(([k]) => !byRowKey(k)),
      )
      return [
        key,
        { ...sheet, rows, plan, fact, factOverrides, comments, substitutions, factExtraHours },
      ]
    }),
  )

  const { [name]: _removedKa, ...brigadeNamesKa } = store.brigadeNamesKa
  const { [name]: _removedBrigadier, ...brigadiers } = store.brigadiers

  return { ...store, brigades, brigadeNamesKa, brigadiers, employees, months }
}

export function brigadeEmployeeCount(store: AppStore, name: string): number {
  return store.employees.filter((e) => e.brigade === name && e.active).length
}
