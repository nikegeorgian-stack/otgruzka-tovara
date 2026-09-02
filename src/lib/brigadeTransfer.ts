import { addBrigadeRow, normalizeBrigadeSlots } from './brigadeRows'
import { syncEmployeeUnitFromBrigade } from './brigadeUnits'
import { dayDateKey, parseMonthKey } from './dates'
import { appendEmployeeJournal } from './hr/journal'
import {
  journalEntryForBrigadeTransfer,
  journalEntryForScheduleChangeFromDate,
} from './hr/movementJournal'
import { moveRowMarks, syncPlanRow } from './monthSheet'
import { employeeWithAttributesFromDay } from './planFromDay'
import { dayBefore } from './rowPeriod'
import { scheduleSnapshotFromEmployee } from './rowSchedule'
import { defaultShiftHours, isCyclicSchedule } from './schedules'
import { rowStats } from './stats'
import type {
  AppStore,
  Employee,
  Group2x2,
  MonthSheet,
  ScheduleType,
  ShiftMode,
} from './types'

export type BrigadeTransferParams = {
  employeeId: string
  toBrigade: string
  /** Первый день в новой бригаде / по новому графику (YYYY-MM-DD), включительно. */
  fromDateKey: string
  schedule: ScheduleType
  shiftHours?: number
  group2x2?: Group2x2
  shiftMode?: ShiftMode
  /**
   * split (по умолчанию) — оставить строку до даты (история месяца);
   * move — полностью убрать из старой (только для «закрепить с 1-го»).
   */
  mode?: 'split' | 'move'
}

export type BrigadeTransferOk = {
  ok: true
  store: AppStore
  fromRowIds: string[]
  toRowId: string
}

export type BrigadeTransferErr = {
  ok: false
  error: 'not_found' | 'bad_date' | 'bad_brigade' | 'same_slot' | 'no_slot'
}

function scheduleAttrsChanged(
  emp: Employee,
  params: BrigadeTransferParams,
): boolean {
  if (emp.schedule !== params.schedule) return true
  if (
    params.shiftHours != null &&
    Number.isFinite(params.shiftHours) &&
    params.shiftHours > 0 &&
    params.shiftHours !== emp.shiftHours
  ) {
    return true
  }
  if (params.group2x2 !== undefined && (params.group2x2 || '') !== (emp.group2x2 || '')) {
    return true
  }
  if (
    params.shiftMode !== undefined &&
    (params.shiftMode || 'day') !== (emp.shiftMode || 'day')
  ) {
    return true
  }
  return false
}

/**
 * Перевод / смена графика с даты:
 * — старые строки: план до даты по старому графику;
 * — новая строка: план с даты по новому (даже в той же бригаде);
 * — карточка HR: бригада + график (следующие месяцы);
 * — rowBounds.schedule* — снимок для нормы часов и ставки ЗП.
 */
