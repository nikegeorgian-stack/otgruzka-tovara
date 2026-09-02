import { startTransition } from 'react'
import { auditCellChange, auditFactChange, appendAudit } from '@/lib/audit'
import { canMutateTimesheet, resolveTimesheetActorUser } from '@/lib/access/timesheetGuard'
import {
  isBrigadeViaMasterCoverage,
  isBrigadeViaMasterCoverageInMonth,
} from '@/lib/access/workshopMasterCoverage'
import {
  appendEmployeeJournalInStore,
  journalKindForDayCode,
} from '@/lib/hr/journal'
import { applyBrigadeTransferFromDate } from '@/lib/brigadeTransfer'
import { applyBrigadeRoster } from '@/lib/brigadeFill'
import {
  addBrigadeToStore,
  removeBrigadeFromStore,
  renameBrigadeInStore,
} from '@/lib/brigadeManage'
import { clearBrigadierMarksForBrigade } from '@/lib/brigadeHasBrigadier'
import { suggestLocalizedNames } from '@/lib/i18n/localizedNames'
import { syncEmployeeUnitFromBrigade } from '@/lib/brigadeUnits'
import {
  addBrigadeRow,
  normalizeBrigadeSlots,
  reorderBrigadeRow,
  removeBrigadeRow,
  removeEmptyBrigadeRow,
} from '@/lib/brigadeRows'
import {
  applyHolidayVForAll,
  copyPlanToFact,
  copyPlanToFactEmptyOnly,
  setCellComment,
  type CopyPlanToFactScope,
} from '@/lib/bulkOps'
import { hoursForCode, nextCode, workCodeForExactHours } from '@/lib/codes'
import { dayDateKey, daysInMonth, parseMonthKey } from '@/lib/dates'
import {
  findHomeWorkRow,
  prepareDayTransfer,
  revokeDayTransfer,
  setFactWithOverride,
  withDayTransfer,
} from '@/lib/dayTransfer'
import { ensureMonthReady } from '@/lib/monthReady'
import { isMonthWriteLocked } from '@/lib/monthManage'
import { applyPlanDayMark, ensureMonth, moveRowMarks, syncPlanRow } from '@/lib/monthSheet'
import { dayBefore } from '@/lib/rowPeriod'
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
import { applyTimesheetEntryChanges, revertTimesheetEntryApplied } from '@/lib/timesheetEntries/apply'
import {
  createDefaultTimesheetEntryStore,
  nextTimesheetEntryNumber,
  normalizeTimesheetEntryStore,
  trimTimesheetEntryDocuments,
} from '@/lib/timesheetEntries/init'
import type { TimesheetEntryChange } from '@/lib/timesheetEntries/types'
import type {
  AppStore,
  DayCode,
  DaySubstitution,
  MonthSheet,
  ScheduleType,
} from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'

export type CommitTimesheetDraftResult = {
  applied: number
  skipped: number
  appliedChanges: TimesheetEntryChange[]
  /** false = ничего не записали (лок / ACL / конфликт всех ячеек) */
  ok: boolean
}

