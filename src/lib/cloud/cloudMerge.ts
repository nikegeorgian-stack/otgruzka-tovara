import type { AppStore, AuditEntry, DayCode, Employee, MonthSheet, TimesheetRow } from '@/lib/types'
import { MAX_AUDIT_ENTRIES } from '@/lib/types'
import type { WarehouseStore, WarehouseAuditEntry } from '@/lib/warehouse/types'
import type { FinanceStore } from '@/lib/finance/types'

export type CloudMergeResult = {
  store: AppStore
  conflictCount: number
}

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pick3<T>(base: T, remote: T, local: T): T {
  if (!eq(local, base)) return local
  if (!eq(remote, base)) return remote
  return local
}

function pick3WithConflict<T>(
  base: T,
  remote: T,
  local: T,
  onConflict: () => void,
): T {
  const localChanged = !eq(local, base)
  const remoteChanged = !eq(remote, base)
  if (localChanged && remoteChanged && !eq(local, remote)) {
    onConflict()
    return local
  }
  return pick3(base, remote, local)
}

function mergeRecords<V>(
  base: Record<string, V> | undefined,
  remote: Record<string, V> | undefined,
  local: Record<string, V> | undefined,
  onConflict?: () => void,
): Record<string, V> {
  const b = base ?? {}
  const r = remote ?? {}
  const l = local ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(r), ...Object.keys(l)])
  const out: Record<string, V> = {}
  for (const key of keys) {
    if (onConflict) {
      out[key] = pick3WithConflict(b[key], r[key], l[key], onConflict)
    } else {
      out[key] = pick3(b[key], r[key], l[key])
    }
  }
  return out
}

function indexById<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items ?? []) map.set(item.id, item)
  return map
}

function mergeObjectFields<T extends Record<string, unknown>>(
  base: T | undefined,
  remote: T | undefined,
  local: T | undefined,
  onConflict: () => void,
): T {
  const b = (base ?? {}) as T
  const r = (remote ?? {}) as T
  const l = (local ?? {}) as T
  const keys = new Set([
    ...Object.keys(b),
    ...Object.keys(r),
    ...Object.keys(l),
  ]) as Set<keyof T>
  const out = { ...l } as T
  for (const key of keys) {
    out[key] = pick3WithConflict(b[key], r[key], l[key], onConflict) as T[keyof T]
  }
  return out
}

function mergeEmployees(
  base: Employee[],
  remote: Employee[],
  local: Employee[],
  onConflict: () => void,
): Employee[] {
  const b = indexById(base)
  const r = indexById(remote)
  const l = indexById(local)
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out: Employee[] = []

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)

    if (bv && !lv && !rv) continue
    if (bv && !lv) {
      if (rv && !eq(rv, bv)) out.push(rv)
      continue
    }
    if (bv && !rv && lv) {
      out.push(lv)
      continue
    }
    if (!bv && rv && lv) {
      out.push(eq(rv, lv) ? lv : mergeObjectFields(undefined, rv, lv, onConflict))
      continue
    }
    if (!lv && rv) {
      out.push(rv)
      continue
    }
    if (lv && !rv) {
      out.push(lv)
      continue
    }
    if (lv) out.push(mergeObjectFields(bv, rv, lv, onConflict))
  }

  return out
}

function latestAuditForCell(
  audit: AuditEntry[],
  rowId: string,
  dateKey: string,
  value: string,
): AuditEntry | undefined {
  return audit.find(
    (e) =>
      e.rowId === rowId &&
      e.dateKey === dateKey &&
      (e.newValue === value || e.detail.includes(value)),
  )
}

function mergeDayCell(
  base: DayCode | undefined,
  remote: DayCode | undefined,
  local: DayCode | undefined,
  rowId: string,
  dateKey: string,
  audit: AuditEntry[],
  onConflict: () => void,
): DayCode {
  const b = base ?? ''
  const r = remote ?? ''
  const l = local ?? ''
  const localChanged = l !== b
  const remoteChanged = r !== b
  if (localChanged && remoteChanged && l !== r) {
    onConflict()
    const localAudit = latestAuditForCell(audit, rowId, dateKey, l)
    const remoteAudit = latestAuditForCell(audit, rowId, dateKey, r)
    if (localAudit && remoteAudit) {
      return localAudit.at >= remoteAudit.at ? l : r
    }
    if (remoteAudit && !localAudit) return r
    return l
  }
  return pick3(b, r, l)
}

