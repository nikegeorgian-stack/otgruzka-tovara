import { auditFactChange, appendAudit } from '@/lib/audit'
import { applyBrigadeRoster } from '@/lib/brigadeFill'
import {
  addBrigadeToStore,
  removeBrigadeFromStore,
  renameBrigadeInStore,
} from '@/lib/brigadeManage'
import { syncEmployeeUnitFromBrigade } from '@/lib/brigadeUnits'
import {
  addBrigadeRow,
  normalizeBrigadeSlots,
  removeBrigadeRow,
  removeEmptyBrigadeRow,
} from '@/lib/brigadeRows'
import {
  applyHolidayVForAll,
  copyPlanToFact,
  setCellComment,
  type CopyPlanToFactScope,
} from '@/lib/bulkOps'
import { hoursForCode, nextCode } from '@/lib/codes'
import { dayDateKey, parseMonthKey } from '@/lib/dates'
import {
  findHomeWorkRow,
  setFactWithOverride,
  withDayTransfer,
} from '@/lib/dayTransfer'
import { ensureMonthReady } from '@/lib/monthReady'
import { isMonthClosed } from '@/lib/monthManage'
import { ensureMonth, syncPlanRow } from '@/lib/monthSheet'
import {
  cycleStartFromDay,
  employeeWithAttributesFromDay,
  employeeWithScheduleFromDay,
  rebuildPlanFromDay,
  type EmployeeShiftPatch,
} from '@/lib/planFromDay'
import { isCyclicSchedule } from '@/lib/schedules'
import { applyStoreUpdate } from '@/lib/safeStoreUpdate'
import { applyTemplateToBrigade, applyTemplateToEmployees } from '@/lib/shiftTemplates'
import {
  applySubstitution,
  clearSubstitution,
} from '@/lib/substitutions'
import {
  cellLookupKey,
  isWorkCode,
  type FactExtraHours,
} from '@/lib/factExtra'
import { getFactMark } from '@/lib/stats'
import type {
  AppStore,
  DayCode,
  DaySubstitution,
  MonthSheet,
  ScheduleType,
} from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'

