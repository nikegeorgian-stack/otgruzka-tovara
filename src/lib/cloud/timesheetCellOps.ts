/**
 * PHASE T1 — granular timesheet cell operations (client-side only).
 * Does not change AppStore / payloadJson shape.
 */
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import { cellLookupKey } from '@/lib/factExtra'
import {
  entityFingerprint,
  nextOperationId,
  type DirtyOperation,
  type EntityConflict,
  type TimesheetCellLayer,
  type TimesheetCellPatch,
  type TimesheetCellValue,
} from './dirtyOperations'
import type { StoreMutationOrigin } from './storeMutationOrigin'

export type { TimesheetCellLayer, TimesheetCellPatch, TimesheetCellValue }

export const TIMESHEET_CELL_DOMAIN = 'months'

/** Cell layers are handled by timesheetCell ops; factOverrides follows fact cells. */
const CELL_LAYER_KEYS = new Set([
  'plan',
  'fact',
  'comments',
  'factExtraHours',
  'factHoursOverride',
  'factOverrides',
])

/** All month fields except cell layers — rows, metadata, signoffs, etc. */
export type StructuralMonthSnapshot = Record<string, unknown>

export function timesheetCellEntityId(
  monthKey: string,
  layer: TimesheetCellLayer,
  rowId: string,
  dateKey: string,
): string {
  return `cell:${monthKey}:${layer}:${rowId}:${dateKey}`
}

export function structuralMonthEntityId(monthKey: string): string {
  return `month:${monthKey}`
}

export function isTimesheetCellOp(op: DirtyOperation): boolean {
  return op.domain === TIMESHEET_CELL_DOMAIN && Boolean(op.timesheetCell)
}

export function isStructuralMonthOp(op: DirtyOperation): boolean {
  return (
    op.domain === TIMESHEET_CELL_DOMAIN &&
    !op.timesheetCell &&
    op.entityId.startsWith('month:') &&
    op.entityId !== '*'
  )
}

export function isLegacyWholeMonthsOp(op: DirtyOperation): boolean {
  return op.domain === TIMESHEET_CELL_DOMAIN && op.entityId === '*' && !op.timesheetCell
}

function eqVal(a: TimesheetCellValue, b: TimesheetCellValue): boolean {
  return Object.is(a, b) || (a === null && b === null) || String(a) === String(b)
}

export function readCellValue(
  sheet: MonthSheet | undefined,
  layer: TimesheetCellLayer,
  rowId: string,
  dateKey: string,
): TimesheetCellValue {
  if (!sheet) return null
  if (layer === 'plan') {
    const row = sheet.plan?.[rowId]
    if (!row || !Object.prototype.hasOwnProperty.call(row, dateKey)) return null
    return (row[dateKey] ?? '') as DayCode
  }
  if (layer === 'fact') {
    const row = sheet.fact?.[rowId]
    if (!row || !Object.prototype.hasOwnProperty.call(row, dateKey)) return null
    return (row[dateKey] ?? '') as DayCode
  }
  const key = cellLookupKey(rowId, dateKey)
  if (layer === 'comment') {
    if (!sheet.comments || !Object.prototype.hasOwnProperty.call(sheet.comments, key)) return null
    return sheet.comments[key] ?? ''
  }
  if (layer === 'factExtraHours') {
    if (!sheet.factExtraHours || !Object.prototype.hasOwnProperty.call(sheet.factExtraHours, key)) {
      return null
    }
    return sheet.factExtraHours[key] ?? 0
  }
  if (layer === 'factHoursOverride') {
    if (
      !sheet.factHoursOverride ||
      !Object.prototype.hasOwnProperty.call(sheet.factHoursOverride, key)
    ) {
      return null
    }
    return sheet.factHoursOverride[key] ?? 0
  }
  return null
}