function mergeNestedDayCodes(
  base: Record<string, Record<string, DayCode>> | undefined,
  remote: Record<string, Record<string, DayCode>> | undefined,
  local: Record<string, Record<string, DayCode>> | undefined,
  audit: AuditEntry[],
  onConflict: () => void,
): Record<string, Record<string, DayCode>> {
  const b = base ?? {}
  const r = remote ?? {}
  const l = local ?? {}
  const rowIds = new Set([...Object.keys(b), ...Object.keys(r), ...Object.keys(l)])
  const out: Record<string, Record<string, DayCode>> = {}

  for (const rowId of rowIds) {
    const dates = new Set([
      ...Object.keys(b[rowId] ?? {}),
      ...Object.keys(r[rowId] ?? {}),
      ...Object.keys(l[rowId] ?? {}),
    ])
    if (!dates.size) continue
    const rowOut: Record<string, DayCode> = {}
    for (const dateKey of dates) {
      rowOut[dateKey] = mergeDayCell(
        b[rowId]?.[dateKey],
        r[rowId]?.[dateKey],
        l[rowId]?.[dateKey],
        rowId,
        dateKey,
        audit,
        onConflict,
      )
    }
    out[rowId] = rowOut
  }
  return out
}

function mergeStringList(base: string[], remote: string[], local: string[]): string[] {
  if (!eq(local, base)) return [...new Set(local)]
  if (!eq(remote, base)) return [...new Set(remote)]
  return [...new Set(local)]
}

function mergeTimesheetRows(
  base: TimesheetRow[],
  remote: TimesheetRow[],
  local: TimesheetRow[],
  onConflict: () => void,
): TimesheetRow[] {
  const b = indexById(base)
  const r = indexById(remote)
  const l = indexById(local)
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out: TimesheetRow[] = []

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)
    if (bv && !lv && !rv) continue
    if (bv && !lv) {
      if (rv && !eq(rv, bv)) out.push(rv)
      continue
    }
    if (!lv && rv) {
      out.push(rv)
      continue
    }
    if (lv) out.push(mergeObjectFields(bv, rv, lv, onConflict) as TimesheetRow)
  }

  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.brigade.localeCompare(b.brigade, 'ru'))
}

function mergeMonthSheet(
  base: MonthSheet | undefined,
  remote: MonthSheet | undefined,
  local: MonthSheet | undefined,
  audit: AuditEntry[],
  onConflict: () => void,
): MonthSheet {
  const seed = base ?? remote ?? local
  if (!seed) {
    throw new Error('mergeMonthSheet: empty')
  }
  const b = base ?? seed
  const r = remote ?? seed
  const l = local ?? seed
  return {
    month: pick3(b.month, r.month, l.month),
    rows: mergeTimesheetRows(b.rows, r.rows, l.rows, onConflict),
    plan: mergeNestedDayCodes(b.plan, r.plan, l.plan, audit, onConflict),
    fact: mergeNestedDayCodes(b.fact, r.fact, l.fact, audit, onConflict),
    factOverrides: mergeStringList(b.factOverrides, r.factOverrides, l.factOverrides),
    comments: mergeRecords(b.comments, r.comments, l.comments, onConflict),
    substitutions: mergeRecords(b.substitutions, r.substitutions, l.substitutions, onConflict),
    factExtraHours: mergeRecords(b.factExtraHours, r.factExtraHours, l.factExtraHours, onConflict),
    brigadierDays: mergeRecords(b.brigadierDays, r.brigadierDays, l.brigadierDays, onConflict),
    factHoursOverride: mergeRecords(
      b.factHoursOverride,
      r.factHoursOverride,
      l.factHoursOverride,
      onConflict,
    ),
    dayTransfers: mergeRecords(b.dayTransfers, r.dayTransfers, l.dayTransfers, onConflict),
  }
}

function mergeMonths(
  base: Record<string, MonthSheet>,
  remote: Record<string, MonthSheet>,
  local: Record<string, MonthSheet>,
  audit: AuditEntry[],
  onConflict: () => void,
): Record<string, MonthSheet> {
  const keys = new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)])
  const out: Record<string, MonthSheet> = {}
  for (const month of keys) {
    const bv = base[month]
    const rv = remote[month]
    const lv = local[month]
    if (!bv && !lv && rv) {
      out[month] = rv
      continue
    }
    if (!bv && lv && !rv) {
      out[month] = lv
      continue
    }
    if (bv && !lv && !rv) continue
    out[month] = mergeMonthSheet(bv, rv, lv, audit, onConflict)
  }
  return out
}

function mergeAuditLog(
  base: AuditEntry[],
  remote: AuditEntry[],
  local: AuditEntry[],
): AuditEntry[] {
  const byId = new Map<string, AuditEntry>()
  for (const entry of [...base, ...remote, ...local]) {
    const prev = byId.get(entry.id)
    if (!prev || entry.at > prev.at) byId.set(entry.id, entry)
  }
  return [...byId.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_AUDIT_ENTRIES)
}

