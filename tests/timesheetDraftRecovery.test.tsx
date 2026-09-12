// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useTimesheetDraftSession } from '@/hooks/useTimesheetDraftSession'
import { timesheetDraftStorageKey } from '@/lib/timesheetDraftStorage'
import { applyTimesheetEntryChanges } from '@/lib/timesheetEntries/apply'
import type { MonthSheet } from '@/lib/types'

const month = '2026-07',
  date = month + '-01'
const key = timesheetDraftStorageKey('preview', 'synthetic', month)
const sheet: MonthSheet = {
  month,
  rows: [{ id: 'r', employeeId: 'e', brigade: 'A', sortOrder: 0 }],
  plan: { r: { [date]: '8' } },
  fact: { r: { [date]: '8' } },
  factOverrides: [],
  comments: {},
  substitutions: {},
}
let root: Root, host: HTMLDivElement, session: ReturnType<typeof useTimesheetDraftSession>
function Harness({ storageKey = key, data = sheet, monthKey = month }) {
  const draft = useTimesheetDraftSession(data, storageKey, monthKey)
  useLayoutEffect(() => { session = draft }, [draft])
  return createElement(
    'div',
    null,
    `draft:${draft.changes.length}; error:${draft.storageError}`,
  )
}
async function render(storageKey = key, data = sheet, monthKey = month) {
  await act(async () => {
    root.render(createElement(Harness, { storageKey, data, monthKey }))
  })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('actual React draft lifecycle', () => {
  it('recovers same-code confirmation after unmount/remount without posting it', async () => {
    await render()
    await act(async () => session.record('r', date, 'fact', '8', true))
    expect(host.textContent).toContain('draft:1')
    expect(sheet.factOverrides).toEqual([])
    await act(async () => root.unmount())
    root = createRoot(host)
    await render()
    expect(session.changes[0].confirmFact).toBe(true)
    expect(sheet.factOverrides).toEqual([])
    expect(applyTimesheetEntryChanges(sheet, session.changes, () => true).applied).toHaveLength(1)
    await act(async () => session.clear())
    expect(localStorage.getItem(key)).toBeNull()
  })
  it('isolates users and months without overwriting the original session', async () => {
    await render()
    await act(async () => session.record('r', date, 'fact', '4'))
    await render(timesheetDraftStorageKey('preview', 'other', month))
    expect(session.hasChanges).toBe(false)
    await render(
      timesheetDraftStorageKey('preview', 'synthetic', '2026-08'),
      { ...sheet, month: '2026-08' },
      '2026-08',
    )
    expect(session.hasChanges).toBe(false)
    await render()
    expect(session.changes[0].after).toBe('4')
  })
  it('keeps the original employee and hours for conflict checks after store refresh', async () => {
    await render()
    await act(async () => session.record('r', date, 'fact', '4'))
    const refreshed = {
      ...sheet,
      rows: [{ ...sheet.rows[0], employeeId: 'new-person' }],
      factHoursOverride: { [`r|${date}`]: 6 },
    }
    await render(key, refreshed)
    expect(session.changes[0].expectedEmployeeId).toBe('e')
    expect(session.changes[0].beforeState?.hoursOverride).toBeUndefined()
    expect(applyTimesheetEntryChanges(refreshed, session.changes, () => true).skipped).toBe(1)
    await act(async () => session.clear())
    expect(session.displaySheet?.factHoursOverride![`r|${date}`]).toBe(6)
  })
  it('warns on unload and reports storage failure without losing in-memory proposals', async () => {
    await render()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await act(async () => session.record('r', date, 'fact', '4'))
    expect(session.storageError).toBe(true)
    expect(session.changes).toHaveLength(1)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
})