export function writeCellValue(
  sheet: MonthSheet,
  layer: TimesheetCellLayer,
  rowId: string,
  dateKey: string,
  value: TimesheetCellValue,
  explicitClear: boolean,
): MonthSheet {
  const clear = explicitClear || value === null || value === ''
  if (layer === 'plan') {
    const row = { ...(sheet.plan?.[rowId] ?? {}) }
    if (clear) delete row[dateKey]
    else row[dateKey] = value as DayCode
    const plan = { ...sheet.plan }
    if (Object.keys(row).length === 0) delete plan[rowId]
    else plan[rowId] = row
    return { ...sheet, plan }
  }
  if (layer === 'fact') {
    const oKey = `${rowId}|${dateKey}`
    const row = { ...(sheet.fact?.[rowId] ?? {}) }
    let factOverrides = [...(sheet.factOverrides ?? [])]
    if (clear) {
      delete row[dateKey]
      factOverrides = factOverrides.filter((k) => k !== oKey)
    } else {
      row[dateKey] = value as DayCode
      if (!factOverrides.includes(oKey)) factOverrides = [...factOverrides, oKey]
    }
    const fact = { ...sheet.fact }
    if (Object.keys(row).length === 0) delete fact[rowId]
    else fact[rowId] = row
    return { ...sheet, fact, factOverrides }
  }
  const key = cellLookupKey(rowId, dateKey)
  if (layer === 'comment') {
    const comments = { ...(sheet.comments ?? {}) }
    if (clear) delete comments[key]
    else comments[key] = String(value ?? '')
    return { ...sheet, comments }
  }
  if (layer === 'factExtraHours') {
    const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
    if (clear || value === 0) delete factExtraHours[key]
    else factExtraHours[key] = Number(value)
    return { ...sheet, factExtraHours }
  }
  if (layer === 'factHoursOverride') {
    const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
    if (clear) delete factHoursOverride[key]
    else factHoursOverride[key] = Number(value)
    return { ...sheet, factHoursOverride }
  }
  return sheet
}

export function pickStructuralMonth(sheet: MonthSheet | undefined): StructuralMonthSnapshot | null {
  if (!sheet) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sheet)) {
    if (!CELL_LAYER_KEYS.has(k)) out[k] = v
  }
  return out
}

export function applyStructuralMonthFields(
  remoteSheet: MonthSheet,
  localStructural: StructuralMonthSnapshot,
): MonthSheet {
  const next: MonthSheet = { ...remoteSheet }
  for (const [k, v] of Object.entries(localStructural)) {
    if (!CELL_LAYER_KEYS.has(k)) (next as Record<string, unknown>)[k] = v
  }
  return next
}

function employeeIdForRow(sheet: MonthSheet | undefined, rowId: string): string {
  const row = sheet?.rows?.find((r) => r.id === rowId)
  return row?.employeeId?.trim() || ''
}

function makeCellOp(
  monthKey: string,
  layer: TimesheetCellLayer,
  rowId: string,
  dateKey: string,
  baselineValue: TimesheetCellValue,
  nextValue: TimesheetCellValue,
  employeeId: string,
  baseRevision: number,
  origin: StoreMutationOrigin,
): DirtyOperation {
  const explicitClear =
    nextValue === null || nextValue === '' || (layer === 'factExtraHours' && nextValue === 0)
  const patch: TimesheetCellPatch = {
    monthKey,
    employeeId,
    rowId,
    dateKey,
    layer,
    baselineValue,
    nextValue: explicitClear && nextValue === '' ? null : nextValue,
    explicitClear,
  }
  return {
    operationId: nextOperationId(),
    type: explicitClear ? 'delete' : 'update',
    domain: TIMESHEET_CELL_DOMAIN,
    entityId: timesheetCellEntityId(monthKey, layer, rowId, dateKey),
    fields: [layer],
    baseRevision,
    origin,
    at: new Date().toISOString(),
    explicit: explicitClear,
    timesheetCell: patch,
    baselineEntity: baselineValue,
    baselineFingerprint: entityFingerprint(baselineValue),
    pendingLocal: patch.nextValue,
  }
}