export function createTimesheetSlice({ setStore, getStore }: StoreSliceDeps) {
  function updateMonth(month: string, updater: (sheet: MonthSheet) => MonthSheet) {
    setStore((s) => {
      if (isMonthClosed(s, month)) return s
      const base = ensureMonth(s, month)
      const sheet = base.months[month]
      return {
        ...base,
        months: { ...base.months, [month]: updater(sheet) },
      }
    })
  }

  return {
    updateMonth,

    ensureMonthsReady(month?: string) {
      applyStoreUpdate(setStore, (s) => ensureMonthReady(s, month))
    },

    assignRowEmployee(month: string, rowId: string, employeeId: string | null) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        if (!row) return base

        const rows = sheet.rows.map((r) => {
          if (r.id === rowId) return { ...r, employeeId }
          if (employeeId && r.employeeId === employeeId) {
            return { ...r, employeeId: null }
          }
          return r
        })
        let next: MonthSheet = { ...sheet, rows }
        if (employeeId) {
          const emp = base.employees.find((e) => e.id === employeeId)
          if (emp) next = syncPlanRow(next, rowId, emp)
        } else {
          const { [rowId]: _p, ...plan } = next.plan
          const { [rowId]: _f, ...fact } = next.fact
          next = {
            ...next,
            plan,
            fact,
            factOverrides: next.factOverrides.filter((k) => !k.startsWith(`${rowId}|`)),
          }
        }
        for (const r of rows) {
          if (r.id !== rowId && !r.employeeId && next.plan[r.id]) {
            const { [r.id]: _p, ...plan } = next.plan
            const { [r.id]: _f, ...fact } = next.fact
            next = {
              ...next,
              plan,
              fact,
              factOverrides: next.factOverrides.filter((k) => !k.startsWith(`${r.id}|`)),
            }
          }
        }
        next = normalizeBrigadeSlots(next, row.brigade)
        return { ...base, months: { ...base.months, [month]: next } }
      })
    },

    setMark(
      month: string,
      rowId: string,
      dateKey: string,
      mode: 'plan' | 'fact',
      code: DayCode,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        let nextSheet = sheet
        if (mode === 'plan') {
          nextSheet = {
            ...sheet,
            plan: {
              ...sheet.plan,
              [rowId]: { ...sheet.plan[rowId], [dateKey]: code },
            },
          }
        } else {
          const oKey = `${rowId}|${dateKey}`
          const prev = getFactMark(sheet, rowId, dateKey) ?? ''
          const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
          const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
          if (!isWorkCode(code)) {
            delete factExtraHours[cellLookupKey(rowId, dateKey)]
            delete factHoursOverride[cellLookupKey(rowId, dateKey)]
          }
          nextSheet = {
            ...sheet,
            fact: { ...sheet.fact, [rowId]: { ...sheet.fact[rowId], [dateKey]: code } },
            factOverrides: sheet.factOverrides.includes(oKey)
              ? sheet.factOverrides
              : [...sheet.factOverrides, oKey],
            factExtraHours,
            factHoursOverride,
          }
          let next = { ...base, months: { ...base.months, [month]: nextSheet } }
          next = auditFactChange(
            next,
            month,
            rowId,
            dateKey,
            row?.employeeId ?? undefined,
            prev,
            code,
          )
          return next
        }
        return { ...base, months: { ...base.months, [month]: nextSheet } }
      })
    },

    cycleMark(month: string, rowId: string, dateKey: string, mode: 'plan' | 'fact') {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const current =
          mode === 'plan'
            ? (sheet.plan[rowId]?.[dateKey] ?? '')
            : (getFactMark(sheet, rowId, dateKey) ?? '')
        const code = nextCode(current)
        let nextSheet = sheet
        if (mode === 'plan') {
          nextSheet = {
            ...sheet,
            plan: {
              ...sheet.plan,
              [rowId]: { ...sheet.plan[rowId], [dateKey]: code },
            },
          }
        } else {
          const oKey = `${rowId}|${dateKey}`
          nextSheet = {
            ...sheet,
            fact: { ...sheet.fact, [rowId]: { ...sheet.fact[rowId], [dateKey]: code } },
            factOverrides: sheet.factOverrides.includes(oKey)
              ? sheet.factOverrides
              : [...sheet.factOverrides, oKey],
          }
          let next = { ...base, months: { ...base.months, [month]: nextSheet } }
          next = auditFactChange(
            next,
            month,
            rowId,
            dateKey,
            row?.employeeId ?? undefined,
            current,
            code,
          )
          return next
        }
        return { ...base, months: { ...base.months, [month]: nextSheet } }
      })
    },

    setCellComment(month: string, rowId: string, dateKey: string, text: string) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = setCellComment(base.months[month], rowId, dateKey, text)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        next = appendAudit(next, {
          action: 'comment',
          month,
          rowId,
          dateKey,
          detail: text.slice(0, 80),
        })
        return next
      })
    },

    setSubstitution(
      month: string,
      rowId: string,
      dateKey: string,
      sub: DaySubstitution,
    ): { warningNoRow?: boolean } {
      let warningNoRow = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const { sheet, warningNoRow: warn } = applySubstitution(
          base.months[month],
          base.employees,
          rowId,
          dateKey,
          sub,
        )
        warningNoRow = !!warn
        const subEmp = base.employees.find((e) => e.id === sub.substituteEmployeeId)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        next = appendAudit(next, {
          action: 'substitution',
          month,
          rowId,
          dateKey,
          detail: `${sub.absentCode}→${subEmp?.fullName ?? sub.substituteEmployeeId}`,
        })
        return next
      })
      return { warningNoRow }
    },

    clearSubstitution(month: string, rowId: string, dateKey: string) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = clearSubstitution(base.months[month], rowId, dateKey)
        return { ...base, months: { ...base.months, [month]: sheet } }
      })
    },

    bulkHolidayV(month: string) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = applyHolidayVForAll(base.months[month])
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        return appendAudit(next, { action: 'bulk', month, detail: 'holiday V all' })
      })
    },

    bulkCopyPlanToFact(month: string, scope: CopyPlanToFactScope, brigade?: string) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = copyPlanToFact(base.months[month], base.employees, scope, brigade)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        const detail =
          scope === 'brigade' && brigade
            ? `copy plan→fact brigade ${brigade}`
            : `copy plan→fact ${scope}`
        return appendAudit(next, { action: 'bulk', month, detail })
      })
    },

    bulkCopyPlanToFact52(month: string) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = copyPlanToFact(base.months[month], base.employees, '52')
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        return appendAudit(next, { action: 'bulk', month, detail: 'copy plan→fact 52' })
      })
    },

    regenerateRowPlan(month: string, rowId: string) {
      const store = getStore()
      const row = store.months[month]?.rows.find((r) => r.id === rowId)
      const emp = row?.employeeId
        ? store.employees.find((e) => e.id === row.employeeId)
        : null
      if (!emp) return
      updateMonth(month, (sheet) => syncPlanRow(sheet, rowId, emp))
    },

    regenerateMonthPlan(month: string) {
      const store = getStore()
      updateMonth(month, (sheet) => {
        let next = sheet
        for (const row of sheet.rows) {
          const emp = row.employeeId
            ? store.employees.find((e) => e.id === row.employeeId)
            : null
          if (emp) next = syncPlanRow(next, row.id, emp)
        }
        return next
      })
    },

    addBrigade(name: string) {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('empty')
      applyStoreUpdate(setStore, (s) => addBrigadeToStore(s, trimmed))
    },

    renameBrigade(oldName: string, newName: string) {
      applyStoreUpdate(setStore, (s) => {
        let next = renameBrigadeInStore(s, oldName, newName)
        const ka = next.brigadeNamesKa[oldName]
        if (ka) {
          const { [oldName]: _, ...rest } = next.brigadeNamesKa
          next = { ...next, brigadeNamesKa: { ...rest, [newName]: ka } }
        }
        const brigadier = next.brigadiers[oldName]
        if (brigadier) {
          const { [oldName]: _b, ...rest } = next.brigadiers
          next = { ...next, brigadiers: { ...rest, [newName]: brigadier } }
        }
        return ensureMonthReady(next)
      })
    },

    setBrigadier(brigade: string, employeeId: string | null) {
      setStore((s) => {
        if (!employeeId) {
          const { [brigade]: _, ...rest } = s.brigadiers
          return { ...s, brigadiers: rest }
        }
        return { ...s, brigadiers: { ...s.brigadiers, [brigade]: employeeId } }
      })
    },

    setBrigadierDay(month: string, rowId: string, dateKey: string, on: boolean) {
      updateMonth(month, (sheet) => {
        const key = `${rowId}|${dateKey}`
        const current = sheet.brigadierDays ?? {}
        if (on) {
          if (current[key]) return sheet
          return { ...sheet, brigadierDays: { ...current, [key]: true } }
        }
        if (!current[key]) return sheet
        const { [key]: _removed, ...rest } = current
        return { ...sheet, brigadierDays: rest }
      })
    },

    /** Отметить/снять бригадирство на весь месяц (по плановым рабочим дням строки). */
    setBrigadierMonth(month: string, rowId: string, on: boolean) {
      updateMonth(month, (sheet) => {
        const { year, month: mo } = parseMonthKey(sheet.month)
        const days = new Date(year, mo, 0).getDate()
        const prefix = `${rowId}|`
        const next: Record<string, true> = {}
        for (const [k, v] of Object.entries(sheet.brigadierDays ?? {})) {
          if (!k.startsWith(prefix)) next[k] = v
        }
        if (on) {
          const rowPlan = sheet.plan[rowId] ?? {}
          for (let d = 1; d <= days; d++) {
            const dateKey = dayDateKey(year, mo, d)
            if (isWorkCode(rowPlan[dateKey] ?? '')) next[`${prefix}${dateKey}`] = true
          }
        }
        return { ...sheet, brigadierDays: next }
      })
    },

    setBrigadeNameKa(nameRu: string, nameKa: string) {
      setStore((s) => ({
        ...s,
        brigadeNamesKa: { ...s.brigadeNamesKa, [nameRu]: nameKa },
      }))
    },

    setBrigadeUnit(brigade: string, unitId: string | null) {
      setStore((s) => {
        const current = s.brigadeUnits ?? {}
        let brigadeUnits: Record<string, string>
        if (!unitId) {
          const { [brigade]: _removed, ...rest } = current
          brigadeUnits = rest
        } else {
          brigadeUnits = { ...current, [brigade]: unitId }
        }
        // Always-sync: подтягиваем подразделение всем сотрудникам этой бригады.
        const unit = unitId ? s.hrStructuralUnits.find((u) => u.id === unitId) : undefined
        const employees = unit
          ? s.employees.map((e) =>
              e.brigade === brigade
                ? { ...e, structuralUnitId: unit.id, department: unit.name }
                : e,
            )
          : s.employees
        return { ...s, brigadeUnits, employees }
      })
    },

    removeBrigade(name: string) {
      applyStoreUpdate(setStore, (s) => removeBrigadeFromStore(s, name))
    },

    applyShiftTemplate(templateId: string, employeeIds: string[]) {
      setStore((s) => applyTemplateToEmployees(s, templateId, employeeIds))
    },

    applyShiftTemplateBrigade(templateId: string, brigade: string) {
      setStore((s) => applyTemplateToBrigade(s, templateId, brigade))
    },

    applyShiftTemplateBrigadeAndRegenerate(
      month: string,
      templateId: string,
      brigade: string,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const withTpl = applyTemplateToBrigade(s, templateId, brigade)
        const base = ensureMonth(withTpl, month)
        let sheet = base.months[month]
        for (const row of sheet.rows) {
          if (row.brigade !== brigade || !row.employeeId) continue
          const emp = withTpl.employees.find((e) => e.id === row.employeeId)
          if (emp) sheet = syncPlanRow(sheet, row.id, emp)
        }
        return appendAudit(
          { ...base, months: { ...base.months, [month]: sheet } },
          { action: 'bulk', month, detail: `shift template ${templateId} → ${brigade}` },
        )
      })
    },

    addBrigadeRowToMonth(month: string, brigade: string) {
      updateMonth(month, (sheet) => normalizeBrigadeSlots(addBrigadeRow(sheet, brigade), brigade))
    },

    removeBrigadeRowFromMonth(month: string, rowId: string) {
      updateMonth(month, (sheet) => {
        const row = sheet.rows.find((r) => r.id === rowId)
        if (!row) return sheet
        return normalizeBrigadeSlots(removeBrigadeRow(sheet, rowId), row.brigade)
      })
    },

    removeEmptyBrigadeRowFromMonth(month: string, brigade: string) {
      updateMonth(month, (sheet) =>
        normalizeBrigadeSlots(removeEmptyBrigadeRow(sheet, brigade), brigade, {
          addIfAllFilled: false,
        }),
      )
    },

    replaceEmployeeInBrigade(
      month: string,
      brigade: string,
      fromEmployeeId: string,
      toEmployeeId: string,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find(
          (r) => r.brigade === brigade && r.employeeId === fromEmployeeId,
        )
        if (!row) return base

        const rows = sheet.rows.map((r) => {
          if (r.id === row.id) return { ...r, employeeId: toEmployeeId }
          if (r.employeeId === toEmployeeId) return { ...r, employeeId: null }
          return r
        })
        let next: MonthSheet = { ...sheet, rows }
        const emp = base.employees.find((e) => e.id === toEmployeeId)
        if (emp) next = syncPlanRow(next, row.id, emp)
        next = normalizeBrigadeSlots(next, brigade)
        ok = true
        return { ...base, months: { ...base.months, [month]: next } }
      })
      return ok
    },

    swapEmployeeRows(month: string, employeeIdA: string, employeeIdB: string): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const rowA = sheet.rows.find((r) => r.employeeId === employeeIdA)
        const rowB = sheet.rows.find((r) => r.employeeId === employeeIdB)
        if (!rowA || !rowB) return base

        const rows = sheet.rows.map((r) => {
          if (r.id === rowA.id) return { ...r, employeeId: employeeIdB }
          if (r.id === rowB.id) return { ...r, employeeId: employeeIdA }
          return r
        })
        let next: MonthSheet = { ...sheet, rows }
        const empA = base.employees.find((e) => e.id === employeeIdA)
        const empB = base.employees.find((e) => e.id === employeeIdB)
        if (empB) next = syncPlanRow(next, rowA.id, empB)
        if (empA) next = syncPlanRow(next, rowB.id, empA)
        ok = true
        return { ...base, months: { ...base.months, [month]: next } }
      })
      return ok
    },

    changeEmployeeScheduleFromDay(
      month: string,
      employeeId: string,
      fromDay: number,
      schedule: ScheduleType,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp) return base

        const updated = employeeWithScheduleFromDay(emp, schedule, fromDay, month)
        const employees = base.employees.map((e) =>
          e.id === employeeId ? updated : e,
        )

        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.employeeId === employeeId)
        if (!row) {
          ok = true
          return { ...base, employees }
        }

        const nextSheet = rebuildPlanFromDay(sheet, row.id, updated, fromDay)
        ok = true
        return {
          ...base,
          employees,
          months: { ...base.months, [month]: nextSheet },
        }
      })
      return ok
    },

    changeEmployeeAttributesFromDay(
      month: string,
      employeeId: string,
      fromDay: number,
      attrs: EmployeeShiftPatch,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp) return base

        const updated = employeeWithAttributesFromDay(emp, attrs, fromDay, month)
        const employees = base.employees.map((e) =>
          e.id === employeeId ? updated : e,
        )

        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.employeeId === employeeId)
        if (!row) {
          ok = true
          return { ...base, employees }
        }

        const nextSheet = rebuildPlanFromDay(sheet, row.id, updated, fromDay)
        ok = true
        return {
          ...base,
          employees,
          months: { ...base.months, [month]: nextSheet },
        }
      })
      return ok
    },

    /**
     * Привязка цикла к конкретному дню: variant 'first' — день первый рабочий
     * в смене, 'last' — последний рабочий (дальше выходные и цикл продолжается).
     */
    setEmployeeCycleFromDay(
      month: string,
      employeeId: string,
      fromDay: number,
      variant: 'first' | 'last',
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp || !isCyclicSchedule(emp.schedule)) return base

        const { year, month: m } = parseMonthKey(month)
        const updated = {
          ...emp,
          cycleStart: cycleStartFromDay(emp.schedule, year, m, fromDay, variant),
        }
        const employees = base.employees.map((e) =>
          e.id === employeeId ? updated : e,
        )

        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.employeeId === employeeId)
        if (!row) {
          ok = true
          return { ...base, employees }
        }

        const nextSheet = rebuildPlanFromDay(sheet, row.id, updated, fromDay)
        ok = true
        return {
          ...base,
          employees,
          months: { ...base.months, [month]: nextSheet },
        }
      })
      return ok
    },

    assignPermanentToBrigade(
      month: string,
      employeeId: string,
      brigade: string,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp || !base.brigades.includes(brigade)) return base

        const updatedEmp = syncEmployeeUnitFromBrigade({ ...emp, brigade }, base, brigade)
        let sheet = base.months[month]

        let targetRowId = sheet.rows.find(
          (r) => r.brigade === brigade && !r.employeeId,
        )?.id
        if (!targetRowId) {
          sheet = addBrigadeRow(sheet, brigade)
          targetRowId = sheet.rows.find(
            (r) => r.brigade === brigade && !r.employeeId,
          )?.id
        }
        if (!targetRowId) return base

        const rows = sheet.rows.map((r) => {
          if (r.id === targetRowId) return { ...r, employeeId }
          if (employeeId && r.employeeId === employeeId) {
            return { ...r, employeeId: null }
          }
          return r
        })

        let nextSheet: MonthSheet = { ...sheet, rows }
        nextSheet = syncPlanRow(nextSheet, targetRowId, updatedEmp)

        for (const r of rows) {
          if (r.id !== targetRowId && !r.employeeId && nextSheet.plan[r.id]) {
            const { [r.id]: _p, ...plan } = nextSheet.plan
            const { [r.id]: _f, ...fact } = nextSheet.fact
            nextSheet = {
              ...nextSheet,
              plan,
              fact,
              factOverrides: nextSheet.factOverrides.filter(
                (k) => !k.startsWith(`${r.id}|`),
              ),
            }
          }
        }

        nextSheet = normalizeBrigadeSlots(nextSheet, brigade)

        ok = true
        return {
          ...base,
          employees: base.employees.map((e) =>
            e.id === employeeId ? updatedEmp : e,
          ),
          months: { ...base.months, [month]: nextSheet },
        }
      })
      return ok
    },

    setBrigadeRoster(
      month: string,
      brigade: string,
      employeeIds: string[],
      syncHr: boolean,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = applyBrigadeRoster(
          base.months[month],
          base.employees,
          brigade,
          employeeIds,
        )
        let employees = base.employees
        if (syncHr) {
          const selected = new Set(employeeIds)
          employees = employees.map((e) => {
            if (selected.has(e.id)) return syncEmployeeUnitFromBrigade({ ...e, brigade }, base, brigade)
            if (e.brigade === brigade && !selected.has(e.id)) {
              return { ...e, brigade: '' }
            }
            return e
          })
        }
        let next = {
          ...base,
          employees,
          months: { ...base.months, [month]: sheet },
        }
        next = appendAudit(next, {
          action: 'bulk',
          month,
          detail: `brigade roster ${brigade} (${employeeIds.length})`,
        })
        return next
      })
    },

    setMarksRange(
      month: string,
      rowId: string,
      fromDay: number,
      toDay: number,
      mode: 'plan' | 'fact',
      code: DayCode,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const { year, month: mo } = parseMonthKey(month)

        if (mode === 'plan') {
          const rowPlan = { ...(sheet.plan[rowId] ?? {}) }
          for (let d = fromDay; d <= toDay; d++) {
            rowPlan[dayDateKey(year, mo, d)] = code
          }
          return {
            ...base,
            months: {
              ...base.months,
              [month]: { ...sheet, plan: { ...sheet.plan, [rowId]: rowPlan } },
            },
          }
        }

        const rowFact = { ...(sheet.fact[rowId] ?? {}) }
        const overrides = [...sheet.factOverrides]
        for (let d = fromDay; d <= toDay; d++) {
          const dateKey = dayDateKey(year, mo, d)
          rowFact[dateKey] = code
          const oKey = `${rowId}|${dateKey}`
          if (!overrides.includes(oKey)) overrides.push(oKey)
        }
        let next: AppStore = {
          ...base,
          months: {
            ...base.months,
            [month]: {
              ...sheet,
              fact: { ...sheet.fact, [rowId]: rowFact },
              factOverrides: overrides,
            },
          },
        }
        for (let d = fromDay; d <= toDay; d++) {
          const dateKey = dayDateKey(year, mo, d)
          const prev = getFactMark(sheet, rowId, dateKey) ?? ''
          next = auditFactChange(
            next,
            month,
            rowId,
            dateKey,
            row?.employeeId ?? undefined,
            prev,
            code,
          )
        }
        return next
      })
    },

    /**
     * Проставляет факт-код в диапазоне дней по employeeId (без знания rowId).
     * Используется HR для отпусков и при увольнении. Создаёт месяц при необходимости.
     * Возвращает тихо, если в месяце нет строки сотрудника.
     */
    setEmployeeFactRange(
      month: string,
      employeeId: string,
      fromDay: number,
      toDay: number,
      code: DayCode,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.employeeId === employeeId)
        if (!row) return s
        const rowId = row.id
        const { year, month: mo } = parseMonthKey(month)
        const rowFact = { ...(sheet.fact[rowId] ?? {}) }
        const overrides = [...sheet.factOverrides]
        const lo = Math.max(1, Math.min(fromDay, toDay))
        const hi = Math.max(fromDay, toDay)
        for (let d = lo; d <= hi; d++) {
          const dateKey = dayDateKey(year, mo, d)
          rowFact[dateKey] = code
          const oKey = `${rowId}|${dateKey}`
          if (!overrides.includes(oKey)) overrides.push(oKey)
        }
        let next: AppStore = {
          ...base,
          months: {
            ...base.months,
            [month]: {
              ...sheet,
              fact: { ...sheet.fact, [rowId]: rowFact },
              factOverrides: overrides,
            },
          },
        }
        for (let d = lo; d <= hi; d++) {
          const dateKey = dayDateKey(year, mo, d)
          const prev = getFactMark(sheet, rowId, dateKey) ?? ''
          next = auditFactChange(next, month, rowId, dateKey, employeeId, prev, code)
        }
        return next
      })
    },

    setFactExtraHours(
      month: string,
      rowId: string,
      dateKey: string,
      hours: FactExtraHours,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const code = getFactMark(sheet, rowId, dateKey)
        if (!isWorkCode(code)) return s

        const key = cellLookupKey(rowId, dateKey)
        const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
        const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
        if (hours <= 0) {
          delete factExtraHours[key]
        } else {
          factExtraHours[key] = hours
          delete factHoursOverride[key]
        }
        return {
          ...base,
          months: {
            ...base.months,
            [month]: { ...sheet, factExtraHours, factHoursOverride },
          },
        }
      })
    },

    /** Точные отработанные часы за смену (ушёл раньше/задержался). null — вернуть норму кода. */
    setFactHours(
      month: string,
      rowId: string,
      dateKey: string,
      hours: number | null,
    ) {
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const code = getFactMark(sheet, rowId, dateKey)
        if (!isWorkCode(code)) return s

        const key = cellLookupKey(rowId, dateKey)
        const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
        const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
        const norm = hoursForCode(code)
        const clamped =
          hours == null ? null : Math.max(0, Math.min(24, Math.round(hours)))
        if (clamped == null || clamped === norm) {
          delete factHoursOverride[key]
        } else {
          factHoursOverride[key] = clamped
          delete factExtraHours[key]
        }
        return {
          ...base,
          months: {
            ...base.months,
            [month]: { ...sheet, factHoursOverride, factExtraHours },
          },
        }
      })
    },

    /** Добавить сотрудника на смену только за конкретный день (доп. выход по факту). */
    addBrigadeDayWorker(
      month: string,
      brigade: string,
      employeeId: string,
      dateKey: string,
      code: DayCode,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (isMonthClosed(s, month)) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp || !base.brigades.includes(brigade)) return base

        let sheet = base.months[month]
        const homeRowId = findHomeWorkRow(sheet, employeeId, dateKey, brigade)

        let targetRowId = sheet.rows.find(
          (r) => r.brigade === brigade && r.employeeId === employeeId,
        )?.id
        if (!targetRowId) {
          let emptyId = sheet.rows.find(
            (r) => r.brigade === brigade && !r.employeeId,
          )?.id
          if (!emptyId) {
            sheet = addBrigadeRow(sheet, brigade)
            emptyId = sheet.rows.find(
              (r) => r.brigade === brigade && !r.employeeId,
            )?.id
          }
          if (!emptyId) return base
          sheet = {
            ...sheet,
            rows: sheet.rows.map((r) =>
              r.id === emptyId ? { ...r, employeeId } : r,
            ),
          }
          targetRowId = emptyId
        }

        if (homeRowId) {
          sheet = setFactWithOverride(sheet, homeRowId, dateKey, 'В')
          sheet = withDayTransfer(sheet, employeeId, dateKey, {
            fromRowId: homeRowId,
            toRowId: targetRowId,
            toBrigade: brigade,
          })
        }

        const oKey = `${targetRowId}|${dateKey}`
        const nextSheet: MonthSheet = {
          ...sheet,
          fact: {
            ...sheet.fact,
            [targetRowId]: { ...sheet.fact[targetRowId], [dateKey]: code },
          },
          factOverrides: sheet.factOverrides.includes(oKey)
            ? sheet.factOverrides
            : [...sheet.factOverrides, oKey],
        }
        ok = true
        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        next = auditFactChange(next, month, targetRowId, dateKey, employeeId, '', code)
        if (homeRowId) {
          next = auditFactChange(next, month, homeRowId, dateKey, employeeId, '', 'В')
        }
        return next
      })
      return ok
    },
  }
}
