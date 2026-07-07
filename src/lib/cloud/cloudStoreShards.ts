import type { AppStore, Candidate, Employee, MonthSheet } from '@/lib/types'
import type { HrDocument } from '@/lib/hr/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { createDefaultStore } from '@/lib/storage'

/** Месяцы старше N календарных месяцев уходят в архивные документы при сохранении. */
export const AUTO_ARCHIVE_MONTHS_BACK = 6

export type EmployeesShardPayload = {
  employees: Employee[]
  candidates: Candidate[]
  trashEmployees: AppStore['trash']['employees']
  trashCandidates: AppStore['trash']['candidates']
}

export type MonthsShardPayload = {
  months: Record<string, MonthSheet>
}

export type WarehouseShardPayload = {
  warehouse: WarehouseStore
}

export type CoreShardPayload = Omit<AppStore, 'employees' | 'candidates' | 'months' | 'warehouse'>

export type SplitCloudStore = {
  core: CoreShardPayload
  employees: EmployeesShardPayload
  months: MonthsShardPayload
  warehouse: WarehouseShardPayload
  monthArchives: Array<{ monthKey: string; sheet: MonthSheet }>
}

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Ключи месяцев, которые хранятся в fstMonthArchive (отдельный документ на месяц). */
export function resolveArchiveMonthKeys(store: AppStore, now = new Date()): Set<string> {
  const keys = new Set(store.archivedMonths)
  for (const m of store.closedMonths ?? []) keys.add(m)

  const cutoff = new Date(now.getFullYear(), now.getMonth() - AUTO_ARCHIVE_MONTHS_BACK, 1)
  const cutoffKey = monthKeyFromDate(cutoff)
  for (const key of Object.keys(store.months)) {
    if (key < cutoffKey) keys.add(key)
  }
  return keys
}

type PhotoCarrier = { photoDataUrl?: string; photoStoragePath?: string }

function stripHrDocuments<T extends { hrDocuments?: HrDocument[]; documents?: HrDocument[] }>(
  row: T,
): T {
  const stripList = (docs: HrDocument[] | undefined) => {
    if (!docs?.some((d) => d.fileUrl?.startsWith('data:'))) return docs
    return docs.map((d) => {
      if (!d.fileUrl?.startsWith('data:')) return d
      const { fileUrl: _, ...rest } = d
      return rest as HrDocument
    })
  }
  const hrDocuments = stripList(row.hrDocuments)
  const documents = stripList(row.documents)
  if (hrDocuments === row.hrDocuments && documents === row.documents) return row
  return { ...row, ...(hrDocuments !== row.hrDocuments ? { hrDocuments } : {}), ...(documents !== row.documents ? { documents } : {}) }
}

/** Убрать base64/http из Firestore — фото только в Storage. */
export function stripInlinePhoto<T extends PhotoCarrier>(row: T): T {
  if (!row.photoDataUrl) return row
  const { photoDataUrl: _, ...rest } = row
  return rest as T
}

export function stripWarehouseInlinePhotos(warehouse: WarehouseStore): WarehouseStore {
  let changed = false
  const items = warehouse.items.map((it) => {
    if (!it.photoDataUrl?.startsWith('data:') && !it.photoDataUrl?.startsWith('http')) return it
    changed = true
    const { photoDataUrl: _, ...rest } = it
    return rest
  })
  return changed ? { ...warehouse, items } : warehouse
}

function stripTrashEmployees(payload: EmployeesShardPayload): EmployeesShardPayload {
  return {
    ...payload,
    trashEmployees: payload.trashEmployees.map((t) => ({
      ...t,
      employee: stripHrDocuments(stripInlinePhoto(t.employee)),
    })),
    trashCandidates: payload.trashCandidates.map((t) => ({
      ...t,
      candidate: stripHrDocuments(stripInlinePhoto(t.candidate)),
    })),
  }
}