export function createTimesheetSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const actorFields = () => {
    const a = getActor?.() ?? null
    return { by: a?.id, byName: a?.name }
  }

  const coverageAudit = (s: AppStore, brigade?: string | null, month?: string) => {
    const a = getActor?.() ?? null
    if (!a?.id || !brigade) return false
    const user = s.access.users.find((u) => u.id === a.id)
    if (month) return isBrigadeViaMasterCoverageInMonth(s, user, brigade, month)
    return isBrigadeViaMasterCoverage(s, user, brigade)
  }

  const cellAuditFields = (s: AppStore, brigade?: string | null, month?: string) => ({
    ...actorFields(),
    viaCoverage: coverageAudit(s, brigade, month),
  })

  const allowWrite = (
    s: AppStore,
    target: { month: string; rowId?: string; brigade?: string | null },
  ) => canMutateTimesheet(s, getActor?.() ?? null, target)

  const monthLocked = (s: AppStore, month: string) =>
    isMonthWriteLocked(s, month, resolveTimesheetActorUser(s, getActor?.() ?? null))

  function updateMonth(month: string, updater: (sheet: MonthSheet) => MonthSheet) {
    setStore((s) => {
      if (monthLocked(s, month)) return s
      // updateMonth без row/brigade — только edit-all (HR/admin).
      if (!allowWrite(s, { month })) return s
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        if (!row) return base

        const prevHolder =
          employeeId != null
            ? sheet.rows.find((r) => r.id !== rowId && r.employeeId === employeeId)
            : undefined

        const rows = sheet.rows.map((r) => {
          if (r.id === rowId) return { ...r, employeeId }
          if (employeeId && r.employeeId === employeeId) {
            return { ...r, employeeId: null }
          }
          return r
        })
        let next: MonthSheet = { ...sheet, rows }

        // Перенос слота: сохраняем план/факт, иначе правки «пропадают» вместе со строкой.
        if (prevHolder) {
          next = moveRowMarks(next, prevHolder.id, rowId)
        } else if (employeeId) {
          const emp = base.employees.find((e) => e.id === employeeId)
          if (emp) next = syncPlanRow(next, rowId, emp)
        }
        // Снятие сотрудника со строки: plan/fact не трогаем — данные остаются на rowId
        // (пустой слот). Иначе односторонний wipe уходит в облако и затирает чужие правки.

        next = normalizeBrigadeSlots(next, row.brigade)
        let storeNext = { ...base, months: { ...base.months, [month]: next } }
        const af = actorFields()
        storeNext = appendAudit(storeNext, {
          action: 'bulk',
          month,
          rowId,
          employeeId: employeeId ?? undefined,
          brigade: row.brigade,
          by: af.by,
          byName: af.byName,
          detail: `Назначение в строку · ${row.brigade}${af.byName ? ` · ${af.byName}` : ''}`,
        })
        return storeNext
      })
    },

    setMark(
      month: string,
      rowId: string,
      dateKey: string,
      mode: 'plan' | 'fact',
      code: DayCode,
    ) {
      startTransition(() => {
        setStore((s) => {
          if (monthLocked(s, month)) return s
          if (!allowWrite(s, { month, rowId })) return s
          const base = ensureMonth(s, month)
          const sheet = base.months[month]
          const row = sheet.rows.find((r) => r.id === rowId)
          let nextSheet = sheet
          if (mode === 'plan') {
            const prev = (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
            nextSheet = applyPlanDayMark(sheet, rowId, dateKey, code)
            let next = { ...base, months: { ...base.months, [month]: nextSheet } }
            next = auditCellChange(next, {
              action: 'plan_change',
              month,
              rowId,
              dateKey,
              employeeId: row?.employeeId ?? undefined,
              brigade: row?.brigade,
              oldCode: prev,
              newCode: code,
              ...cellAuditFields(s, row?.brigade, month),
            })
            return next
          }
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
          next = auditCellChange(next, {
            action: 'fact_change',
            month,
            rowId,
            dateKey,
            employeeId: row?.employeeId ?? undefined,
            brigade: row?.brigade,
            oldCode: prev,
            newCode: code,
            ...cellAuditFields(s, row?.brigade, month),
          })
          const journalKind = journalKindForDayCode(code)
          if (journalKind && row?.employeeId && prev !== code) {
            next = appendEmployeeJournalInStore(next, row.employeeId, {
              kind: journalKind,
              month,
              dateKey,
              code,
              source: 'timesheet',
              note: `${prev || '·'} → ${code || '·'}`,
            })
          }
          return next
        })
      })
    },

    /**
     * Несколько ячеек за один setStore (мультивыбор) — без N полных ререндеров App.
     */
    setMarksBatch(
      month: string,
      mode: 'plan' | 'fact',
      cells: Array<{ rowId: string; dateKey: string }>,
      code: DayCode,
    ) {
      if (cells.length === 0) return
      startTransition(() => {
        setStore((s) => {
          if (monthLocked(s, month)) return s
          const base = ensureMonth(s, month)
          let sheet = base.months[month]
          const af = actorFields()
          let changed = 0

          if (mode === 'plan') {
            for (const { rowId, dateKey } of cells) {
              if (!allowWrite(s, { month, rowId })) continue
              const prev = (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
              if (prev === code) continue
              sheet = applyPlanDayMark(sheet, rowId, dateKey, code)
              changed += 1
            }
            if (changed === 0) return s
            let next = { ...base, months: { ...base.months, [month]: sheet } }
            next = appendAudit(next, {
              action: 'plan_change',
              month,
              by: af.by,
              byName: af.byName,
              detail: `План пакет ${changed} яч. → ${code || '·'}${af.byName ? ` · ${af.byName}` : ''}`,
            })
            return next
          }

          const fact = { ...sheet.fact }
          const overrides = [...sheet.factOverrides]
          const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
          const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
          const journalOps: Array<{
            employeeId: string
            dateKey: string
            prev: DayCode | ''
          }> = []

          for (const { rowId, dateKey } of cells) {
            if (!allowWrite(s, { month, rowId })) continue
            const row = sheet.rows.find((r) => r.id === rowId)
            const prev = getFactMark(sheet, rowId, dateKey) ?? ''
            if (prev === code) continue
            fact[rowId] = { ...(fact[rowId] ?? {}), [dateKey]: code }
            const oKey = `${rowId}|${dateKey}`
            if (!overrides.includes(oKey)) overrides.push(oKey)
            if (!isWorkCode(code)) {
              delete factExtraHours[cellLookupKey(rowId, dateKey)]
              delete factHoursOverride[cellLookupKey(rowId, dateKey)]
            }
            changed += 1
            const journalKind = journalKindForDayCode(code)
            if (journalKind && row?.employeeId) {
              journalOps.push({ employeeId: row.employeeId, dateKey, prev })
            }
          }
          if (changed === 0) return s

          sheet = {
            ...sheet,
            fact,
            factOverrides: overrides,
            factExtraHours,
            factHoursOverride,
          }
          let next: AppStore = {
            ...base,
            months: { ...base.months, [month]: sheet },
          }
          next = appendAudit(next, {
            action: 'fact_change',
            month,
            by: af.by,
            byName: af.byName,
            detail: `Факт пакет ${changed} яч. → ${code || '·'}${af.byName ? ` · ${af.byName}` : ''}`,
          })
          for (const op of journalOps) {
            const journalKind = journalKindForDayCode(code)
            if (!journalKind) continue
            next = appendEmployeeJournalInStore(next, op.employeeId, {
              kind: journalKind,
              month,
              dateKey: op.dateKey,
              code,
              source: 'timesheet',
              note: `${op.prev || '·'} → ${code || '·'}`,
            })
          }
          return next
        })
      })
    },

    /**
     * Применить черновик плана из редактора: ячейка за ячейкой + итог plan_save в журнале.
     * @returns число изменённых ячеек
     */
    commitPlanDraft(
      month: string,
      draftPlan: Record<string, Record<string, DayCode>>,
    ): number {
      let changeCount = 0
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const { year, month: mo } = parseMonthKey(month)
        const nDays = daysInMonth(year, mo)
        const rowIds = new Set<string>([
          ...sheet.rows.map((r) => r.id),
          ...Object.keys(draftPlan),
          ...Object.keys(sheet.plan),
        ])

        let nextSheet = sheet
        const cellAudits: Array<{
          rowId: string
          dateKey: string
          employeeId?: string
          brigade?: string
          oldCode: DayCode
          newCode: DayCode
        }> = []

        for (const rowId of rowIds) {
          const row = sheet.rows.find((r) => r.id === rowId)
          for (let d = 1; d <= nDays; d++) {
            const dateKey = dayDateKey(year, mo, d)
            const oldCode = (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
            const newCode = (draftPlan[rowId]?.[dateKey] ?? '') as DayCode
            if (oldCode === newCode) continue
            nextSheet = applyPlanDayMark(nextSheet, rowId, dateKey, newCode)
            cellAudits.push({
              rowId,
              dateKey,
              employeeId: row?.employeeId ?? undefined,
              brigade: row?.brigade,
              oldCode,
              newCode,
            })
          }
        }

        changeCount = cellAudits.length
        if (changeCount === 0) {
          const af = actorFields()
          return appendAudit(base, {
            action: 'plan_save',
            month,
            by: af.by,
            byName: af.byName,
            detail: `План сохранён · без изменений ячеек${af.byName ? ` · ${af.byName}` : ''}`,
          })
        }

        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        for (const c of cellAudits) {
          next = auditCellChange(next, {
            action: 'plan_change',
            month,
            rowId: c.rowId,
            dateKey: c.dateKey,
            employeeId: c.employeeId,
            brigade: c.brigade,
            oldCode: c.oldCode,
            newCode: c.newCode,
            ...cellAuditFields(s, c.brigade, month),
          })
        }
        const af = actorFields()
        next = appendAudit(next, {
          action: 'plan_save',
          month,
          by: af.by,
          byName: af.byName,
          detail: `План сохранён · ячеек: ${changeCount}${af.byName ? ` · ${af.byName}` : ''}`,
        })
        return next
      })
      return changeCount
    },

    /**
     * Применить черновик правок табеля одним setStore — после подтверждения «Готово».
     * Создаёт документ ВТ (posted) + cell audit + timesheet_entry_post.
     */
    commitTimesheetDraft(
      month: string,
      changes: Array<{
        rowId: string
        dateKey: string
        mode: 'plan' | 'fact'
        before: DayCode
        after: DayCode
      }>,
    ): CommitTimesheetDraftResult {
      const empty: CommitTimesheetDraftResult = {
        applied: 0,
        skipped: 0,
        appliedChanges: [],
        ok: false,
      }
      if (changes.length === 0) return empty
      let result: CommitTimesheetDraftResult = empty
      setStore((s) => {
        if (monthLocked(s, month)) {
          result = { ...empty, skipped: changes.length, ok: false }
          return s
        }
        const base = ensureMonth(s, month)
        let sheet = base.months[month]
        const draftChanges: TimesheetEntryChange[] = changes.map((ch) => {
          const row = sheet.rows.find((r) => r.id === ch.rowId)
          return {
            ...ch,
            employeeId: row?.employeeId ?? undefined,
            brigade: row?.brigade,
          }
        })

        const batch = applyTimesheetEntryChanges(sheet, draftChanges, (rowId) =>
          allowWrite(s, { month, rowId }),
        )
        sheet = batch.sheet
        result = {
          applied: batch.applied.length,
          skipped: batch.skipped,
          appliedChanges: batch.applied,
          ok: batch.applied.length > 0,
        }
        if (batch.applied.length === 0) return s

        let next: AppStore = {
          ...base,
          months: { ...base.months, [month]: sheet },
        }

        for (const mark of batch.applied) {
          const row = sheet.rows.find((r) => r.id === mark.rowId)
          next = auditCellChange(next, {
            action: mark.mode === 'plan' ? 'plan_change' : 'fact_change',
            month,
            rowId: mark.rowId,
            dateKey: mark.dateKey,
            employeeId: row?.employeeId ?? mark.employeeId,
            brigade: row?.brigade ?? mark.brigade,
            oldCode: mark.before,
            newCode: mark.after,
            ...cellAuditFields(s, row?.brigade ?? mark.brigade, month),
          })
          if (mark.mode === 'fact') {
            const journalKind = journalKindForDayCode(mark.after)
            if (journalKind && (row?.employeeId || mark.employeeId)) {
              next = appendEmployeeJournalInStore(next, row?.employeeId ?? mark.employeeId!, {
                kind: journalKind,
                month,
                dateKey: mark.dateKey,
                code: mark.after,
                source: 'timesheet',
                note: `${mark.before || '·'} → ${mark.after || '·'}`,
              })
            }
          }
        }

        const te = normalizeTimesheetEntryStore(
          next.timesheetEntries ?? createDefaultTimesheetEntryStore(),
        )
        const af = actorFields()
        const now = new Date().toISOString()
        const docId = crypto.randomUUID()
        const number = nextTimesheetEntryNumber(te.documents)
        const doc = {
          id: docId,
          number,
          status: 'posted' as const,
          month,
          source: 'edit_batch' as const,
          changes: draftChanges,
          applied: batch.applied,
          skipped: batch.skipped || undefined,
          createdAt: now,
          createdBy: af.by,
          createdByName: af.byName,
          postedAt: now,
          postedBy: af.by,
          postedByName: af.byName,
        }
        next = {
          ...next,
          timesheetEntries: {
            documents: trimTimesheetEntryDocuments([doc, ...te.documents]),
          },
        }
        return appendAudit(next, {
          action: 'timesheet_entry_post',
          month,
          by: af.by,
          byName: af.byName,
          detail: `${number}: ${batch.applied.length} яч.${
            batch.skipped ? ` · пропуск ${batch.skipped}` : ''
          }${af.byName ? ` · ${af.byName}` : ''}`,
        })
      })
      return result
    },

    voidTimesheetEntry(documentId: string): boolean {
      let ok = false
      setStore((s) => {
        const te = normalizeTimesheetEntryStore(
          s.timesheetEntries ?? createDefaultTimesheetEntryStore(),
        )
        const doc = te.documents.find((d) => d.id === documentId)
        if (!doc || doc.status !== 'posted' || !doc.applied?.length) return s
        if (monthLocked(s, doc.month)) return s
        if (!allowWrite(s, { month: doc.month })) return s
        const actor = getActor?.() ?? null
        const user = resolveTimesheetActorUser(s, actor)
        const role = user?.roleId
        if (role !== 'sysadmin' && role !== 'finance') return s

        const base = ensureMonth(s, doc.month)
        const sheet = base.months[doc.month]
        const reverted = revertTimesheetEntryApplied(sheet, doc.applied)
        // Не помечаем void, если хоть одна ячейка уже изменена — иначе журнал врёт.
        if (reverted.skipped > 0) return s

        let next: AppStore = {
          ...base,
          months: { ...base.months, [doc.month]: reverted.sheet },
        }
        const af = actorFields()
        const now = new Date().toISOString()
        const documents = te.documents.map((d) =>
          d.id === documentId
            ? {
                ...d,
                status: 'void' as const,
                voidedAt: now,
                voidedBy: af.by,
                voidedByName: af.byName,
                voidDetail: undefined,
              }
            : d,
        )
        next = { ...next, timesheetEntries: { documents } }
        next = appendAudit(next, {
          action: 'timesheet_entry_void',
          month: doc.month,
          by: af.by,
          byName: af.byName,
          detail: `${doc.number}: откат ${reverted.reverted}${
            af.byName ? ` · ${af.byName}` : ''
          }`,
        })
        ok = true
        return next
      })
      return ok
    },

    cycleMark(month: string, rowId: string, dateKey: string, mode: 'plan' | 'fact') {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const current =
          mode === 'plan'
            ? (sheet.plan[rowId]?.[dateKey] ?? '')
            : (getFactMark(sheet, rowId, dateKey) ?? '')
        const code = nextCode(current as DayCode) as DayCode
        // Re-use setMark path via nested logic — call same mutations inline
        if (mode === 'plan') {
          const nextSheet = applyPlanDayMark(sheet, rowId, dateKey, code)
          let next = { ...base, months: { ...base.months, [month]: nextSheet } }
          next = auditCellChange(next, {
            action: 'plan_change',
            month,
            rowId,
            dateKey,
            employeeId: row?.employeeId ?? undefined,
            brigade: row?.brigade,
            oldCode: current as DayCode,
            newCode: code,
            ...cellAuditFields(s, row?.brigade, month),
          })
          return next
        }
        const oKey = `${rowId}|${dateKey}`
        const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
        const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
        if (!isWorkCode(code)) {
          delete factExtraHours[cellLookupKey(rowId, dateKey)]
          delete factHoursOverride[cellLookupKey(rowId, dateKey)]
        }
        const nextSheet = {
          ...sheet,
          fact: { ...sheet.fact, [rowId]: { ...sheet.fact[rowId], [dateKey]: code } },
          factOverrides: sheet.factOverrides.includes(oKey)
            ? sheet.factOverrides
            : [...sheet.factOverrides, oKey],
          factExtraHours,
          factHoursOverride,
        }
        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        next = auditCellChange(next, {
          action: 'fact_change',
          month,
          rowId,
          dateKey,
          employeeId: row?.employeeId ?? undefined,
          brigade: row?.brigade,
          oldCode: current as DayCode,
          newCode: code,
          ...cellAuditFields(s, row?.brigade, month),
        })
        return next
      })
    },

    setCellComment(month: string, rowId: string, dateKey: string, text: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const row = base.months[month].rows.find((r) => r.id === rowId)
        const sheet = setCellComment(base.months[month], rowId, dateKey, text)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        const af = actorFields()
        next = appendAudit(next, {
          action: 'comment',
          month,
          rowId,
          dateKey,
          employeeId: row?.employeeId ?? undefined,
          brigade: row?.brigade,
          by: af.by,
          byName: af.byName,
          detail: `${text.slice(0, 80)}${af.byName ? ` · ${af.byName}` : ''}`,
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
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
        const row = base.months[month].rows.find((r) => r.id === rowId)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        const af = actorFields()
        next = appendAudit(next, {
          action: 'substitution',
          month,
          rowId,
          dateKey,
          employeeId: row?.employeeId ?? undefined,
          brigade: row?.brigade,
          by: af.by,
          byName: af.byName,
          detail: `${sub.absentCode}→${subEmp?.fullName ?? sub.substituteEmployeeId}${af.byName ? ` · ${af.byName}` : ''}`,
        })
        return next
      })
      return { warningNoRow }
    },

    clearSubstitution(month: string, rowId: string, dateKey: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = clearSubstitution(base.months[month], rowId, dateKey)
        return { ...base, months: { ...base.months, [month]: sheet } }
      })
    },

    bulkHolidayV(month: string, brigades?: string[]) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        const af = actorFields()
        if (brigades && brigades.length > 0) {
          if (!brigades.every((b) => allowWrite(s, { month, brigade: b }))) return s
        } else if (!allowWrite(s, { month })) {
          return s
        }
        const base = ensureMonth(s, month)
        const sheet = applyHolidayVForAll(
          base.months[month],
          brigades,
          base.employees,
        )
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        const detail =
          brigades && brigades.length > 0
            ? `holiday V brigades ${brigades.join(', ')}${af.byName ? ` · ${af.byName}` : ''}`
            : `holiday V all${af.byName ? ` · ${af.byName}` : ''}`
        return appendAudit(next, {
          action: 'bulk',
          month,
          by: af.by,
          byName: af.byName,
          detail,
        })
      })
    },

    bulkCopyPlanToFact(
      month: string,
      scope: CopyPlanToFactScope,
      brigade?: string,
      opts?: { emptyOnly?: boolean },
    ) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (scope === 'brigade') {
          if (!allowWrite(s, { month, brigade: brigade ?? null })) return s
        } else if (!allowWrite(s, { month })) {
          return s
        }
        const af = actorFields()
        const base = ensureMonth(s, month)
        if (opts?.emptyOnly) {
          const { sheet, filledCells, people } = copyPlanToFactEmptyOnly(
            base.months[month],
            base.employees,
            scope,
            brigade,
          )
          if (filledCells === 0) return s
          let next = { ...base, months: { ...base.months, [month]: sheet } }
          const detail =
            scope === 'brigade' && brigade
              ? `copy plan→fact empty-only brigade ${brigade} (${filledCells} cells / ${people} ppl)${af.byName ? ` · ${af.byName}` : ''}`
              : `copy plan→fact empty-only ${scope} (${filledCells} cells / ${people} ppl)${af.byName ? ` · ${af.byName}` : ''}`
          return appendAudit(next, {
            action: 'bulk',
            month,
            brigade,
            by: af.by,
            byName: af.byName,
            detail,
          })
        }
        const sheet = copyPlanToFact(base.months[month], base.employees, scope, brigade)
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        const detail =
          scope === 'brigade' && brigade
            ? `copy plan→fact brigade ${brigade}${af.byName ? ` · ${af.byName}` : ''}`
            : `copy plan→fact ${scope}${af.byName ? ` · ${af.byName}` : ''}`
        return appendAudit(next, {
          action: 'bulk',
          month,
          brigade,
          by: af.by,
          byName: af.byName,
          detail,
        })
      })
    },

    bulkCopyPlanToFact52(month: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month })) return s
        const af = actorFields()
        const base = ensureMonth(s, month)
        const sheet = copyPlanToFact(base.months[month], base.employees, '52')
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        return appendAudit(next, {
          action: 'bulk',
          month,
          by: af.by,
          byName: af.byName,
          detail: `copy plan→fact 52${af.byName ? ` · ${af.byName}` : ''}`,
        })
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
      applyStoreUpdate(setStore, (s) => {
        let next = addBrigadeToStore(s, trimmed)
        const { ka, en } = suggestLocalizedNames(trimmed)
        if (ka) {
          next = {
            ...next,
            brigadeNamesKa: { ...next.brigadeNamesKa, [trimmed]: ka },
          }
        }
        if (en) {
          next = {
            ...next,
            brigadeNamesEn: { ...(next.brigadeNamesEn ?? {}), [trimmed]: en },
          }
        }
        const af = actorFields()
        return appendAudit(next, {
          action: 'directory_change',
          detail: `Бригада создана: ${trimmed}`,
          newValue: trimmed,
          by: af.by,
          byName: af.byName,
        })
      })
    },

    renameBrigade(oldName: string, newName: string) {
      applyStoreUpdate(setStore, (s) => {
        let next = renameBrigadeInStore(s, oldName, newName)
        const ka = next.brigadeNamesKa[oldName]
        if (ka) {
          const { [oldName]: _, ...rest } = next.brigadeNamesKa
          next = { ...next, brigadeNamesKa: { ...rest, [newName]: ka } }
        }
        const en = next.brigadeNamesEn?.[oldName]
        if (en) {
          const { [oldName]: _e, ...restEn } = next.brigadeNamesEn ?? {}
          next = { ...next, brigadeNamesEn: { ...restEn, [newName]: en } }
        }
        const brigadier = next.brigadiers[oldName]
        if (brigadier) {
          const { [oldName]: _b, ...rest } = next.brigadiers
          next = { ...next, brigadiers: { ...rest, [newName]: brigadier } }
        }
        next = ensureMonthReady(next)
        const af = actorFields()
        return appendAudit(next, {
          action: 'brigade_rename',
          detail: `Бригада: ${oldName} → ${newName}`,
          oldValue: oldName,
          newValue: newName,
          by: af.by,
          byName: af.byName,
        })
      })
    },

    setBrigadier(brigade: string, employeeId: string | null) {
      setStore((s) => {
        // ACL по бригаде (у updateMonth без rowId scoped-роли получают отказ)
        const month =
          Object.keys(s.months).sort().at(-1) ??
          new Date().toISOString().slice(0, 7)
        if (!allowWrite(s, { month, brigade })) return s
        if (s.brigadeHasBrigadier?.[brigade] === false) {
          // Бригада без роли бригадира — только снятие старого назначения.
          if (s.brigadiers[brigade]) {
            const { [brigade]: _, ...rest } = s.brigadiers
            return { ...s, brigadiers: rest }
          }
          return s
        }
        if (!employeeId) {
          const { [brigade]: _, ...rest } = s.brigadiers
          return { ...s, brigadiers: rest }
        }
        return { ...s, brigadiers: { ...s.brigadiers, [brigade]: employeeId } }
      })
    },

    setBrigadeHasBrigadier(brigade: string, hasBrigadier: boolean) {
      setStore((s) => {
        const actorUser = resolveTimesheetActorUser(s, getActor?.())
        if (actorUser?.roleId !== 'sysadmin') return s
        if (!s.brigades.includes(brigade)) return s
        const brigadeHasBrigadier = {
          ...(s.brigadeHasBrigadier ?? {}),
          [brigade]: hasBrigadier,
        }
        if (hasBrigadier) {
          return { ...s, brigadeHasBrigadier }
        }
        const { [brigade]: _removed, ...brigadiers } = s.brigadiers
        return {
          ...s,
          brigadeHasBrigadier,
          brigadiers,
          months: clearBrigadierMarksForBrigade(s.months, brigade),
        }
      })
    },

    setBrigadierDay(month: string, rowId: string, dateKey: string, on: boolean) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        if (row && s.brigadeHasBrigadier?.[row.brigade] === false) return base
        const key = `${rowId}|${dateKey}`
        const current = { ...(sheet.brigadierDays ?? {}) }
        if (on) {
          if (row) {
            for (const r of sheet.rows) {
              if (r.brigade === row.brigade && r.id !== rowId) {
                delete current[`${r.id}|${dateKey}`]
              }
            }
          }
          current[key] = true
        } else if (current[key]) {
          delete current[key]
        } else {
          return base
        }
        return {
          ...base,
          months: { ...base.months, [month]: { ...sheet, brigadierDays: current } },
        }
      })
    },

    /** Отметить/снять бригадирство на весь месяц (по плановым рабочим дням строки). */
    setBrigadierMonth(month: string, rowId: string, on: boolean) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
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
        return {
          ...base,
          months: { ...base.months, [month]: { ...sheet, brigadierDays: next } },
        }
      })
    },

    /** Заместитель-бригадир с выбранного дня до конца месяца (рабочие дни плана). */
    setBrigadierFromDay(month: string, rowId: string, fromDateKey: string, on: boolean) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const { year, month: mo } = parseMonthKey(sheet.month)
        const days = daysInMonth(year, mo)
        const fromDay = Number(fromDateKey.slice(8))
        if (!Number.isFinite(fromDay) || fromDay < 1) return base
        const prefix = `${rowId}|`
        const row = sheet.rows.find((r) => r.id === rowId)
        const next: Record<string, true> = { ...(sheet.brigadierDays ?? {}) }
        for (let d = fromDay; d <= days; d++) {
          const dateKey = dayDateKey(year, mo, d)
          const key = `${prefix}${dateKey}`
          if (!on) {
            delete next[key]
            continue
          }
          if (!isWorkCode(sheet.plan[rowId]?.[dateKey] ?? '')) {
            delete next[key]
            continue
          }
          if (row) {
            for (const r of sheet.rows) {
              if (r.brigade === row.brigade && r.id !== rowId) {
                delete next[`${r.id}|${dateKey}`]
              }
            }
          }
          next[key] = true
        }
        return {
          ...base,
          months: { ...base.months, [month]: { ...sheet, brigadierDays: next } },
        }
      })
    },

    /** Не работает с выбранного дня до конца месяца (только этот лист). */
    setRowInactiveFrom(month: string, rowId: string, dateKey: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const emp = row?.employeeId
          ? base.employees.find((e) => e.id === row.employeeId)
          : null
        if (!emp) return s
        const rowBounds = { ...(sheet.rowBounds ?? {}) }
        const prev = rowBounds[rowId] ?? {}
        rowBounds[rowId] = { ...prev, inactiveFrom: dateKey, inactiveUntil: undefined }
        let nextSheet: MonthSheet = { ...sheet, rowBounds }
        nextSheet = syncPlanRow(nextSheet, rowId, emp)
        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        return appendAudit(next, {
          action: 'plan_change',
          month,
          rowId,
          dateKey,
          employeeId: emp.id,
          detail: `не работает с ${dateKey} до конца месяца`,
        })
      })
    },

    /** Работает с выбранного дня до конца месяца (дни раньше — пусто). */
    setRowActiveFrom(month: string, rowId: string, dateKey: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const emp = row?.employeeId
          ? base.employees.find((e) => e.id === row.employeeId)
          : null
        if (!emp) return s
        const inactiveUntil = dayBefore(dateKey)
        const rowBounds = { ...(sheet.rowBounds ?? {}) }
        rowBounds[rowId] = { inactiveUntil, inactiveFrom: undefined }
        let nextSheet: MonthSheet = { ...sheet, rowBounds }
        nextSheet = syncPlanRow(nextSheet, rowId, emp)
        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        return appendAudit(next, {
          action: 'plan_change',
          month,
          rowId,
          dateKey,
          employeeId: emp.id,
          detail: `работает с ${dateKey} до конца месяца`,
        })
      })
    },

    clearRowPeriod(month: string, rowId: string) {
      setStore((s) => {
        if (monthLocked(s, month)) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        if (!sheet.rowBounds?.[rowId]) return s
        const row = sheet.rows.find((r) => r.id === rowId)
        const emp = row?.employeeId
          ? base.employees.find((e) => e.id === row.employeeId)
          : null
        const rowBounds = { ...sheet.rowBounds }
        delete rowBounds[rowId]
        let nextSheet: MonthSheet = { ...sheet, rowBounds }
        if (emp) nextSheet = syncPlanRow(nextSheet, rowId, emp)
        let next = { ...base, months: { ...base.months, [month]: nextSheet } }
        return appendAudit(next, {
          action: 'plan_change',
          month,
          rowId,
          employeeId: emp?.id,
          detail: 'снята отметка периода работы в месяце',
        })
      })
    },

    setBrigadeNameKa(nameRu: string, nameKa: string) {
      setStore((s) => ({
        ...s,
        brigadeNamesKa: { ...s.brigadeNamesKa, [nameRu]: nameKa },
      }))
    },

    setBrigadeNameEn(nameRu: string, nameEn: string) {
      setStore((s) => ({
        ...s,
        brigadeNamesEn: { ...(s.brigadeNamesEn ?? {}), [nameRu]: nameEn },
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
      applyStoreUpdate(setStore, (s) => {
        const next = removeBrigadeFromStore(s, name)
        const af = actorFields()
        return appendAudit(next, {
          action: 'directory_change',
          detail: `Бригада удалена: ${name}`,
          oldValue: name,
          by: af.by,
          byName: af.byName,
        })
      })
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
        if (monthLocked(s, month)) return s
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

    reorderBrigadeRowInMonth(
      month: string,
      brigade: string,
      rowId: string,
      beforeRowId: string | null,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (monthLocked(s, month)) return s
        // Scoped masters: ACL by brigade (bare updateMonth only allows plant-wide edit).
        if (!allowWrite(s, { month, brigade, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        if (!row || row.brigade !== brigade) return base
        ok = true
        return {
          ...base,
          months: {
            ...base.months,
            [month]: reorderBrigadeRow(sheet, brigade, rowId, beforeRowId),
          },
        }
      })
      return ok
    },

    replaceEmployeeInBrigade(
      month: string,
      brigade: string,
      fromEmployeeId: string,
      toEmployeeId: string,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (monthLocked(s, month)) return s
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
        if (monthLocked(s, month)) return s
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
        if (monthLocked(s, month)) return s
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
        if (monthLocked(s, month)) return s
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
        if (monthLocked(s, month)) return s
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

    /**
     * Перевод в бригаду с даты (план/график режутся; норма ЗП = сумма кусков).
     * fromDateKey — первый день в новой бригаде.
     */
    transferEmployeeFromDate(
      month: string,
      employeeId: string,
      toBrigade: string,
      fromDateKey: string,
      opts?: {
        schedule?: import('@/lib/types').ScheduleType
        shiftHours?: number
        group2x2?: import('@/lib/types').Group2x2
        shiftMode?: import('@/lib/types').ShiftMode
      },
    ): boolean {
      let ok = false
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, brigade: toBrigade })) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp) return base
        const result = applyBrigadeTransferFromDate(base, month, {
          employeeId,
          toBrigade,
          fromDateKey,
          schedule: opts?.schedule ?? emp.schedule,
          shiftHours: opts?.shiftHours,
          group2x2: opts?.group2x2,
          shiftMode: opts?.shiftMode,
        })
        if (!result.ok) return base
        ok = true
        return appendAudit(result.store, {
          action: 'plan_change',
          month,
          employeeId,
          dateKey: fromDateKey,
          detail: `перевод в «${toBrigade}» с ${fromDateKey} (${opts?.schedule ?? emp.schedule})`,
        })
      })
      return ok
    },

    /** Закрепить в бригаде с 1-го числа месяца (полный перенос состава). */
    assignPermanentToBrigade(
      month: string,
      employeeId: string,
      brigade: string,
    ): boolean {
      const { year, month: mo } = parseMonthKey(month)
      const fromDateKey = dayDateKey(year, mo, 1)
      let ok = false
      setStore((s) => {
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, brigade })) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp) return base
        const result = applyBrigadeTransferFromDate(base, month, {
          employeeId,
          toBrigade: brigade,
          fromDateKey,
          schedule: emp.schedule,
          mode: 'move',
        })
        if (!result.ok) return base
        ok = true
        return appendAudit(result.store, {
          action: 'plan_change',
          month,
          employeeId,
          dateKey: fromDateKey,
          detail: `закреплён в «${brigade}» с начала месяца`,
        })
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
        if (monthLocked(s, month)) return s
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const row = sheet.rows.find((r) => r.id === rowId)
        const { year, month: mo } = parseMonthKey(month)
        const af = actorFields()

        if (mode === 'plan') {
          let nextSheet = sheet
          for (let d = fromDay; d <= toDay; d++) {
            nextSheet = applyPlanDayMark(nextSheet, rowId, dayDateKey(year, mo, d), code)
          }
          let next = {
            ...base,
            months: { ...base.months, [month]: nextSheet },
          }
          next = appendAudit(next, {
            action: 'plan_change',
            month,
            rowId,
            employeeId: row?.employeeId ?? undefined,
            brigade: row?.brigade,
            by: af.by,
            byName: af.byName,
            detail: `План диапазон ${fromDay}–${toDay} → ${code || '·'}${af.byName ? ` · ${af.byName}` : ''}`,
          })
          return next
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
            actorFields(),
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
        if (monthLocked(s, month)) return s
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
          next = auditFactChange(next, month, rowId, dateKey, employeeId, prev, code, actorFields())
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, rowId })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const prevCode = getFactMark(sheet, rowId, dateKey)
        const clamped =
          hours == null ? null : Math.max(0, Math.min(24, Math.round(hours)))

        // Выходной / пустая ячейка: часы сразу ставят рабочий код (4, 6, 8…), без «сначала 8».
        let code = prevCode
        let fact = sheet.fact
        let factOverrides = sheet.factOverrides
        if (!isWorkCode(code) && clamped != null && clamped > 0) {
          code = workCodeForExactHours(clamped)
          const rowFact = { ...(sheet.fact[rowId] ?? {}), [dateKey]: code }
          fact = { ...sheet.fact, [rowId]: rowFact }
          const oKey = `${rowId}|${dateKey}`
          factOverrides = factOverrides.includes(oKey)
            ? factOverrides
            : [...factOverrides, oKey]
        }
        if (!isWorkCode(code)) return s

        const key = cellLookupKey(rowId, dateKey)
        const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
        const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
        const norm = hoursForCode(code)
        if (clamped == null || clamped === norm) {
          delete factHoursOverride[key]
        } else {
          factHoursOverride[key] = clamped
          delete factExtraHours[key]
        }
        let next: AppStore = {
          ...base,
          months: {
            ...base.months,
            [month]: {
              ...sheet,
              fact,
              factOverrides,
              factHoursOverride,
              factExtraHours,
            },
          },
        }
        if (code !== prevCode) {
          const row = sheet.rows.find((r) => r.id === rowId)
          next = auditFactChange(
            next,
            month,
            rowId,
            dateKey,
            row?.employeeId ?? undefined,
            prevCode,
            code,
            actorFields(),
          )
        }
        return next
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
        if (monthLocked(s, month)) return s
        if (!allowWrite(s, { month, brigade })) return s
        const base = ensureMonth(s, month)
        const emp = base.employees.find((e) => e.id === employeeId)
        if (!emp || !base.brigades.includes(brigade)) return base

        let sheet = base.months[month]

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

        // Снять старый перевод и чужие факты за день (кроме целевой строки).
        sheet = prepareDayTransfer(sheet, employeeId, dateKey, targetRowId)
        const homeRowId = findHomeWorkRow(sheet, employeeId, dateKey, brigade)

        if (homeRowId && homeRowId !== targetRowId) {
          sheet = setFactWithOverride(sheet, homeRowId, dateKey, 'В')
          sheet = withDayTransfer(sheet, employeeId, dateKey, {
            fromRowId: homeRowId,
            toRowId: targetRowId,
            toBrigade: brigade,
          })
        }

        sheet = setFactWithOverride(sheet, targetRowId, dateKey, code)
        sheet = normalizeBrigadeSlots(sheet, brigade)

        ok = true
        let next = { ...base, months: { ...base.months, [month]: sheet } }
        next = auditFactChange(next, month, targetRowId, dateKey, employeeId, '', code, actorFields())
        if (homeRowId && homeRowId !== targetRowId) {
          next = auditFactChange(next, month, homeRowId, dateKey, employeeId, '', 'В', actorFields())
        }
        return next
      })
      return ok
    },

    /** Отменить временный перевод «на этот день». */
    clearBrigadeDayTransfer(
      month: string,
      employeeId: string,
      dateKey: string,
    ): boolean {
      let ok = false
      setStore((s) => {
        if (monthLocked(s, month)) return s
        const base = ensureMonth(s, month)
        let sheet = base.months[month]
        const tr = sheet.dayTransfers?.[`${employeeId}|${dateKey}`]
        if (!tr) return base
        const toBrigade = sheet.rows.find((r) => r.id === tr.toRowId)?.brigade
        if (!allowWrite(s, { month, brigade: toBrigade ?? null })) return base
        sheet = revokeDayTransfer(sheet, employeeId, dateKey)
        ok = true
        return {
          ...base,
          months: { ...base.months, [month]: sheet },
        }
      })
      return ok
    },

    /**
     * Сверка табеля бригады за месяц («посчитано верно»).
     * Не блокируется закрытием месяца — как подтверждение Б/ОТ.
     */
    setBrigadeSignoff(month: string, brigade: string, verified: boolean) {
      setStore((s) => {
        if (!allowWrite(s, { month, brigade })) return s
        const base = ensureMonth(s, month)
        const sheet = base.months[month]
        const brigadeSignoffs = { ...(sheet.brigadeSignoffs ?? {}) }
        if (!verified) {
          delete brigadeSignoffs[brigade]
        } else {
          const actor = actorFields()
          brigadeSignoffs[brigade] = {
            verified: true,
            at: new Date().toISOString(),
            by: actor.by,
            byName: actor.byName,
          }
        }
        return {
          ...base,
          months: {
            ...base.months,
            [month]: { ...sheet, brigadeSignoffs },
          },
        }
      })
    },
  }
}
