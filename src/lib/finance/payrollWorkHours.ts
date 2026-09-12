import { hoursForCode } from '@/lib/codes'
import { dayDateKey, daysInMonth } from '@/lib/dates'
import { isTransferredOut } from '@/lib/dayTransfer'
import { factWorkedHours, isWorkCode } from '@/lib/factExtra'
import { resolvePayRate } from '@/lib/payrollRates'
import { employeeForTimesheetRow } from '@/lib/rowSchedule'
import { getFactMark } from '@/lib/stats'
import type { AbsenceConfirmState } from '@/lib/absenceConfirm'
import type { Employee, MonthSheet } from '@/lib/types'
import { getRowHoursSnapshot } from './rowHours'

/** The same allocation feeds money and its explanation; no double-counted night OT. */
export function payrollWorkHours(
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  confirm?: AbsenceConfirmState,
  asOfDate?: string,
) {
  const rows = sheet.rows.filter((row) => row.employeeId === emp.id)
  const entries: {
    rowId: string
    date: string
    worked: number
    night: boolean
    dailyNorm: number
  }[] = []
  let planHours = 0,
    workNormHours = 0,
    totalWork = 0
  for (const row of rows) {
    const rowEmp = employeeForTimesheetRow(emp, sheet, row.id)
    const hours = getRowHoursSnapshot(sheet, row.id, rowEmp, year, month, confirm, asOfDate)
    planHours += hours.planHours
    workNormHours += hours.workNormHours
    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const date = dayDateKey(year, month, d)
      if ((asOfDate && date > asOfDate) || isTransferredOut(sheet, row.id, date)) continue
      const code = getFactMark(sheet, row.id, date)
      if (!isWorkCode(code)) continue
      const worked = factWorkedHours(sheet, row.id, date, code)
      if (worked <= 0) continue
      entries.push({
        rowId: row.id,
        date,
        worked,
        night: code === 'Н',
        dailyNorm: code === 'Н' ? (rowEmp.shiftHours ?? hoursForCode(code)) : hoursForCode(code),
      })
      totalWork += worked
    }
  }
  // Monthly work norm belongs to the employee, not to a brigade fragment.
  const monthDelta =
    resolvePayRate(emp).monthly > 0 && planHours > 0 ? Math.max(0, totalWork - workNormHours) : 0
  const out = {
    baseHours: 0,
    nightShiftHours: 0,
    otDayHours: 0,
    otNightHours: 0,
    monthDeltaOtHours: 0,
  }
  let regularRemaining = workNormHours
  for (const entry of entries.sort(
    (a, b) => a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId),
  )) {
    const regular =
      monthDelta > 0
        ? Math.min(entry.worked, regularRemaining)
        : Math.min(entry.worked, entry.dailyNorm)
    if (monthDelta > 0) regularRemaining -= regular
    if (entry.rowId !== rowId) continue
    const overtime = Math.max(0, entry.worked - regular)
    if (entry.night) {
      out.nightShiftHours += regular
      out.otNightHours += overtime
    } else {
      out.baseHours += regular
      out.otDayHours += overtime
    }
    if (monthDelta > 0) out.monthDeltaOtHours += overtime
  }
  return out
}