function mergeArrayById<T extends { id: string }>(
  base: T[] | undefined,
  remote: T[] | undefined,
  local: T[] | undefined,
  onConflict: () => void,
): T[] {
  return mergeEmployees(
    (base ?? []) as unknown as Employee[],
    (remote ?? []) as unknown as Employee[],
    (local ?? []) as unknown as Employee[],
    onConflict,
  ) as unknown as T[]
}

function unionArrayById<T extends { id: string }>(
  ...arrays: (T[] | undefined)[]
): T[] {
  const map = new Map<string, T>()
  for (const arr of arrays) {
    for (const item of arr ?? []) map.set(item.id, item)
  }
  return [...map.values()]
}

function mergeWarehouseAuditLog(
  base: WarehouseAuditEntry[],
  remote: WarehouseAuditEntry[],
  local: WarehouseAuditEntry[],
): WarehouseAuditEntry[] {
  const byId = new Map<string, WarehouseAuditEntry>()
  for (const entry of [...base, ...remote, ...local]) {
    const prev = byId.get(entry.id)
    if (!prev || entry.at > prev.at) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))
}

function mergeFinanceStore(
  base: FinanceStore | undefined,
  remote: FinanceStore | undefined,
  local: FinanceStore | undefined,
  onConflict: () => void,
): FinanceStore | undefined {
  const seed = base ?? remote ?? local
  if (!seed) return undefined
  const b = base ?? seed
  const r = remote ?? seed
  const l = local ?? seed
  return {
    advances: mergeArrayById(b.advances, r.advances, l.advances, onConflict),
    adjustments: mergeArrayById(b.adjustments, r.adjustments, l.adjustments, onConflict),
    payouts: mergeArrayById(b.payouts, r.payouts, l.payouts, onConflict),
    sickConfirmations: mergeArrayById(
      b.sickConfirmations,
      r.sickConfirmations,
      l.sickConfirmations,
      onConflict,
    ),
    snapshots: mergeRecords(b.snapshots, r.snapshots, l.snapshots),
  }
}

function mergeWarehouse(
  base: WarehouseStore,
  remote: WarehouseStore,
  local: WarehouseStore,
  onConflict: () => void,
): WarehouseStore {
  const b = base
  const r = remote
  const l = local

  return {
    ...l,
    locations: mergeArrayById(b.locations, r.locations, l.locations, onConflict),
    categories: mergeArrayById(b.categories, r.categories, l.categories, onConflict),
    items: mergeArrayById(b.items, r.items, l.items, onConflict),
    movements: unionArrayById(b.movements, r.movements, l.movements),
    documents: mergeArrayById(b.documents, r.documents, l.documents, onConflict),
    invoiceRegistry: mergeArrayById(
      b.invoiceRegistry,
      r.invoiceRegistry,
      l.invoiceRegistry,
      onConflict,
    ),
    auditLog: mergeWarehouseAuditLog(b.auditLog, r.auditLog, l.auditLog),
    dailyIssueSessions: mergeArrayById(
      b.dailyIssueSessions,
      r.dailyIssueSessions,
      l.dailyIssueSessions,
      onConflict,
    ),
    nextInternalCode: pick3(b.nextInternalCode, r.nextInternalCode, l.nextInternalCode),
    itemHistories: mergeRecords(b.itemHistories, r.itemHistories, l.itemHistories, onConflict),
    itemRequests: mergeArrayById(b.itemRequests, r.itemRequests, l.itemRequests, onConflict),
    itemRenameRequests: mergeArrayById(
      b.itemRenameRequests,
      r.itemRenameRequests,
      l.itemRenameRequests,
      onConflict,
    ),
    replenishmentRequests: mergeArrayById(
      b.replenishmentRequests,
      r.replenishmentRequests,
      l.replenishmentRequests,
      onConflict,
    ),
    loadingShipments: mergeArrayById(
      b.loadingShipments,
      r.loadingShipments,
      l.loadingShipments,
      onConflict,
    ),
    closedMonths: mergeStringList(b.closedMonths ?? [], r.closedMonths ?? [], l.closedMonths ?? []),
  }
}

function mergeBrigades(base: string[], remote: string[], local: string[]): string[] {
  if (!eq(local, base)) {
    const extra = remote.filter((b) => !local.includes(b))
    return extra.length ? [...local, ...extra] : local
  }
  if (!eq(remote, base)) return remote
  return local
}