function diffKeyedCellMap(
  monthKey: string,
  layer: 'comment' | 'factExtraHours' | 'factHoursOverride',
  before: Record<string, string | number> | undefined,
  after: Record<string, string | number> | undefined,
  sheetAfter: MonthSheet | undefined,
  baseRevision: number,
  origin: StoreMutationOrigin,
  ops: DirtyOperation[],
): void {
  const b = before ?? {}
  const a = after ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  for (const key of keys) {
    const pipe = key.indexOf('|')
    if (pipe <= 0) continue
    const rowId = key.slice(0, pipe)
    const dateKey = key.slice(pipe + 1)
    const bv = Object.prototype.hasOwnProperty.call(b, key) ? (b[key] as TimesheetCellValue) : null
    const av = Object.prototype.hasOwnProperty.call(a, key) ? (a[key] as TimesheetCellValue) : null
    if (eqVal(bv, av)) continue
    ops.push(
      makeCellOp(
        monthKey,
        layer,
        rowId,
        dateKey,
        bv,
        av,
        employeeIdForRow(sheetAfter, rowId),
        baseRevision,
        origin,
      ),
    )
  }
}

function diffNestedDayCodes(
  monthKey: string,
  layer: 'plan' | 'fact',
  before: Record<string, Record<string, DayCode>> | undefined,
  after: Record<string, Record<string, DayCode>> | undefined,
  sheetAfter: MonthSheet | undefined,
  baseRevision: number,
  origin: StoreMutationOrigin,
  ops: DirtyOperation[],
): void {
  const b = before ?? {}
  const a = after ?? {}
  const rowIds = new Set([...Object.keys(b), ...Object.keys(a)])
  for (const rowId of rowIds) {
    const brow = b[rowId] ?? {}
    const arow = a[rowId] ?? {}
    const dates = new Set([...Object.keys(brow), ...Object.keys(arow)])
    for (const dateKey of dates) {
      const hasB = Object.prototype.hasOwnProperty.call(brow, dateKey)
      const hasA = Object.prototype.hasOwnProperty.call(arow, dateKey)
      const bv: TimesheetCellValue = hasB ? ((brow[dateKey] ?? '') as DayCode) : null
      const av: TimesheetCellValue = hasA ? ((arow[dateKey] ?? '') as DayCode) : null
      if (eqVal(bv, av)) continue
      ops.push(
        makeCellOp(
          monthKey,
          layer,
          rowId,
          dateKey,
          bv,
          av,
          employeeIdForRow(sheetAfter, rowId),
          baseRevision,
          origin,
        ),
      )
    }
  }
}

function structuralChanged(before: MonthSheet | undefined, after: MonthSheet | undefined): boolean {
  return entityFingerprint(pickStructuralMonth(before)) !== entityFingerprint(pickStructuralMonth(after))
}

/**
 * Diff months → cell-level ops + per-monthKey structural ops.
 * Never emits legacy `entityId: '*'`.
 */
