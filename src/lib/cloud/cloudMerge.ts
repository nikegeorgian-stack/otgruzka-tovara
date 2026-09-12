import { preserveTimesheetEntryVoids } from '@/lib/timesheetEntries/mergeVoids'
import type { AppStore, AuditEntry, DayCode, Employee, MonthSheet, TimesheetRow } from '@/lib/types'
import type { AppUser } from '@/lib/access/types'
import { MAX_AUDIT_ENTRIES } from '@/lib/types'
import { ensureEmployeeNumbers } from '@/lib/hr/employeeNumber'
import type { WarehouseStore, WarehouseAuditEntry, WarehouseItem } from '@/lib/warehouse/types'
import {
  WarehouseItemIdentityError,
  applyWarehouseIdentityAfterMerge,
  mergeNextInternalCodeCounter,
} from '@/lib/warehouse/itemIdentity'
import type { FinanceStore } from '@/lib/finance/types'
import type { ProductionStore } from '@/lib/production/types'
import type { ProcurementStore } from '@/lib/procurement/types'
import { createDefaultMealSettings } from '@/lib/meals/init'
import { normalizeOrgChartStore } from '@/lib/orgChart/init'
import type { OrgChartStore } from '@/lib/orgChart/types'
import { normalizeTasksStore } from '@/lib/tasks/init'
import type { TasksStore } from '@/lib/tasks/types'
import { applyHrEmbeddedTrashTombstones } from '@/lib/hr/documentTrash'

export type CloudMergeResult = {
  store: AppStore
  conflictCount: number
}

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function safeIso(value: string | undefined | null): string {
  return typeof value === 'string' ? value : ''
}

function sortByAtDesc<T extends { at?: string }>(items: T[]): T[] {
  return items.sort((a, b) => safeIso(b.at).localeCompare(safeIso(a.at)))
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

function mergeAccessUsers(
  base: AppUser[] | undefined,
  remote: AppUser[] | undefined,
  local: AppUser[] | undefined,
  onConflict: () => void,
): AppUser[] {
  const sparse = isSparseLocalRoster(local?.length ?? 0, remote?.length ?? 0, 3)
  const merged = mergeArrayById(base, remote, local, onConflict, {
    refuseSparseLocalDeletes: sparse,
  }) as unknown as AppUser[]
  const lById = new Map((local ?? []).map((u) => [u.id, u]))
  const rById = new Map((remote ?? []).map((u) => [u.id, u]))
  return merged.map((u) => {
    const lv = lById.get(u.id)
    const rv = rById.get(u.id)
    if (!lv) return u
    const lAt = safeIso(lv.updatedAt)
    const rAt = safeIso(rv?.updatedAt)
    // После смены пароля локально снимаем mustChangePassword — не даём облаку
    // вернуть true из‑за чуть более нового admin-reset.
    if (lv.mustChangePassword === false && rv?.mustChangePassword === true) {
      return { ...u, mustChangePassword: false, updatedAt: lv.updatedAt || u.updatedAt }
    }
    if (!rv || lAt >= rAt) {
      return { ...u, mustChangePassword: lv.mustChangePassword, updatedAt: lv.updatedAt }
    }
    return u
  })
}

function indexByKey<T>(items: T[] | undefined, keyOf: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items ?? []) {
    const key = keyOf(item)
    if (!key) continue
    map.set(key, item)
  }
  return map
}

/**
 * Трёхстороннее слияние массивов по ключу: добавления с обеих сторон сохраняются,
 * удаления (ключ был в base, нет в local/remote) учитываются.
 *
 * refuseSparseLocalDeletes: если локаль заметно короче remote (seed / гонка до applyStore),
 * «удаление» неизменённого remote-элемента не принимаем — иначе после Ctrl+F5 деплоя
 * в облако уезжал короткий roster и люди пропадали у всех.
 */
