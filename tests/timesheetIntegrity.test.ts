import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import {
  applyTimesheetEntryChanges,
  revertTimesheetEntryApplied,
} from '@/lib/timesheetEntries/apply'
import { timesheetCellState } from '@/lib/timesheetEntries/cellState'
import {
  normalizeTimesheetEntryStore,
  trimTimesheetEntryDocuments,
} from '@/lib/timesheetEntries/init'
import { parseTimesheetDraft, timesheetDraftStorageKey } from '@/lib/timesheetDraftStorage'
import { createTimesheetSlice } from '@/store/slices/timesheetSlice'
import { createSettingsSlice } from '@/store/slices/settingsSlice'
import { mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { brigadeTimesheetFingerprint, isBrigadeTimesheetVerified } from '@/lib/brigadeSignoff'
import { payrollReadiness, payrollReady } from '@/lib/finance/payrollReadiness'
import { nextPunchKind, localDateKey } from '@/lib/attendance/punch'
import { DayCell } from '@/components/month/DayCell'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'
import type { TimesheetEntryChange, TimesheetEntryDocument } from '@/lib/timesheetEntries/types'
import type { AttendancePunch } from '@/lib/attendance/types'

const month = '2026-07',
  date = `${month}-01`,
  key = `r|${date}`
function fixture() {
  const emp = {
    id: 'e',
    fullName: 'Synthetic',
    active: true,
    schedule: '5/2 8ч',
    brigade: 'A',
    monthlySalary: 1840,
  } as Employee
  const sheet: MonthSheet = {
    month,
    rows: [{ id: 'r', employeeId: 'e', brigade: 'A', sortOrder: 0 }],
    plan: { r: { [date]: '8' } },
    fact: { r: { [date]: '8' } },
    factOverrides: [],
    comments: {},
    substitutions: {},
  }
  let store: AppStore = { ...createDefaultStore(), employees: [emp], months: { [month]: sheet } }
  store.access.users.push({
    id: 'u',
    roleId: 'finance',
    active: true,
    displayName: 'Synthetic reviewer',
  } as never)
  const deps = {
    getStore: () => store,
    setStore: (fn: AppStore | ((s: AppStore) => AppStore)) => {
      store = typeof fn === 'function' ? fn(store) : fn
    },
    getActor: () => ({ id: 'u', name: 'Synthetic reviewer' }),
  }
  return {
    get store() {
      return store
    },
    sheet,
    emp,
    ts: createTimesheetSlice(deps),
    settings: createSettingsSlice(deps, { getActiveMonth: () => month, setActiveMonth: () => {} }),
  }
}
function change(
  sheet: MonthSheet,
  patch: Partial<TimesheetEntryChange> = {},
): TimesheetEntryChange {
  return {
    rowId: 'r',
    dateKey: date,
    mode: 'fact',
    before: '8',
    after: '8',
    confirmFact: true,
    expectedEmployeeId: 'e',
    beforeState: timesheetCellState(sheet, 'r', date),
    ...patch,
  }
}

describe('timesheet confirmation and recovery', () => {
  it('posts same-code confirmation as a document and audits it; void restores implicit fact', () => {
    const f = fixture(),
      original = timesheetCellState(f.sheet, 'r', date)
    const result = f.ts.commitTimesheetDraft(month, [change(f.sheet)])
    expect(result.applied).toBe(1)
    expect(f.store.months[month].factOverrides).toContain(key)
    expect(f.store.auditLog.some((a) => a.action === 'fact_change' && a.factConfirmed)).toBe(true)
    const doc = f.store.timesheetEntries!.documents[0]
    expect(doc.applied![0].beforeState).toEqual(original)
    expect(f.ts.voidTimesheetEntry(doc.id)).toBe(true)
    expect(timesheetCellState(f.store.months[month], 'r', date)).toEqual(original)
    expect(f.store.timesheetEntries!.documents[0].status).toBe('void')
  })
  it('restores exact and extra hours after a nonwork code but refuses subsequent hour changes', () => {
    const f = fixture()
    f.sheet.factHoursOverride = { [key]: 6 }
    f.sheet.factExtraHours = { [key]: 1 }
    const original = timesheetCellState(f.sheet, 'r', date)
    const batch = applyTimesheetEntryChanges(
      f.sheet,
      [change(f.sheet, { after: 'ОТ', confirmFact: false })],
      () => true,
    )
    expect(batch.sheet.factHoursOverride![key]).toBeUndefined()
    const reverted = revertTimesheetEntryApplied(batch.sheet, batch.applied)
    expect(timesheetCellState(reverted.sheet, 'r', date)).toEqual(original)
    batch.sheet.factHoursOverride = { [key]: 2 }
    expect(revertTimesheetEntryApplied(batch.sheet, batch.applied).skipped).toBe(1)
  })
  it.each(['identity', 'date', 'bounds', 'hours', 'acl', 'invalid-code'] as const)(
    'rejects %s conflict without a write',
    (kind) => {
      const f = fixture(),
        ch = change(f.sheet)
      if (kind === 'identity') f.sheet.rows[0].employeeId = 'other'
      if (kind === 'date') ch.dateKey = '2026-07-32'
      if (kind === 'bounds') f.sheet.rowBounds = { r: { inactiveFrom: date } }
      if (kind === 'hours') f.sheet.factHoursOverride = { [key]: 4 }
      if (kind === 'invalid-code') ch.after = 'bad' as never
      const before = structuredClone(f.sheet),
        out = applyTimesheetEntryChanges(f.sheet, [ch], () => kind !== 'acl')
      expect(out.skipped).toBe(1)
      expect(out.sheet).toEqual(before)
    },
  )
  it('supports both plan and fact in one batch and restores them in reverse order', () => {
    const f = fixture(),
      original = structuredClone(f.sheet)
    const batch = applyTimesheetEntryChanges(
      f.sheet,
      [
        change(f.sheet, { mode: 'plan', after: '6', confirmFact: false }),
        change(f.sheet, { after: '4', confirmFact: false }),
      ],
      () => true,
    )
    expect(batch.applied).toHaveLength(2)
    expect(batch.sheet.plan.r[date]).toBe('6')
    expect(batch.sheet.fact.r[date]).toBe('4')
    expect(
      timesheetCellState(revertTimesheetEntryApplied(batch.sheet, batch.applied).sheet, 'r', date),
    ).toEqual(timesheetCellState(original, 'r', date))
  })
  it('recovers original comparison state; isolates project, user and month', () => {
    const f = fixture(),
      ch = change(f.sheet),
      raw = JSON.stringify({ version: 1, month, changes: [ch] })
    expect(parseTimesheetDraft(raw, month)).toEqual([ch])
    expect(parseTimesheetDraft(raw, '2026-08')).toEqual([])
    expect(parseTimesheetDraft('{bad', month)).toEqual([])
    const keys = [
      timesheetDraftStorageKey('p', 'u', month),
      timesheetDraftStorageKey('p2', 'u', month),
      timesheetDraftStorageKey('p', 'u2', month),
      timesheetDraftStorageKey('p', 'u', '2026-08'),
    ]
    expect(new Set(keys).size).toBe(4)
    f.sheet.factHoursOverride = { [key]: 2 }
    expect(
      applyTimesheetEntryChanges(f.sheet, parseTimesheetDraft(raw, month), () => true).skipped,
    ).toBe(1)
  })
  it('normalization and trimming keep v2 void evidence', () => {
    const f = fixture()
    f.ts.commitTimesheetDraft(month, [change(f.sheet)])
    f.ts.voidTimesheetEntry(f.store.timesheetEntries!.documents[0].id)
    const normalized = normalizeTimesheetEntryStore(
      JSON.parse(JSON.stringify(f.store.timesheetEntries)),
    )
    expect(normalized.documents[0].applied![0].beforeState?.override).toBe(false)
    const many = Array.from({ length: 2501 }, (_, i) => ({
      ...normalized.documents[0],
      id: String(i),
    }))
    expect(trimTimesheetEntryDocuments(many, new Date('2030-01-01'))).toHaveLength(2501)
  })
})

describe('cloud merge of intentional voids', () => {
  it('does not resurrect confirmation against a stale client, even when own cell audit is later than void timestamp', () => {
    const f = fixture()
    f.ts.commitTimesheetDraft(month, [change(f.sheet)])
    const posted = structuredClone(f.store),
      doc = posted.timesheetEntries!.documents[0]
    let tick = Date.parse('2026-09-12T10:00:00Z')
    const NativeDate = Date
    vi.stubGlobal(
      'Date',
      class extends NativeDate {
        constructor(...args: [] | [string]) {
          super(args.length ? args[0]! : tick++)
        }
        static now() {
          return tick++
        }
      },
    )
    try {
      expect(f.ts.voidTimesheetEntry(doc.id)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(
      f.store.auditLog.find((a) => a.action === 'fact_change')!.at >
        f.store.timesheetEntries!.documents[0].voidedAt!,
    ).toBe(true)
    const restored = timesheetCellState(f.store.months[month], 'r', date)
    expect(restored.override).toBe(false)
    for (const [remote, local] of [
      [posted, f.store],
      [f.store, posted],
    ]) {
      const merged = mergeCloudStores(posted, remote, local).store
      expect(merged.months[month].factOverrides).not.toContain(key)
      expect(merged.timesheetEntries!.documents[0].status).toBe('void')
      expect(timesheetCellState(merged.months[month], 'r', date)).toEqual(restored)
    }
  })
  it('retains ordinary anti-wipe and later edits', () => {
    const f = fixture()
    f.ts.commitTimesheetDraft(month, [change(f.sheet)])
    const posted = structuredClone(f.store),
      wiped = structuredClone(posted)
    wiped.months[month].factOverrides = []
    expect(mergeCloudStores(posted, posted, wiped).store.months[month].factOverrides).toContain(key)
    f.ts.voidTimesheetEntry(posted.timesheetEntries!.documents[0].id)
    const later = structuredClone(posted)
    later.months[month].factHoursOverride = { [key]: 7 }
    expect(
      mergeCloudStores(posted, later, f.store).store.months[month].factHoursOverride![key],
    ).toBe(7)
  })
})

describe('month readiness and review freshness', () => {
  it('blocks inherited plan, drafts and stale review, and permits a confirmed reviewed month', () => {
    const f = fixture()
    expect(payrollReadiness(f.store, month).unconfirmed).toBe(1)
    expect(() => f.settings.setMonthClosed(month, true)).toThrow()
    expect(f.store.finance?.snapshots[month]).toBeUndefined()
    f.ts.commitTimesheetDraft(month, [change(f.sheet)])
    f.ts.setBrigadeSignoff(month, 'A', true)
    expect(payrollReady(payrollReadiness(f.store, month))).toBe(true)
    f.store.timesheetEntries!.documents.push({
      id: 'draft',
      month,
      status: 'draft',
    } as TimesheetEntryDocument)
    expect(payrollReadiness(f.store, month).drafts).toBe(1)
    expect(() => f.settings.setMonthClosed(month, true)).toThrow()
  })
  it.each(['hours', 'employee', 'transfer', 'brigadier', 'bounds'] as const)(
    'invalidates review on %s change',
    (kind) => {
      const f = fixture()
      f.ts.setBrigadeSignoff(month, 'A', true)
      const sheet = f.store.months[month]
      expect(isBrigadeTimesheetVerified(sheet, 'A', f.store)).toBe(true)
      if (kind === 'hours') sheet.factHoursOverride = { [key]: 4 }
      if (kind === 'employee') sheet.rows[0].employeeId = 'other'
      if (kind === 'transfer')
        sheet.dayTransfers = { [`e|${date}`]: { fromRowId: 'r', toRowId: 'other', toBrigade: 'B' } }
      if (kind === 'brigadier') sheet.brigadierDays = { [key]: true }
      if (kind === 'bounds') sheet.rowBounds = { r: { inactiveFrom: '2026-07-15' } }
      expect(isBrigadeTimesheetVerified(sheet, 'A', f.store)).toBe(false)
    },
  )
  it('ignores sort order and distrusts legacy verified-only flags', () => {
    const f = fixture(),
      before = brigadeTimesheetFingerprint(f.sheet, 'A', f.store)
    f.sheet.rows[0].sortOrder = 100
    expect(brigadeTimesheetFingerprint(f.sheet, 'A', f.store)).toBe(before)
    f.sheet.brigadeSignoffs = { A: { verified: true, at: date } }
    expect(isBrigadeTimesheetVerified(f.sheet, 'A', f.store)).toBe(false)
  })
})

describe('overnight attendance and cell selection', () => {
  const p = (at: string, kind: 'in' | 'out' = 'in'): AttendancePunch => ({
    id: at,
    at,
    employeeId: 'e',
    kind,
    method: 'manual',
  })
  it('pairs an overnight exit across dates in plant time', () => {
    const punches = [p('2026-09-11T16:00:00Z')]
    expect(nextPunchKind({ punches }, 'e', '2026-09-12T04:00:00Z')).toBe('out')
    expect(localDateKey('2026-09-11T21:00:00Z')).toBe('2026-09-12')
  })
  it('sorts timestamps and ignores future/invalid punches and stale open entrances', () => {
    expect(
      nextPunchKind(
        {
          punches: [
            p('2026-09-12T04:00:00Z', 'out'),
            p('2026-09-11T16:00:00Z'),
            p('2030-01-01T00:00:00Z'),
            p('bad'),
          ],
        },
        'e',
        '2026-09-12T05:00:00Z',
      ),
    ).toBe('in')
    expect(
      nextPunchKind({ punches: [p('2026-08-01T04:00:00Z')] }, 'e', '2026-09-12T05:00:00Z'),
    ).toBe('in')
  })
  it('updates the rendered cell when only selection changes', () => {
    const compare = (DayCell as unknown as { compare: (a: object, b: object) => boolean }).compare
    expect(compare({ code: '8', selected: false }, { code: '8', selected: true })).toBe(false)
    expect(compare({ code: '8', selected: true }, { code: '8', selected: true })).toBe(true)
  })
})