export function diffMonthsToOperations(
  beforeMonths: AppStore['months'],
  afterMonths: AppStore['months'],
  baseRevision: number,
  origin: StoreMutationOrigin,
): DirtyOperation[] {
  const ops: DirtyOperation[] = []
  const monthKeys = new Set([
    ...Object.keys(beforeMonths ?? {}),
    ...Object.keys(afterMonths ?? {}),
  ])

  for (const monthKey of monthKeys) {
    const b = beforeMonths?.[monthKey]
    const a = afterMonths?.[monthKey]
    if (entityFingerprint(b ?? null) === entityFingerprint(a ?? null)) continue

    if (a) {
      diffNestedDayCodes(monthKey, 'plan', b?.plan, a.plan, a, baseRevision, origin, ops)
      diffNestedDayCodes(monthKey, 'fact', b?.fact, a.fact, a, baseRevision, origin, ops)
      diffKeyedCellMap(monthKey, 'comment', b?.comments, a.comments, a, baseRevision, origin, ops)
      diffKeyedCellMap(
        monthKey,
        'factExtraHours',
        b?.factExtraHours,
        a.factExtraHours,
        a,
        baseRevision,
        origin,
        ops,
      )
      diffKeyedCellMap(
        monthKey,
        'factHoursOverride',
        b?.factHoursOverride,
        a.factHoursOverride,
        a,
        baseRevision,
        origin,
        ops,
      )
    } else if (b) {
      // Month removed from local — fail-closed structural conflict op (explicit removeMonth uses trash).
      ops.push({
        operationId: nextOperationId(),
        type: 'update',
        domain: TIMESHEET_CELL_DOMAIN,
        entityId: structuralMonthEntityId(monthKey),
        fields: ['structure'],
        baseRevision,
        origin,
        at: new Date().toISOString(),
        baselineEntity: pickStructuralMonth(b),
        baselineFingerprint: entityFingerprint(pickStructuralMonth(b)),
        pendingLocal: null,
      })
      continue
    }

    if (structuralChanged(b, a)) {
      const baselineSnap = pickStructuralMonth(b)
      const localSnap = pickStructuralMonth(a)
      ops.push({
        operationId: nextOperationId(),
        type: 'update',
        domain: TIMESHEET_CELL_DOMAIN,
        entityId: structuralMonthEntityId(monthKey),
        fields: ['structure'],
        baseRevision,
        origin,
        at: new Date().toISOString(),
        baselineEntity: baselineSnap,
        baselineFingerprint: entityFingerprint(baselineSnap),
        pendingLocal: localSnap,
      })
    }
  }

  return ops
}

export type ApplyMonthsOpsResult = {
  months: AppStore['months']
  appliedOperationIds: string[]
  conflicts: EntityConflict[]
}

function formatCellConflictMessage(patch: TimesheetCellPatch): string {
  const who = patch.employeeId || patch.rowId
  return `Табель ${patch.monthKey} · сотрудник ${who} · день ${patch.dateKey} (${patch.layer})`
}

export function formatTimesheetConflictDetail(conflict: EntityConflict): string {
  const cloud =
    conflict.cloudSnapshot === null || conflict.cloudSnapshot === undefined
      ? '(пусто)'
      : String(conflict.cloudSnapshot)
  const local =
    conflict.pendingLocal === null || conflict.pendingLocal === undefined
      ? '(пусто)'
      : typeof conflict.pendingLocal === 'object'
        ? JSON.stringify(conflict.pendingLocal)
        : String(conflict.pendingLocal)
  if (conflict.entityId.startsWith('cell:')) {
    return `${conflict.message} · облако: ${cloud} · локально: ${local}`
  }
  return conflict.message
}

/** Pure helper for beforeunload gate (unit-tested). */
export function shouldWarnBeforeUnload(input: {
  pendingUserOps: number
  saving: boolean
  unresolvedConflicts: number
}): boolean {
  return input.pendingUserOps > 0 || input.saving || input.unresolvedConflicts > 0
}

/**
 * Apply granular month ops onto fresh remote months (never whole local months tree).
 */
