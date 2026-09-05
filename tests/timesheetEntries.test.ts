import { describe, expect, it } from 'vitest'
import {
  applyTimesheetEntryChanges,
  revertTimesheetEntryApplied,
} from '@/lib/timesheetEntries/apply'
import { collectJournalEntries } from '@/lib/journals/collect'
import { resolveJournalLink } from '@/lib/journals/navigate'
import type { MonthSheet } from '@/lib/types'
import type { TimesheetEntryDocument } from '@/lib/timesheetEntries/types'

function sheetWithCell(opts: {
  rowId: string
  brigade: string
  employeeId: string
  dateKey: string
  plan?: string
  fact?: string
}): MonthSheet {
  const { rowId, brigade, employeeId, dateKey } = opts
  return {
    year: 2026,
    month: 8,
    rows: [{ id: rowId, brigade, employeeId }],
    plan: { [rowId]: { [dateKey]: (opts.plan ?? '') as never } },
    fact: { [rowId]: { [dateKey]: (opts.fact ?? '') as never } },
    factOverrides: opts.fact ? [`${rowId}|${dateKey}`] : [],
    comments: {},
    substitutions: {},
  } as MonthSheet
}

describe('timesheetEntries apply/revert', () => {
  it('applies when current matches before', () => {
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: '',
    })
    const batch = applyTimesheetEntryChanges(
      sheet,
      [{ rowId: 'r1', dateKey: '2026-08-01', mode: 'fact', before: '', after: '8' }],
      () => true,
    )
    expect(batch.applied).toHaveLength(1)
    expect(batch.skipped).toBe(0)
    expect(batch.sheet.fact.r1?.['2026-08-01']).toBe('8')
  })

  it('skips concurrent conflict', () => {
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: 'Я',
    })
    const batch = applyTimesheetEntryChanges(
      sheet,
      [{ rowId: 'r1', dateKey: '2026-08-01', mode: 'fact', before: '', after: '8' }],
      () => true,
    )
    expect(batch.applied).toHaveLength(0)
    expect(batch.skipped).toBe(1)
  })

  it('skips ACL deny', () => {
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: '',
    })
    const batch = applyTimesheetEntryChanges(
      sheet,
      [{ rowId: 'r1', dateKey: '2026-08-01', mode: 'fact', before: '', after: '8' }],
      () => false,
    )
    expect(batch.applied).toHaveLength(0)
    expect(batch.skipped).toBe(1)
  })

  it('reverts full when cells unchanged', () => {
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: '8',
    })
    const reverted = revertTimesheetEntryApplied(sheet, [
      {
        rowId: 'r1',
        dateKey: '2026-08-01',
        mode: 'fact',
        before: '',
        after: '8',
        employeeId: 'e1',
        brigade: 'A',
      },
    ])
    expect(reverted.reverted).toBe(1)
    expect(reverted.skipped).toBe(0)
    expect(reverted.sheet.fact.r1?.['2026-08-01']).toBe('')
  })

  it('partial revert reports skipped', () => {
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: 'Я',
    })
    const reverted = revertTimesheetEntryApplied(sheet, [
      {
        rowId: 'r1',
        dateKey: '2026-08-01',
        mode: 'fact',
        before: '',
        after: '8',
      },
    ])
    expect(reverted.reverted).toBe(0)
    expect(reverted.skipped).toBe(1)
  })

  it('void policy: skipped revert must not flip to void', () => {
    // Mirrors timesheetSlice.voidTimesheetEntry guard
    const applied = [
      {
        rowId: 'r1',
        dateKey: '2026-08-01',
        mode: 'fact' as const,
        before: '' as const,
        after: '8' as const,
      },
    ]
    const sheet = sheetWithCell({
      rowId: 'r1',
      brigade: 'A',
      employeeId: 'e1',
      dateKey: '2026-08-01',
      fact: 'Я',
    })
    const reverted = revertTimesheetEntryApplied(sheet, applied)
    const shouldVoid = reverted.skipped === 0
    expect(shouldVoid).toBe(false)
    expect(reverted.skipped).toBe(1)
  })
})

describe('timesheetEntries journal', () => {
  it('resolveJournalLink opens month with document id', () => {
    const nav = resolveJournalLink({
      kind: 'timesheet_entry_document',
      documentId: 'doc-1',
      month: '2026-08',
    })
    expect(nav).toEqual({
      view: 'month',
      month: '2026-08',
      timesheetEntryDocumentId: 'doc-1',
      mode: 'view',
    })
  })

  it('workshop_master sees only own or brigade-overlap docs', () => {
    const docMine: TimesheetEntryDocument = {
      id: 'd1',
      number: 'ВТ-2026-001',
      status: 'posted',
      month: '2026-08',
      source: 'edit_batch',
      changes: [],
      applied: [
        {
          rowId: 'r1',
          dateKey: '2026-08-01',
          mode: 'fact',
          before: '',
          after: '8',
          brigade: 'Бригада 1',
        },
      ],
      createdAt: '2026-08-01T10:00:00.000Z',
      createdBy: 'u-me',
      postedAt: '2026-08-01T10:00:00.000Z',
      postedBy: 'u-me',
    }
    const docPeer: TimesheetEntryDocument = {
      ...docMine,
      id: 'd2',
      number: 'ВТ-2026-002',
      createdBy: 'u-peer',
      postedBy: 'u-peer',
      applied: [
        {
          rowId: 'r2',
          dateKey: '2026-08-01',
          mode: 'fact',
          before: '',
          after: '8',
          brigade: 'Чужая',
        },
      ],
    }
    const store = {
      settings: { locale: 'ru' },
      auditLog: [],
      access: { users: [], workshopMasterCoverages: [] },
      nightShifts: { documents: [] },
      timesheetEntries: { documents: [docMine, docPeer] },
    } as never

    const entries = collectJournalEntries(store, ['timesheet'], {
      viewerUserId: 'u-me',
      viewerRoleId: 'workshop_master',
      viewerBrigades: ['Бригада 1'],
    })
    const ids = entries.filter((e) => e.entryKind === 'document').map((e) => e.refId)
    expect(ids).toContain('d1')
    expect(ids).not.toContain('d2')
  })
})