export function applyBrigadeTransferFromDate(
  store: AppStore,
  month: string,
  params: BrigadeTransferParams,
): BrigadeTransferOk | BrigadeTransferErr {
  const sheet0 = store.months[month]
  if (!sheet0) return { ok: false, error: 'not_found' }
  if (!store.brigades.includes(params.toBrigade)) return { ok: false, error: 'bad_brigade' }

  const emp = store.employees.find((e) => e.id === params.employeeId)
  if (!emp) return { ok: false, error: 'not_found' }

  const { year, month: mo } = parseMonthKey(month)
  const days = new Date(year, mo, 0).getDate()
  const dayNum = Number(params.fromDateKey.slice(8, 10))
  if (
    !params.fromDateKey.startsWith(month) ||
    !Number.isFinite(dayNum) ||
    dayNum < 1 ||
    dayNum > days ||
    params.fromDateKey !== dayDateKey(year, mo, dayNum)
  ) {
    return { ok: false, error: 'bad_date' }
  }

  const oldEmp: Employee = { ...emp }
  let updatedEmp = employeeWithAttributesFromDay(
    emp,
    {
      schedule: params.schedule,
      group2x2: params.group2x2,
      shiftMode: params.shiftMode,
    },
    dayNum,
    month,
  )
  if (params.shiftHours != null && Number.isFinite(params.shiftHours) && params.shiftHours > 0) {
    updatedEmp = { ...updatedEmp, shiftHours: params.shiftHours }
  } else if (params.schedule !== emp.schedule) {
    updatedEmp = { ...updatedEmp, shiftHours: defaultShiftHours(params.schedule) }
  }
  if (!isCyclicSchedule(params.schedule)) {
    updatedEmp = { ...updatedEmp, group2x2: '', cycleStart: updatedEmp.cycleStart || '' }
  }
  updatedEmp = syncEmployeeUnitFromBrigade(
    { ...updatedEmp, brigade: params.toBrigade },
    store,
    params.toBrigade,
  )

  let sheet: MonthSheet = sheet0
  const monthStart = dayDateKey(year, mo, 1)
  const isFromMonthStart = params.fromDateKey === monthStart
  const hardMove = params.mode === 'move' && isFromMonthStart
  const attrsChanged = scheduleAttrsChanged(emp, params)
  const sameBrigade = (emp.brigade || '') === params.toBrigade

  const occupied = sheet.rows.filter((r) => r.employeeId === params.employeeId)

  if (
    sameBrigade &&
    !attrsChanged &&
    occupied.length === 1 &&
    occupied[0]?.brigade === params.toBrigade &&
    hardMove
  ) {
    return { ok: false, error: 'same_slot' }
  }
  if (
    sameBrigade &&
    !attrsChanged &&
    !hardMove &&
    occupied.length === 1 &&
    occupied[0]?.brigade === params.toBrigade
  ) {
    return { ok: false, error: 'same_slot' }
  }

  /**
   * Для сплита всегда берём пустой слот (или добавляем строку).
   * Нельзя сажать «новую» половину месяца в ту же occupied-строку —
   * иначе пропадёт план до даты (особенно смена 5/2→2/2 в той же бригаде).
   */
  let toRowId: string | undefined
  if (hardMove) {
    toRowId =
      occupied.find((r) => r.brigade === params.toBrigade)?.id ??
      sheet.rows.find((r) => r.brigade === params.toBrigade && !r.employeeId)?.id
  } else {
    toRowId = sheet.rows.find((r) => r.brigade === params.toBrigade && !r.employeeId)?.id
  }
  if (!toRowId) {
    sheet = addBrigadeRow(sheet, params.toBrigade)
    toRowId = sheet.rows.find((r) => r.brigade === params.toBrigade && !r.employeeId)?.id
  }
  if (!toRowId) return { ok: false, error: 'no_slot' }

  const fromRows = occupied.filter((r) => r.id !== toRowId)

  sheet = {
    ...sheet,
    rows: sheet.rows.map((r) => {
      if (r.id === toRowId) return { ...r, employeeId: params.employeeId }
      return r
    }),
  }

  const rowBounds = { ...(sheet.rowBounds ?? {}) }
  const fromRowIds: string[] = []
  const oldSnap = scheduleSnapshotFromEmployee(oldEmp)
  const newSnap = scheduleSnapshotFromEmployee(updatedEmp)

  if (hardMove) {
    for (const r of fromRows) {
      fromRowIds.push(r.id)
      delete rowBounds[r.id]
    }
    sheet = {
      ...sheet,
      rows: sheet.rows.map((r) =>
        fromRows.some((f) => f.id === r.id) ? { ...r, employeeId: null } : r,
      ),
      rowBounds,
    }
    // Переносим метки на целевую строку, а не молча удаляем (иначе ЗП/табель «пропадает»).
    for (const r of fromRows) {
      sheet = moveRowMarks(sheet, r.id, toRowId)
    }
    rowBounds[toRowId] = { ...newSnap }
    sheet = { ...sheet, rowBounds }
    // После переноса не пересобираем график с нуля — сохраняем перенесённые ячейки.
  } else {
    for (const r of fromRows) {
      fromRowIds.push(r.id)
      const prev = rowBounds[r.id]
      rowBounds[r.id] = {
        ...prev,
        ...oldSnap,
        inactiveFrom: params.fromDateKey,
        inactiveUntil: undefined,
      }
    }
    rowBounds[toRowId] = {
      ...newSnap,
      inactiveUntil: dayBefore(params.fromDateKey),
      inactiveFrom: undefined,
    }
    sheet = { ...sheet, rowBounds }

    for (const r of fromRows) {
      sheet = syncPlanRow(sheet, r.id, oldEmp)
    }
    sheet = syncPlanRow(sheet, toRowId, updatedEmp)
  }

  const dayTransfers = { ...(sheet.dayTransfers ?? {}) }
  for (const key of Object.keys(dayTransfers)) {
    if (!key.startsWith(`${params.employeeId}|`)) continue
    const dateKey = key.slice(params.employeeId.length + 1)
    if (dateKey >= params.fromDateKey) delete dayTransfers[key]
  }
  sheet = { ...sheet, dayTransfers }

  const brigadesTouched = new Set<string>([params.toBrigade, ...fromRows.map((r) => r.brigade)])
  for (const b of brigadesTouched) {
    sheet = normalizeBrigadeSlots(sheet, b)
  }

  const fromBrigade =
    fromRows[0]?.brigade || occupied.find((r) => r.id !== toRowId)?.brigade || emp.brigade || ''

  let empWithJournal = updatedEmp
  if (!sameBrigade || hardMove) {
    empWithJournal = appendEmployeeJournal(
      empWithJournal,
      journalEntryForBrigadeTransfer({
        fromBrigade,
        toBrigade: params.toBrigade,
        fromDateKey: params.fromDateKey,
        month,
        oldEmp: emp,
        newEmp: updatedEmp,
      }),
    )
  }
  if (attrsChanged) {
    empWithJournal = appendEmployeeJournal(
      empWithJournal,
      journalEntryForScheduleChangeFromDate({
        fromDateKey: params.fromDateKey,
        month,
        oldEmp: emp,
        newEmp: updatedEmp,
        sameBrigade,
      }),
    )
  }
  if (sameBrigade && !attrsChanged && !hardMove) {
    // already returned same_slot above
  }

  return {
    ok: true,
    fromRowIds,
    toRowId,
    store: {
      ...store,
      employees: store.employees.map((e) => (e.id === params.employeeId ? empWithJournal : e)),
      months: { ...store.months, [month]: sheet },
    },
  }
}

/** Сумма плановых часов по всем строкам сотрудника в месяце. */
export function employeeMonthPlanHours(
  sheet: MonthSheet,
  emp: Employee,
  year: number,
  month: number,
  days: number,
  sickConfirmed = false,
  vacationConfirmed = false,
): number {
  const confirm = { sickConfirmed, vacationConfirmed }
  let total = 0
  for (const r of sheet.rows) {
    if (r.employeeId !== emp.id) continue
    total += rowStats(sheet, r.id, days, year, month, emp, confirm).planHours
  }
  return total
}

export function employeeHasSplitMonthRows(sheet: MonthSheet, employeeId: string): boolean {
  return sheet.rows.filter((r) => r.employeeId === employeeId).length > 1
}