function mergeItemsByKey<T extends Record<string, unknown>>(
  base: T[] | undefined,
  remote: T[] | undefined,
  local: T[] | undefined,
  keyOf: (item: T) => string,
  onConflict: () => void,
  opts?: { refuseSparseLocalDeletes?: boolean },
): T[] {
  const b = indexByKey(base, keyOf)
  const r = indexByKey(remote, keyOf)
  const l = indexByKey(local, keyOf)
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out: T[] = []
  const keepRemoteDeletes = opts?.refuseSparseLocalDeletes === true

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)

    if (bv && !lv && !rv) continue
    if (bv && !lv) {
      if (rv && !eq(rv, bv)) {
        out.push(rv)
        continue
      }
      // Локаль «удалила», облако не меняло — при sparse local не затираем roster.
      if (keepRemoteDeletes && rv) {
        out.push(rv)
        continue
      }
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

function isSparseLocalRoster(localLen: number, remoteLen: number, minRemote: number): boolean {
  if (remoteLen < minRemote) return false
  return localLen < Math.ceil(remoteLen * 0.85)
}

function mergeItemsById<T extends { id: string }>(
  base: T[],
  remote: T[],
  local: T[],
  onConflict: () => void,
  opts?: { refuseSparseLocalDeletes?: boolean },
): T[] {
  return mergeItemsByKey(base, remote, local, (item) => item.id, onConflict, opts)
}

function mergeEmployees(
  base: Employee[],
  remote: Employee[],
  local: Employee[],
  onConflict: () => void,
): Employee[] {
  const sparse = isSparseLocalRoster(local?.length ?? 0, remote?.length ?? 0, 8)
  return ensureEmployeeNumbers(
    mergeItemsById(base, remote, local, onConflict, {
      refuseSparseLocalDeletes: sparse,
    }),
  )
}

function trashRecordIds(
  items: Array<{ employee?: { id?: string }; candidate?: { id?: string } }> | undefined,
  kind: 'employee' | 'candidate',
): Set<string> {
  const ids = new Set<string>()
  for (const item of items ?? []) {
    const id = kind === 'employee' ? item.employee?.id : item.candidate?.id
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Корзина = tombstone. Иначе 3-way merge возвращает человека:
 * 1) remote-карточка чуть отличается от base (фото, номер, normalize) → «удаление vs правка» = оставить remote;
 * 2) другая вкладка/телефон ещё держит старый roster и после успешного удаления снова пушит сотрудника.
 * Восстановление: был в base.trash, сейчас в local.employees и не в local.trash.
 */
export function applyRosterTrashTombstones<T extends { id: string }>(
  roster: T[],
  tombstoneIds: Set<string>,
  localRoster: T[],
  baseTrashIds: Set<string>,
  localTrashIds: Set<string>,
): T[] {
  if (tombstoneIds.size === 0) return roster
  const localIds = new Set(localRoster.map((row) => row.id))
  return roster.filter((row) => {
    if (!tombstoneIds.has(row.id)) return true
    return localIds.has(row.id) && baseTrashIds.has(row.id) && !localTrashIds.has(row.id)
  })
}

/** Пустая ячейка в audit пишется как «·» (см. auditCellChange). */
const AUDIT_EMPTY_CELL = '·'

function isAuditEmptyMarker(value: string | undefined | null): boolean {
  return value == null || value === '' || value === AUDIT_EMPTY_CELL
}

/**
 * Ищем audit по ячейке и новому значению.
 * Важно: `detail.includes('')` всегда true — нельзя искать очистку через includes.
 * Очистка в журнале = newValue '' или '·'.
 */
function latestAuditForCell(
  audit: AuditEntry[],
  rowId: string,
  dateKey: string,
  value: string,
): AuditEntry | undefined {
  const wantEmpty = isAuditEmptyMarker(value)
  let best: AuditEntry | undefined
  for (const e of audit) {
    if (e.rowId !== rowId || e.dateKey !== dateKey) continue
    const hit = wantEmpty
      ? isAuditEmptyMarker(e.newValue)
      : e.newValue === value || (typeof e.detail === 'string' && e.detail.includes(value))
    if (!hit) continue
    if (!best || safeIso(e.at) >= safeIso(best.at)) best = e
  }
  return best
}

/** Последняя запись журнала по ячейке (любое значение). */
function latestAnyAuditForCell(
  audit: AuditEntry[],
  rowId: string,
  dateKey: string,
): AuditEntry | undefined {
  let best: AuditEntry | undefined
  for (const e of audit) {
    if (e.rowId !== rowId || e.dateKey !== dateKey) continue
    if (!best || safeIso(e.at) >= safeIso(best.at)) best = e
  }
  return best
}

/** Wipe разрешён только если последняя запись по ячейке — очистка (→ ·). */
function hasRecentClearAudit(
  audit: AuditEntry[],
  rowId: string,
  dateKey: string,
): boolean {
  const latest = latestAnyAuditForCell(audit, rowId, dateKey)
  return latest != null && isAuditEmptyMarker(latest.newValue)
}

function isEmptyDayCode(value: DayCode | undefined): boolean {
  return value == null || value === ''
}

/**
 * Журнал = правда о действиях людей.
 * Если ячейка пустая, а последняя запись по ней — не очистка, восстанавливаем значение.
 * Так чинится уже случившийся wipe (данные пропали, audit остался) и блок после деплоя.
 */
function healDayCellFromAudit(
  result: DayCode,
  rowId: string,
  dateKey: string,
  audit: AuditEntry[],
): DayCode {
  const latest = latestAnyAuditForCell(audit, rowId, dateKey)
  if (!latest) return result
  // Явная очистка в журнале — не навязываем; пустое уже ок.
  if (isAuditEmptyMarker(latest.newValue)) return result
  const fromJournal = String(latest.newValue ?? '').trim()
  if (!fromJournal) return result
  // Пустая ячейка при живой записи в журнале = wipe после деплоя/синка → вернуть действие.
  if (isEmptyDayCode(result)) return fromJournal as DayCode
  return result
}

/**
 * Ячейка табеля: при конфликте — audit LWW.
 * Защита: «очистка» (состав/merge/устаревший клиент) без audit очистки не должна
 * затирать непустую базу — иначе правки пропадают без следа в журнале.
 */
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
  let picked: DayCode
  if (localChanged && remoteChanged && l !== r) {
    onConflict()
    const localAudit = latestAuditForCell(audit, rowId, dateKey, l)
    const remoteAudit = latestAuditForCell(audit, rowId, dateKey, r)
    if (localAudit && remoteAudit) {
      picked = safeIso(localAudit.at) >= safeIso(remoteAudit.at) ? l : r
    } else if (remoteAudit && !localAudit) {
      picked = r
    } else if (localAudit && !remoteAudit) {
      picked = l
    } else if (isEmptyDayCode(l) && !isEmptyDayCode(r)) {
      picked = r
    } else if (isEmptyDayCode(r) && !isEmptyDayCode(l)) {
      picked = l
    } else {
      picked = l
    }
  } else if (
    !isEmptyDayCode(b) &&
    isEmptyDayCode(l) &&
    isEmptyDayCode(r) &&
    (localChanged || remoteChanged) &&
    !hasRecentClearAudit(audit, rowId, dateKey)
  ) {
    picked = b
  } else if (
    localChanged &&
    !remoteChanged &&
    isEmptyDayCode(l) &&
    !isEmptyDayCode(b) &&
    !hasRecentClearAudit(audit, rowId, dateKey)
  ) {
    picked = (r || b) as DayCode
  } else if (
    remoteChanged &&
    !localChanged &&
    isEmptyDayCode(r) &&
    !isEmptyDayCode(b) &&
    !hasRecentClearAudit(audit, rowId, dateKey)
  ) {
    picked = (l || b) as DayCode
  } else {
    picked = pick3(b, r, l)
  }
  return healDayCellFromAudit(picked, rowId, dateKey, audit)
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
    const localHasRow = Object.prototype.hasOwnProperty.call(l, rowId)
    const remoteHasRow = Object.prototype.hasOwnProperty.call(r, rowId)
    // Целиком снятая карта ячеек на одной стороне ≠ очистка каждого дня.
    // Иначе «Назначение в строку» / stripRowMarks на одном клиенте затирает облако всем.
    if (!localHasRow && remoteHasRow) {
      out[rowId] = { ...(r[rowId] ?? {}) }
      continue
    }
    if (localHasRow && !remoteHasRow) {
      out[rowId] = { ...(l[rowId] ?? {}) }
      continue
    }
    if (!localHasRow && !remoteHasRow) continue

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

/**
 * Трёхстороннее слияние множеств строк.
 * Сохраняет добавления с обеих сторон и уважает удаления относительно base.
 * Пример: base={a,b}, local={a,c} (убрали b, добавили c), remote={a,b,d}
 * → {a,c,d}.
 */
export function mergeStringSet(base: string[], remote: string[], local: string[]): string[] {
  const b = new Set(base)
  const r = new Set(remote)
  const l = new Set(local)
  const out = new Set<string>()
  for (const key of l) {
    if (r.has(key) || !b.has(key)) out.add(key)
  }
  for (const key of r) {
    if (!b.has(key)) out.add(key)
  }
  return [...out].sort((a, c) => a.localeCompare(c, 'ru'))
}

/** Удаление ключа только если его нет и в local, и в remote (обе стороны убрали). */
export function mergeStringSetBothMustDelete(
  base: string[],
  remote: string[],
  local: string[],
): string[] {
  const b = new Set(base)
  const r = new Set(remote)
  const l = new Set(local)
  const out = new Set<string>()
  for (const key of new Set([...b, ...r, ...l])) {
    const inL = l.has(key)
    const inR = r.has(key)
    if (inL || inR) out.add(key)
  }
  return [...out].sort((a, c) => a.localeCompare(c, 'ru'))
}

function mergeNumberSet(base: number[], remote: number[], local: number[]): number[] {
  const asStr = (n: number) => String(n)
  const merged = mergeStringSet(base.map(asStr), remote.map(asStr), local.map(asStr))
  return merged.map(Number).filter((n) => Number.isFinite(n)).sort((a, c) => a - c)
}

function mergeTimesheetRows(
  base: TimesheetRow[],
  remote: TimesheetRow[],
  local: TimesheetRow[],
  onConflict: () => void,
): TimesheetRow[] {
  return mergeItemsById(base, remote, local, onConflict).sort(
    (a, c) =>
      (a.sortOrder ?? 0) - (c.sortOrder ?? 0) ||
      safeIso(a.brigade).localeCompare(safeIso(c.brigade), 'ru'),
  )
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

  // Админская очистка / полный сброс листа: более новый resetAt побеждает целиком,
  // иначе облако снова смешивает старые ячейки с пустым локальным листом.
  const bReset = b.resetAt ?? ''
  const rReset = r.resetAt ?? ''
  const lReset = l.resetAt ?? ''
  if (lReset !== bReset || rReset !== bReset) {
    if (lReset !== rReset) {
      return safeIso(lReset) >= safeIso(rReset) ? l : r
    }
    if (lReset && lReset === rReset) return l
  }

  return {
    month: pick3(b.month, r.month, l.month),
    rows: mergeTimesheetRows(b.rows, r.rows, l.rows, onConflict),
    plan: mergeNestedDayCodes(b.plan, r.plan, l.plan, audit, onConflict),
    fact: mergeNestedDayCodes(b.fact, r.fact, l.fact, audit, onConflict),
    // Override снимаем только если удалили обе стороны — иначе смена состава
    // на одном клиенте затирает ручной факт коллеги при merge.
    factOverrides: mergeStringSetBothMustDelete(
      b.factOverrides ?? [],
      r.factOverrides ?? [],
      l.factOverrides ?? [],
    ),
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
    brigadeSignoffs: mergeRecords(
      b.brigadeSignoffs,
      r.brigadeSignoffs,
      l.brigadeSignoffs,
      onConflict,
    ),
    dayTransfers: mergeRecords(b.dayTransfers, r.dayTransfers, l.dayTransfers, onConflict),
    rowBounds: mergeRecords(b.rowBounds, r.rowBounds, l.rowBounds, onConflict),
    resetAt: pickNewestIso(b.resetAt, r.resetAt, l.resetAt),
  }
}

function pickNewestIso(
  base?: string,
  remote?: string,
  local?: string,
): string | undefined {
  const vals = [base, remote, local].filter((x): x is string => Boolean(x && x.trim()))
  if (!vals.length) return undefined
  return vals.reduce((a, c) => (safeIso(c) >= safeIso(a) ? c : a))
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
    // Облако удалило месяц (апр–июнь purge и т.п.) — Firebase побеждает, локаль не воскрешает.
    if (bv && !rv) continue
    if (!bv && !lv && rv) {
      out[month] = rv
      continue
    }
    if (!bv && lv && !rv) {
      // Новый месяц только локально (ещё не ушёл в облако).
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
    if (!entry?.id) continue
    const prev = byId.get(entry.id)
    if (!prev || safeIso(entry.at) > safeIso(prev.at)) byId.set(entry.id, entry)
  }
  return sortByAtDesc([...byId.values()]).slice(0, MAX_AUDIT_ENTRIES)
}

function mergeArrayById<T extends { id: string }>(
  base: T[] | undefined,
  remote: T[] | undefined,
  local: T[] | undefined,
  onConflict: () => void,
  opts?: { refuseSparseLocalDeletes?: boolean },
): T[] {
  return mergeItemsById(base ?? [], remote ?? [], local ?? [], onConflict, opts)
}

function mergeOrgChartStore(
  base: OrgChartStore | undefined,
  remote: OrgChartStore | undefined,
  local: OrgChartStore | undefined,
  onConflict: () => void,
): OrgChartStore {
  const b = normalizeOrgChartStore(base)
  const r = normalizeOrgChartStore(remote)
  const l = normalizeOrgChartStore(local)
  return {
    displayMode: pick3WithConflict(b.displayMode ?? 'both', r.displayMode ?? 'both', l.displayMode ?? 'both', onConflict),
    layoutVersion: Math.max(
      Number(b.layoutVersion) || 0,
      Number(r.layoutVersion) || 0,
      Number(l.layoutVersion) || 0,
    ) || undefined,
    nodes: mergeArrayById(b.nodes, r.nodes, l.nodes, onConflict),
  }
}

function mergeTasksStore(
  base: TasksStore | undefined,
  remote: TasksStore | undefined,
  local: TasksStore | undefined,
  onConflict: () => void,
): TasksStore {
  const b = normalizeTasksStore(base)
  const r = normalizeTasksStore(remote)
  const l = normalizeTasksStore(local)
  return {
    boards: mergeArrayById(b.boards, r.boards, l.boards, onConflict),
    columns: mergeArrayById(b.columns, r.columns, l.columns, onConflict),
    tasks: mergeItemsById(b.tasks, r.tasks, l.tasks, onConflict, {
      refuseSparseLocalDeletes: true,
    }),
    comments: mergeItemsById(b.comments, r.comments, l.comments, onConflict),
    attachments: mergeArrayById(b.attachments, r.attachments, l.attachments, onConflict),
    rules: mergeArrayById(b.rules, r.rules, l.rules, onConflict),
    personalLists: mergeArrayById(
      b.personalLists ?? [],
      r.personalLists ?? [],
      l.personalLists ?? [],
      onConflict,
    ),
  }
}

function mergeWarehouseAuditLog(
  base: WarehouseAuditEntry[],
  remote: WarehouseAuditEntry[],
  local: WarehouseAuditEntry[],
): WarehouseAuditEntry[] {
  const byId = new Map<string, WarehouseAuditEntry>()
  for (const entry of [...base, ...remote, ...local]) {
    if (!entry?.id) continue
    const prev = byId.get(entry.id)
    if (!prev || safeIso(entry.at) > safeIso(prev.at)) byId.set(entry.id, entry)
  }
  return sortByAtDesc([...byId.values()]).slice(0, MAX_AUDIT_ENTRIES)
}

function mergeTimesheetEntryDocuments(
  base: NonNullable<AppStore['timesheetEntries']>['documents'],
  remote: NonNullable<AppStore['timesheetEntries']>['documents'],
  local: NonNullable<AppStore['timesheetEntries']>['documents'],
  onConflict: () => void,
): NonNullable<AppStore['timesheetEntries']>['documents'] {
  type Doc = NonNullable<AppStore['timesheetEntries']>['documents'][number]
  const stamp = (d: Doc) =>
    safeIso(d.voidedAt) || safeIso(d.postedAt) || safeIso(d.createdAt)
  const byId = new Map<string, Doc>()
  for (const list of [base, remote, local]) {
    for (const d of list) {
      if (!d?.id) continue
      const prev = byId.get(d.id)
      if (!prev) {
        byId.set(d.id, d)
        continue
      }
      if (eq(prev, d)) continue
      onConflict()
      byId.set(d.id, stamp(d) >= stamp(prev) ? d : prev)
    }
  }
  return [...byId.values()].sort((a, b) => stamp(b).localeCompare(stamp(a)))
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
    advanceDocuments: mergeArrayById(
      b.advanceDocuments ?? [],
      r.advanceDocuments ?? [],
      l.advanceDocuments ?? [],
      onConflict,
    ),
    payoutDocuments: mergeArrayById(
      b.payoutDocuments ?? [],
      r.payoutDocuments ?? [],
      l.payoutDocuments ?? [],
      onConflict,
    ),
    advanceAccruals: mergeArrayById(
      b.advanceAccruals ?? [],
      r.advanceAccruals ?? [],
      l.advanceAccruals ?? [],
      onConflict,
    ),
    adjustments: mergeArrayById(b.adjustments, r.adjustments, l.adjustments, onConflict),
    payouts: mergeArrayById(b.payouts, r.payouts, l.payouts, onConflict),
    sickConfirmations: mergeArrayById(
      b.sickConfirmations,
      r.sickConfirmations,
      l.sickConfirmations,
      onConflict,
    ),
    vacationConfirmations: mergeArrayById(
      b.vacationConfirmations ?? [],
      r.vacationConfirmations ?? [],
      l.vacationConfirmations ?? [],
      onConflict,
    ),
    snapshots: mergeRecords(b.snapshots, r.snapshots, l.snapshots, onConflict),
    snapshotHistory: mergeRecords(b.snapshotHistory ?? {}, r.snapshotHistory ?? {}, l.snapshotHistory ?? {}, onConflict),
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

  const mergedItems = mergeArrayById(b.items, r.items, l.items, onConflict)
  const counterFloor = mergeNextInternalCodeCounter(
    b.nextInternalCode,
    r.nextInternalCode,
    l.nextInternalCode,
    mergedItems,
  )
  let items: WarehouseItem[]
  let nextInternalCode: number
  try {
    const reconciled = applyWarehouseIdentityAfterMerge({
      baseItems: b.items ?? [],
      remoteItems: r.items ?? [],
      localItems: l.items ?? [],
      mergedItems,
      nextInternalCode: counterFloor,
    })
    items = reconciled.items
    nextInternalCode = reconciled.nextInternalCode
    // SKU is never silently renamed on pull; mark conflicts for UI / later save fail-closed.
    for (let i = 0; i < reconciled.skuConflicts.length; i++) onConflict()
  } catch (err) {
    onConflict()
    if (err instanceof WarehouseItemIdentityError) throw err
    throw new WarehouseItemIdentityError('warehouse.err.unsafeIdentifierReconcile')
  }

  return {
    ...l,
    locations: mergeArrayById(b.locations, r.locations, l.locations, onConflict),
    categories: mergeArrayById(b.categories, r.categories, l.categories, onConflict),
    items,
    movements: mergeArrayById(b.movements, r.movements, l.movements, onConflict),
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
    nextInternalCode,
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
    closedMonths: mergeStringSet(b.closedMonths ?? [], r.closedMonths ?? [], l.closedMonths ?? []),
    accountingByWarehouse: mergeItemsByKey(
      b.accountingByWarehouse as Array<Record<string, unknown>> | undefined,
      r.accountingByWarehouse as Array<Record<string, unknown>> | undefined,
      l.accountingByWarehouse as Array<Record<string, unknown>> | undefined,
      (row) => String((row as { warehouseId?: string; id?: string }).warehouseId || (row as { id?: string }).id || ''),
      onConflict,
    ) as WarehouseStore['accountingByWarehouse'],
  }
}

function mergeProcurement(
  base: ProcurementStore,
  remote: ProcurementStore,
  local: ProcurementStore,
  onConflict: () => void,
): ProcurementStore {
  return {
    orders: mergeArrayById(base.orders, remote.orders, local.orders, onConflict),
    nextOrderSeq: pick3(base.nextOrderSeq, remote.nextOrderSeq, local.nextOrderSeq),
    categories: mergeArrayById(
      base.categories ?? [],
      remote.categories ?? [],
      local.categories ?? [],
      onConflict,
    ),
    routePoints: mergeArrayById(
      base.routePoints ?? [],
      remote.routePoints ?? [],
      local.routePoints ?? [],
      onConflict,
    ),
  }
}

function mergeProduction(
  base: ProductionStore,
  remote: ProductionStore,
  local: ProductionStore,
  onConflict: () => void,
): ProductionStore {
  return {
    requests: mergeArrayById(base.requests, remote.requests, local.requests, onConflict),
    planner: {
      orders: mergeArrayById(
        base.planner.orders,
        remote.planner.orders,
        local.planner.orders,
        onConflict,
      ),
      nextOrderSeq: Math.max(
        Number(base.planner.nextOrderSeq) || 1,
        Number(remote.planner.nextOrderSeq) || 1,
        Number(local.planner.nextOrderSeq) || 1,
      ),
    },
    shiftReports: mergeArrayById(
      base.shiftReports ?? [],
      remote.shiftReports ?? [],
      local.shiftReports ?? [],
      onConflict,
    ),
    packagingReports: mergeArrayById(
      base.packagingReports ?? [],
      remote.packagingReports ?? [],
      local.packagingReports ?? [],
      onConflict,
    ),
    finishedGoodsLots: mergeArrayById(
      base.finishedGoodsLots ?? [],
      remote.finishedGoodsLots ?? [],
      local.finishedGoodsLots ?? [],
      onConflict,
    ),
    qcAttachments: mergeArrayById(
      base.qcAttachments ?? [],
      remote.qcAttachments ?? [],
      local.qcAttachments ?? [],
      onConflict,
    ),
  }
}

function mergeSales(
  base: AppStore['sales'],
  remote: AppStore['sales'],
  local: AppStore['sales'],
  onConflict: () => void,
): AppStore['sales'] {
  return {
    orders: mergeArrayById(base.orders, remote.orders, local.orders, onConflict),
    nextOrderSeq: pick3(base.nextOrderSeq, remote.nextOrderSeq, local.nextOrderSeq),
    reservations: mergeArrayById(
      base.reservations ?? [],
      remote.reservations ?? [],
      local.reservations ?? [],
      onConflict,
    ),
    allocations: mergeArrayById(
      base.allocations ?? [],
      remote.allocations ?? [],
      local.allocations ?? [],
      onConflict,
    ),
  }
}

function mergeCounterparties(
  base: AppStore['counterparties'],
  remote: AppStore['counterparties'],
  local: AppStore['counterparties'],
  onConflict: () => void,
): AppStore['counterparties'] {
  return {
    items: mergeArrayById(base.items, remote.items, local.items, onConflict),
    nextCode: pick3(base.nextCode, remote.nextCode, local.nextCode),
  }
}

function mergeFinishedProducts(
  base: AppStore['finishedProducts'],
  remote: AppStore['finishedProducts'],
  local: AppStore['finishedProducts'],
  onConflict: () => void,
): AppStore['finishedProducts'] {
  const typesById = new Map<string, NonNullable<AppStore['finishedProducts']['productTypeRegistry']>[number]>()
  for (const row of [
    ...(base.productTypeRegistry ?? []),
    ...(remote.productTypeRegistry ?? []),
    ...(local.productTypeRegistry ?? []),
  ]) {
    if (row?.id) typesById.set(row.id, row)
  }
  return {
    items: mergeArrayById(base.items, remote.items, local.items, onConflict),
    nextCode: pick3(base.nextCode, remote.nextCode, local.nextCode),
    productTypeRegistry: [...typesById.values()],
    grammageRegistry: mergeNumberSet(
      base.grammageRegistry ?? [],
      remote.grammageRegistry ?? [],
      local.grammageRegistry ?? [],
    ),
    rollWidthRegistry: mergeNumberSet(
      base.rollWidthRegistry ?? [],
      remote.rollWidthRegistry ?? [],
      local.rollWidthRegistry ?? [],
    ),
  }
}

function mergePackagingRecipes(
  base: AppStore['packagingRecipes'],
  remote: AppStore['packagingRecipes'],
  local: AppStore['packagingRecipes'],
  onConflict: () => void,
): AppStore['packagingRecipes'] {
  return {
    items: mergeArrayById(base.items, remote.items, local.items, onConflict),
    nextCode: pick3(base.nextCode, remote.nextCode, local.nextCode),
    boxes: mergeArrayById(base.boxes ?? [], remote.boxes ?? [], local.boxes ?? [], onConflict),
    nextBoxCode: pick3(base.nextBoxCode ?? 1, remote.nextBoxCode ?? 1, local.nextBoxCode ?? 1),
  }
}

function mergeFormulations(
  base: AppStore['formulations'],
  remote: AppStore['formulations'],
  local: AppStore['formulations'],
  onConflict: () => void,
): AppStore['formulations'] {
  return {
    recipes: mergeArrayById(base.recipes, remote.recipes, local.recipes, onConflict),
    pigmentPastes: mergeArrayById(
      base.pigmentPastes,
      remote.pigmentPastes,
      local.pigmentPastes,
      onConflict,
    ),
    nextRecipeCode: pick3(base.nextRecipeCode, remote.nextRecipeCode, local.nextRecipeCode),
    batchRuns: mergeArrayById(base.batchRuns, remote.batchRuns, local.batchRuns, onConflict),
    nextInternalCode: pick3(base.nextInternalCode, remote.nextInternalCode, local.nextInternalCode),
    mixTasks: mergeArrayById(
      base.mixTasks ?? [],
      remote.mixTasks ?? [],
      local.mixTasks ?? [],
      onConflict,
    ),
    grammageRegistry: mergeNumberSet(
      base.grammageRegistry ?? [],
      remote.grammageRegistry ?? [],
      local.grammageRegistry ?? [],
    ),
    recipeVersions: mergeArrayById(
      base.recipeVersions ?? [],
      remote.recipeVersions ?? [],
      local.recipeVersions ?? [],
      onConflict,
    ),
  }
}

function mergeTechnologistQc(
  base: AppStore['technologistQc'],
  remote: AppStore['technologistQc'],
  local: AppStore['technologistQc'],
  onConflict: () => void,
): AppStore['technologistQc'] {
  return {
    eadCalculations: mergeArrayById(
      base.eadCalculations,
      remote.eadCalculations,
      local.eadCalculations,
      onConflict,
    ),
    eadControls: mergeArrayById(base.eadControls, remote.eadControls, local.eadControls, onConflict),
    incomingControls: mergeArrayById(
      base.incomingControls,
      remote.incomingControls,
      local.incomingControls,
      onConflict,
    ),
    impregnationQc: mergeArrayById(
      base.impregnationQc,
      remote.impregnationQc,
      local.impregnationQc,
      onConflict,
    ),
    roomClimateLog: mergeArrayById(
      base.roomClimateLog,
      remote.roomClimateLog,
      local.roomClimateLog,
      onConflict,
    ),
    shiftHandoffs: mergeArrayById(
      base.shiftHandoffs ?? [],
      remote.shiftHandoffs ?? [],
      local.shiftHandoffs ?? [],
      onConflict,
    ),
    settings: mergeObjectFields(base.settings, remote.settings, local.settings, onConflict),
  }
}

function mergeOtc(
  base: AppStore['otc'],
  remote: AppStore['otc'],
  local: AppStore['otc'],
  onConflict: () => void,
): AppStore['otc'] {
  return {
    norms: mergeArrayById(base.norms, remote.norms, local.norms, onConflict),
    labTests: mergeArrayById(base.labTests, remote.labTests, local.labTests, onConflict),
    alkaliSeries: mergeArrayById(
      base.alkaliSeries,
      remote.alkaliSeries,
      local.alkaliSeries,
      onConflict,
    ),
    sorting: mergeArrayById(base.sorting, remote.sorting, local.sorting, onConflict),
    defects: mergeArrayById(base.defects, remote.defects, local.defects, onConflict),
  }
}

function mergeWastewater(
  base: AppStore['wastewater'],
  remote: AppStore['wastewater'],
  local: AppStore['wastewater'],
  onConflict: () => void,
): AppStore['wastewater'] {
  return {
    cubes: mergeArrayById(base.cubes, remote.cubes, local.cubes, onConflict),
    nextCubeNumber: pick3(base.nextCubeNumber, remote.nextCubeNumber, local.nextCubeNumber),
    nextInternalCode: pick3(base.nextInternalCode, remote.nextInternalCode, local.nextInternalCode),
  }
}

function mergeWorkwear(
  base: AppStore['workwear'],
  remote: AppStore['workwear'],
  local: AppStore['workwear'],
  onConflict: () => void,
): AppStore['workwear'] {
  return {
    catalog: mergeArrayById(base.catalog, remote.catalog, local.catalog, onConflict),
    issuances: mergeArrayById(base.issuances, remote.issuances, local.issuances, onConflict),
  }
}

function mergeItOffice(
  base: AppStore['itOffice'],
  remote: AppStore['itOffice'],
  local: AppStore['itOffice'],
  onConflict: () => void,
): AppStore['itOffice'] {
  return {
    catalog: mergeArrayById(base.catalog, remote.catalog, local.catalog, onConflict),
    locations: mergeArrayById(base.locations, remote.locations, local.locations, onConflict),
    assets: mergeArrayById(base.assets, remote.assets, local.assets, onConflict),
    acts: mergeArrayById(base.acts, remote.acts, local.acts, onConflict),
    maintenance: mergeArrayById(
      base.maintenance,
      remote.maintenance,
      local.maintenance,
      onConflict,
    ),
    consumableSpecs: mergeArrayById(
      base.consumableSpecs,
      remote.consumableSpecs,
      local.consumableSpecs,
      onConflict,
    ),
    consumableBalances: mergeItemsByKey(
      base.consumableBalances,
      remote.consumableBalances,
      local.consumableBalances,
      (item) => `${item.specId}|${item.locationId}`,
      onConflict,
    ),
    consumableIssues: mergeArrayById(
      base.consumableIssues,
      remote.consumableIssues,
      local.consumableIssues,
      onConflict,
    ),
    attachments: mergeArrayById(
      base.attachments,
      remote.attachments,
      local.attachments,
      onConflict,
    ),
    nextInventorySeq: pick3(
      base.nextInventorySeq,
      remote.nextInventorySeq,
      local.nextInventorySeq,
    ),
  }
}

function mergeAiChat(
  base: AppStore['aiChat'],
  remote: AppStore['aiChat'],
  local: AppStore['aiChat'],
  onConflict: () => void,
): AppStore['aiChat'] {
  return {
    entries: mergeArrayById(base.entries, remote.entries, local.entries, onConflict),
    suggestions: mergeArrayById(
      base.suggestions,
      remote.suggestions,
      local.suggestions,
      onConflict,
    ),
  }
}

function mergeTrash(
  base: AppStore['trash'],
  remote: AppStore['trash'],
  local: AppStore['trash'],
  onConflict: () => void,
): AppStore['trash'] {
  return {
    employees: mergeItemsByKey(
      base.employees,
      remote.employees,
      local.employees,
      (item) => item.employee?.id ?? '',
      onConflict,
    ),
    months: mergeItemsByKey(
      base.months,
      remote.months,
      local.months,
      (item) => item.sheet?.month ?? '',
      onConflict,
    ),
    candidates: mergeItemsByKey(
      base.candidates,
      remote.candidates,
      local.candidates,
      (item) => item.candidate?.id ?? '',
      onConflict,
    ),
  }
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
  const trash = mergeTrash(base.trash, remote.trash, local.trash, onConflict)
  const employees = applyRosterTrashTombstones(
    mergeEmployees(base.employees, remote.employees, local.employees, onConflict),
    trashRecordIds(trash.employees, 'employee'),
    local.employees ?? [],
    trashRecordIds(base.trash?.employees, 'employee'),
    trashRecordIds(local.trash?.employees, 'employee'),
  ).map((emp) => applyHrEmbeddedTrashTombstones(emp))
  const candidates = applyRosterTrashTombstones(
    mergeArrayById(base.candidates, remote.candidates, local.candidates, onConflict),
    trashRecordIds(trash.candidates, 'candidate'),
    local.candidates ?? [],
    trashRecordIds(base.trash?.candidates, 'candidate'),
    trashRecordIds(local.trash?.candidates, 'candidate'),
  )

  const store: AppStore = {
    ...local,
    brigades: mergeStringSet(base.brigades, remote.brigades, local.brigades),
    brigadeNamesKa: mergeRecords(base.brigadeNamesKa, remote.brigadeNamesKa, local.brigadeNamesKa),
    brigadiers: mergeRecords(base.brigadiers, remote.brigadiers, local.brigadiers, onConflict),
    brigadeHasBrigadier: mergeRecords(
      base.brigadeHasBrigadier,
      remote.brigadeHasBrigadier,
      local.brigadeHasBrigadier,
      onConflict,
    ),
    brigadeUnits: mergeRecords(base.brigadeUnits, remote.brigadeUnits, local.brigadeUnits),
    archivedMonths: mergeStringSet(base.archivedMonths, remote.archivedMonths, local.archivedMonths),
    closedMonths: mergeStringSet(
      base.closedMonths ?? [],
      remote.closedMonths ?? [],
      local.closedMonths ?? [],
    ),
    monthClosures: mergeRecords(base.monthClosures, remote.monthClosures, local.monthClosures),
    employees,
    candidates,
    months: mergeMonths(base.months, remote.months, local.months, audit, onConflict),
    auditLog: audit,
    trash,
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
      users: mergeAccessUsers(
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
      roleTimesheetAccess: mergeRecords(
        base.access.roleTimesheetAccess,
        remote.access.roleTimesheetAccess,
        local.access.roleTimesheetAccess,
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
      roleAllowReservationReallocation: mergeRecords(
        base.access.roleAllowReservationReallocation,
        remote.access.roleAllowReservationReallocation,
        local.access.roleAllowReservationReallocation,
      ),
      roleAllowRecipeApproval: mergeRecords(
        base.access.roleAllowRecipeApproval,
        remote.access.roleAllowRecipeApproval,
        local.access.roleAllowRecipeApproval,
      ),
      roleAllowQcRelease: mergeRecords(
        base.access.roleAllowQcRelease,
        remote.access.roleAllowQcRelease,
        local.access.roleAllowQcRelease,
      ),
      userAllowReservationReallocation: pick3(
        base.access.userAllowReservationReallocation,
        remote.access.userAllowReservationReallocation,
        local.access.userAllowReservationReallocation,
      ),
      workshopMasterProductionLines: mergeRecords(
        base.access.workshopMasterProductionLines,
        remote.access.workshopMasterProductionLines,
        local.access.workshopMasterProductionLines,
      ),
      workshopMasterCoverages: mergeArrayById(
        base.access.workshopMasterCoverages,
        remote.access.workshopMasterCoverages,
        local.access.workshopMasterCoverages,
        onConflict,
      ),
    },
    finance: mergeFinanceStore(base.finance, remote.finance, local.finance, onConflict),
    production: mergeProduction(base.production, remote.production, local.production, onConflict),
    sales: mergeSales(base.sales, remote.sales, local.sales, onConflict),
    procurement: mergeProcurement(base.procurement, remote.procurement, local.procurement, onConflict),
    formulations: mergeFormulations(
      base.formulations,
      remote.formulations,
      local.formulations,
      onConflict,
    ),
    counterparties: mergeCounterparties(
      base.counterparties,
      remote.counterparties,
      local.counterparties,
      onConflict,
    ),
    finishedProducts: mergeFinishedProducts(
      base.finishedProducts,
      remote.finishedProducts,
      local.finishedProducts,
      onConflict,
    ),
    packagingRecipes: mergePackagingRecipes(
      base.packagingRecipes,
      remote.packagingRecipes,
      local.packagingRecipes,
      onConflict,
    ),
    technologistQc: mergeTechnologistQc(
      base.technologistQc,
      remote.technologistQc,
      local.technologistQc,
      onConflict,
    ),
    otc: mergeOtc(
      base.otc ?? { norms: [], labTests: [], alkaliSeries: [], sorting: [], defects: [] },
      remote.otc ?? { norms: [], labTests: [], alkaliSeries: [], sorting: [], defects: [] },
      local.otc ?? { norms: [], labTests: [], alkaliSeries: [], sorting: [], defects: [] },
      onConflict,
    ),
    wastewater: mergeWastewater(base.wastewater, remote.wastewater, local.wastewater, onConflict),
    nightShifts: {
      documents: mergeArrayById(
        base.nightShifts?.documents ?? [],
        remote.nightShifts?.documents ?? [],
        local.nightShifts?.documents ?? [],
        onConflict,
      ),
    },
    timesheetEntries: {
      documents: mergeTimesheetEntryDocuments(
        base.timesheetEntries?.documents ?? [],
        remote.timesheetEntries?.documents ?? [],
        local.timesheetEntries?.documents ?? [],
        onConflict,
      ),
    },
    meals: {
      settings: pick3WithConflict(
        base.meals?.settings ?? createDefaultMealSettings(),
        remote.meals?.settings ?? createDefaultMealSettings(),
        local.meals?.settings ?? createDefaultMealSettings(),
        onConflict,
      ),
      catalog: mergeArrayById(
        base.meals?.catalog ?? [],
        remote.meals?.catalog ?? [],
        local.meals?.catalog ?? [],
        onConflict,
      ),
      weeks: mergeArrayById(
        base.meals?.weeks ?? [],
        remote.meals?.weeks ?? [],
        local.meals?.weeks ?? [],
        onConflict,
      ),
      advances: mergeArrayById(
        base.meals?.advances ?? [],
        remote.meals?.advances ?? [],
        local.meals?.advances ?? [],
        onConflict,
      ),
      orders: mergeArrayById(
        base.meals?.orders ?? [],
        remote.meals?.orders ?? [],
        local.meals?.orders ?? [],
        onConflict,
      ),
      acceptedDays: mergeArrayById(
        base.meals?.acceptedDays ?? [],
        remote.meals?.acceptedDays ?? [],
        local.meals?.acceptedDays ?? [],
        onConflict,
      ),
    },
    workwear: mergeWorkwear(base.workwear, remote.workwear, local.workwear, onConflict),
    itOffice: mergeItOffice(base.itOffice, remote.itOffice, local.itOffice, onConflict),
    aiChat: mergeAiChat(base.aiChat, remote.aiChat, local.aiChat, onConflict),
    tasks: mergeTasksStore(base.tasks, remote.tasks, local.tasks, onConflict),
    orgChart: mergeOrgChartStore(base.orgChart, remote.orgChart, local.orgChart, onConflict),
    version: 6,
  }

  preserveTimesheetEntryVoids(store, remote, local)
  return { store, conflictCount }
}