export function applyMonthsGranularOperations(
  remoteMonths: AppStore['months'],
  baselineMonths: AppStore['months'],
  localMonths: AppStore['months'],
  operations: DirtyOperation[],
): ApplyMonthsOpsResult {
  const months: AppStore['months'] = JSON.parse(JSON.stringify(remoteMonths ?? {}))
  const appliedOperationIds: string[] = []
  const conflicts: EntityConflict[] = []

  for (const op of operations) {
    if (isLegacyWholeMonthsOp(op)) {
      conflicts.push({
        operationId: op.operationId,
        domain: TIMESHEET_CELL_DOMAIN,
        entityId: '*',
        reason: 'domain_conflict',
        message:
          'Legacy whole-months operation blocked — refuse silent overwrite of months tree',
        pendingLocal: localMonths,
        cloudSnapshot: remoteMonths,
      })
      continue
    }

    if (isTimesheetCellOp(op) && op.timesheetCell) {
      const patch = op.timesheetCell
      const sheet = months[patch.monthKey]
      const remoteVal = readCellValue(sheet, patch.layer, patch.rowId, patch.dateKey)
      if (eqVal(remoteVal, patch.baselineValue)) {
        const baseSheet =
          sheet ??
          ({
            month: patch.monthKey,
            rows: localMonths[patch.monthKey]?.rows ?? [],
            plan: {},
            fact: {},
            factOverrides: [],
            comments: {},
            substitutions: {},
          } as MonthSheet)
        months[patch.monthKey] = writeCellValue(
          baseSheet,
          patch.layer,
          patch.rowId,
          patch.dateKey,
          patch.nextValue,
          patch.explicitClear,
        )
        appliedOperationIds.push(op.operationId)
        continue
      }
      if (eqVal(remoteVal, patch.nextValue)) {
        appliedOperationIds.push(op.operationId)
        continue
      }
      conflicts.push({
        operationId: op.operationId,
        domain: TIMESHEET_CELL_DOMAIN,
        entityId: op.entityId,
        reason: 'concurrent_edit',
        message: formatCellConflictMessage(patch),
        pendingLocal: patch.nextValue,
        cloudSnapshot: remoteVal,
        baselineSnapshot: patch.baselineValue,
      })
      continue
    }

    if (isStructuralMonthOp(op)) {
      const monthKey = op.entityId.slice('month:'.length)
      const remoteSheet = months[monthKey]
      const baselineSnap =
        (op.baselineEntity as StructuralMonthSnapshot | null | undefined) ??
        pickStructuralMonth(baselineMonths[monthKey])
      const localSnap =
        (op.pendingLocal as StructuralMonthSnapshot | null | undefined) ??
        pickStructuralMonth(localMonths[monthKey])
      const remoteSnap = pickStructuralMonth(remoteSheet)

      if (localSnap == null && baselineSnap != null) {
        // Local removed month — fail closed
        conflicts.push({
          operationId: op.operationId,
          domain: TIMESHEET_CELL_DOMAIN,
          entityId: op.entityId,
          reason: 'domain_conflict',
          message: `Структура месяца ${monthKey}: локальное удаление заблокировано`,
          pendingLocal: null,
          cloudSnapshot: remoteSnap,
          baselineSnapshot: baselineSnap,
        })
        continue
      }

      if (entityFingerprint(remoteSnap) === entityFingerprint(baselineSnap)) {
        if (localSnap && remoteSheet) {
          months[monthKey] = applyStructuralMonthFields(remoteSheet, localSnap)
        } else if (localSnap && !remoteSheet && localMonths[monthKey]) {
          // New month locally — only if remote has no sheet
          months[monthKey] = JSON.parse(JSON.stringify(localMonths[monthKey])) as MonthSheet
        }
        appliedOperationIds.push(op.operationId)
        continue
      }
      if (entityFingerprint(remoteSnap) === entityFingerprint(localSnap)) {
        appliedOperationIds.push(op.operationId)
        continue
      }
      conflicts.push({
        operationId: op.operationId,
        domain: TIMESHEET_CELL_DOMAIN,
        entityId: op.entityId,
        reason: 'domain_conflict',
        message: `Структура месяца ${monthKey}: конфликт — облако сохранено`,
        pendingLocal: localSnap,
        cloudSnapshot: remoteSnap,
        baselineSnapshot: baselineSnap,
      })
    }
  }

  return { months, appliedOperationIds, conflicts }
}