/** Разбить AppStore на шарды для Firestore (каждый < 1 MB). */
export function splitStoreForCloud(store: AppStore, now = new Date()): SplitCloudStore {
  const archiveKeys = resolveArchiveMonthKeys(store, now)
  const monthsActive: Record<string, MonthSheet> = {}
  const monthArchives: Array<{ monthKey: string; sheet: MonthSheet }> = []

  for (const [key, sheet] of Object.entries(store.months)) {
    if (archiveKeys.has(key)) monthArchives.push({ monthKey: key, sheet })
    else monthsActive[key] = sheet
  }

  const { employees, candidates, months: _m, warehouse, trash, ...coreRest } = store

  const employeesShard: EmployeesShardPayload = stripTrashEmployees({
    employees: employees.map((e) => stripHrDocuments(stripInlinePhoto(e))),
    candidates: candidates.map((c) => stripHrDocuments(stripInlinePhoto(c))),
    trashEmployees: trash.employees,
    trashCandidates: trash.candidates,
  })

  const core: CoreShardPayload = {
    ...(coreRest as CoreShardPayload),
    trash: {
      months: trash.months,
      employees: [],
      candidates: [],
    },
  }

  return {
    core,
    employees: employeesShard,
    months: { months: monthsActive },
    warehouse: { warehouse: stripWarehouseInlinePhotos(warehouse) },
    monthArchives,
  }
}

/** Собрать AppStore из шардов + архивных месяцев. */
export function assembleStoreFromShards(
  core: CoreShardPayload,
  employees: EmployeesShardPayload | null,
  months: MonthsShardPayload | null,
  warehouse: WarehouseShardPayload | null,
  archivedMonths: Record<string, MonthSheet>,
): AppStore {
  const mergedMonths = { ...(months?.months ?? {}), ...archivedMonths }
  return {
    ...core,
    employees: employees?.employees ?? [],
    candidates: employees?.candidates ?? [],
    months: mergedMonths,
    warehouse: warehouse?.warehouse ?? createDefaultStore().warehouse,
    trash: {
      months: core.trash.months,
      employees: employees?.trashEmployees ?? [],
      candidates: employees?.trashCandidates ?? [],
    },
  }
}

/** Старый монолитный документ (до шардирования). */
export function isMonolithicStorePayload(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false
  const emps = payload.employees
  return Array.isArray(emps) && emps.length > 0
}

export function parseEmployeesShard(data: Record<string, unknown> | undefined): EmployeesShardPayload | null {
  if (!data?.payload || typeof data.payload !== 'object') return null
  const p = data.payload as Record<string, unknown>
  return {
    employees: Array.isArray(p.employees) ? (p.employees as Employee[]) : [],
    candidates: Array.isArray(p.candidates) ? (p.candidates as Candidate[]) : [],
    trashEmployees: Array.isArray(p.trashEmployees)
      ? (p.trashEmployees as EmployeesShardPayload['trashEmployees'])
      : [],
    trashCandidates: Array.isArray(p.trashCandidates)
      ? (p.trashCandidates as EmployeesShardPayload['trashCandidates'])
      : [],
  }
}

export function parseMonthsShard(data: Record<string, unknown> | undefined): MonthsShardPayload | null {
  if (!data?.payload || typeof data.payload !== 'object') return null
  const months = (data.payload as { months?: Record<string, MonthSheet> }).months
  return { months: months && typeof months === 'object' ? months : {} }
}

export function parseWarehouseShard(data: Record<string, unknown> | undefined): WarehouseShardPayload | null {
  if (!data?.payload || typeof data.payload !== 'object') return null
  const wh = (data.payload as { warehouse?: WarehouseStore }).warehouse
  if (!wh || typeof wh !== 'object') return null
  return { warehouse: wh }
}

export function parseMonthArchivePayload(
  data: Record<string, unknown> | undefined,
): MonthSheet | null {
  if (!data?.payload || typeof data.payload !== 'object') return null
  const sheet = (data.payload as { sheet?: MonthSheet }).sheet
  return sheet && typeof sheet === 'object' ? sheet : null
}