/**
 * Трёхстороннее слияние: base — последнее согласованное состояние,
 * remote — сейчас в облаке, local — у этой вкладки.
 */
export function mergeCloudStores(
  base: AppStore,
  remote: AppStore,
  local: AppStore,
): CloudMergeResult {
  let conflictCount = 0
  const onConflict = () => {
    conflictCount += 1
  }

  const audit = mergeAuditLog(base.auditLog, remote.auditLog, local.auditLog)

  const store: AppStore = {
    ...local,
    brigades: mergeBrigades(base.brigades, remote.brigades, local.brigades),
    brigadeNamesKa: mergeRecords(base.brigadeNamesKa, remote.brigadeNamesKa, local.brigadeNamesKa),
    brigadiers: mergeRecords(base.brigadiers, remote.brigadiers, local.brigadiers, onConflict),
    brigadeUnits: mergeRecords(base.brigadeUnits, remote.brigadeUnits, local.brigadeUnits),
    archivedMonths: mergeStringList(base.archivedMonths, remote.archivedMonths, local.archivedMonths),
    closedMonths: mergeStringList(
      base.closedMonths ?? [],
      remote.closedMonths ?? [],
      local.closedMonths ?? [],
    ),
    monthClosures: mergeRecords(base.monthClosures, remote.monthClosures, local.monthClosures),
    employees: mergeEmployees(base.employees, remote.employees, local.employees, onConflict),
    candidates: mergeArrayById(base.candidates, remote.candidates, local.candidates, onConflict),
    months: mergeMonths(base.months, remote.months, local.months, audit, onConflict),
    auditLog: audit,
    trash: pick3(base.trash, remote.trash, local.trash),
    shiftTemplates: mergeArrayById(
      base.shiftTemplates,
      remote.shiftTemplates,
      local.shiftTemplates,
      onConflict,
    ),
    hrStructuralUnits: mergeArrayById(
      base.hrStructuralUnits,
      remote.hrStructuralUnits,
      local.hrStructuralUnits,
      onConflict,
    ),
    hrPositions: mergeArrayById(base.hrPositions, remote.hrPositions, local.hrPositions, onConflict),
    warehouse: mergeWarehouse(base.warehouse, remote.warehouse, local.warehouse, onConflict),
    settings: mergeObjectFields(base.settings, remote.settings, local.settings, onConflict),
    access: {
      ...local.access,
      users: mergeArrayById(
        base.access.users,
        remote.access.users,
        local.access.users,
        onConflict,
      ),
      roleViews: mergeRecords(
        base.access.roleViews,
        remote.access.roleViews,
        local.access.roleViews,
        onConflict,
      ),
      roleAllowNegativeStock: mergeRecords(
        base.access.roleAllowNegativeStock,
        remote.access.roleAllowNegativeStock,
        local.access.roleAllowNegativeStock,
      ),
      roleAllowDocumentCancel: mergeRecords(
        base.access.roleAllowDocumentCancel,
        remote.access.roleAllowDocumentCancel,
        local.access.roleAllowDocumentCancel,
      ),
    },
    finance: mergeFinanceStore(base.finance, remote.finance, local.finance, onConflict),
    production: pick3WithConflict(base.production, remote.production, local.production, onConflict),
    sales: pick3WithConflict(base.sales, remote.sales, local.sales, onConflict),
    procurement: pick3WithConflict(base.procurement, remote.procurement, local.procurement, onConflict),
    formulations: pick3WithConflict(
      base.formulations,
      remote.formulations,
      local.formulations,
      onConflict,
    ),
    counterparties: pick3WithConflict(
      base.counterparties,
      remote.counterparties,
      local.counterparties,
      onConflict,
    ),
    finishedProducts: pick3WithConflict(
      base.finishedProducts,
      remote.finishedProducts,
      local.finishedProducts,
      onConflict,
    ),
    packagingRecipes: pick3WithConflict(
      base.packagingRecipes,
      remote.packagingRecipes,
      local.packagingRecipes,
      onConflict,
    ),
    technologistQc: pick3WithConflict(
      base.technologistQc,
      remote.technologistQc,
      local.technologistQc,
      onConflict,
    ),
    wastewater: pick3WithConflict(base.wastewater, remote.wastewater, local.wastewater, onConflict),
    workwear: pick3WithConflict(base.workwear, remote.workwear, local.workwear, onConflict),
    itOffice: pick3WithConflict(base.itOffice, remote.itOffice, local.itOffice, onConflict),
    aiChat: pick3WithConflict(base.aiChat, remote.aiChat, local.aiChat, onConflict),
    version: 6,
  }

  return { store, conflictCount }
}
