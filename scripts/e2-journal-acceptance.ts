/**
 * E2 acceptance: roll-call → timesheet journal, warehouse post → warehouse journal + link,
 * finance advance → finance journal (not timesheet).
 *
 * Run: npx tsx scripts/e2-journal-acceptance.ts
 */
import { resolveJournalCategories } from '../src/lib/journals/access.ts'
import { classifyAuditEntry } from '../src/lib/journals/classifyAudit.ts'
import {
  collectJournalEntries,
  countJournalEntriesByCategory,
  filterJournalEntries,
} from '../src/lib/journals/collect.ts'
import { resolveJournalLink } from '../src/lib/journals/navigate.ts'
import type { JournalCategory } from '../src/lib/journals/types.ts'
import { monthKey } from '../src/lib/dates.ts'
import { postWarehouseDocument } from '../src/lib/warehouse/documents.ts'
import { createDefaultStore } from '../src/lib/storage.ts'
import type { AppStore } from '../src/lib/types.ts'
import { createFinanceSlice } from '../src/store/slices/financeSlice.ts'
import { createTimesheetSlice } from '../src/store/slices/timesheetSlice.ts'

type Check = { name: string; ok: boolean; detail?: string }

const checks: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail })
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

function createStoreHarness(initial: AppStore) {
  let store = initial
  const setStore = (action: AppStore | ((s: AppStore) => AppStore)) => {
    store = typeof action === 'function' ? action(store) : action
  }
  const getStore = () => store
  return { getStore, setStore, get store() { return store } }
}

async function main() {
  const month = monthKey(2026, 6)
  const dateKey = `${month}-15`
  let base = createDefaultStore()
  const sheet = base.months[month]
  const row = sheet?.rows.find((r) => r.employeeId)
  if (!row?.employeeId) {
    console.error('E2 setup failed: no employee row in month', month)
    process.exit(1)
  }

  const harness = createStoreHarness(base)
  const timesheet = createTimesheetSlice(harness)
  const finance = createFinanceSlice(harness)

  // 1) Roll-call: mark absent (Перекличка → fact X)
  timesheet.setMark(month, row.id, dateKey, 'fact', 'X')
  const rollAudit = harness.store.auditLog.find((e) => e.action === 'fact_change')
  check(
    'roll-call creates fact_change audit',
    rollAudit != null,
    rollAudit?.detail,
  )
  check(
    'roll-call classified as timesheet',
    rollAudit != null && classifyAuditEntry(rollAudit) === 'timesheet',
  )

  // 2) Warehouse receipt post
  const item = harness.store.warehouse.items[0]
  const loc = harness.store.warehouse.locations[0]
  if (!item || !loc) {
    check('warehouse seed has item + location', false)
  } else {
    const { store: whNext, result } = postWarehouseDocument(harness.store.warehouse, {
      type: 'receipt',
      number: `E2-${Date.now().toString(36)}`,
      date: dateKey,
      locationId: loc.id,
      keeperName: 'E2 Tester',
      lines: [{ itemId: item.id, quantity: 1, unit: item.unit }],
    })
    harness.setStore((s) => ({ ...s, warehouse: whNext }))
    check('warehouse post succeeds', result.ok === true, result.ok ? undefined : result.error)

    const docId = result.ok ? result.documentId : undefined
    const all = collectJournalEntries(harness.store, [
      'warehouse_audit',
      'warehouse_documents',
    ])
    const docEntry = all.find(
      (e) => e.category === 'warehouse_documents' && e.refId === docId,
    )
    const auditEntry = all.find(
      (e) => e.category === 'warehouse_audit' && e.detail.includes('Приход'),
    )
    check('warehouse document in journal', docEntry != null, docEntry?.title)
    check('warehouse audit in journal', auditEntry != null)
    check(
      'warehouse journal link resolves',
      docEntry?.link != null &&
        resolveJournalLink(docEntry.link)?.view === 'warehouse' &&
        resolveJournalLink(docEntry.link)?.view === 'warehouse' &&
        'warehouseDocumentId' in (resolveJournalLink(docEntry.link) ?? {}),
    )
  }

  // 3) Finance advance
  finance.giveAdvance(
    {
      employeeId: row.employeeId,
      month,
      date: dateKey,
      amount: 100,
      method: 'cash',
      note: 'E2 test',
    },
    { name: 'E2 Tester' },
  )
  const advAudit = harness.store.auditLog.find((e) => e.action === 'advance_give')
  check('advance creates advance_give audit', advAudit != null, advAudit?.detail)
  check(
    'advance classified as finance',
    advAudit != null && classifyAuditEntry(advAudit) === 'finance',
  )

  const directorCats = resolveJournalCategories({ roleId: 'operations_director' })
  const entries = collectJournalEntries(harness.store, directorCats)
  const counts = countJournalEntriesByCategory(entries)

  check('finance filter has advance entry', (counts.finance ?? 0) > 0, `count=${counts.finance}`)
  check('timesheet filter has roll-call entry', (counts.timesheet ?? 0) > 0, `count=${counts.timesheet}`)

  const financeOnly = filterJournalEntries(entries, {
    categories: new Set<JournalCategory>(['finance']),
  })
  const timesheetOnly = filterJournalEntries(entries, {
    categories: new Set<JournalCategory>(['timesheet']),
  })

  check(
    'advance visible under Finance chip only',
    financeOnly.some((e) => e.title.includes('аванс') || e.detail.includes('Аванс')),
  )
  check(
    'advance NOT under Timesheet chip',
    !timesheetOnly.some((e) => e.detail.includes('Аванс')),
  )
  check(
    'roll-call visible under Timesheet chip',
    timesheetOnly.some((e) => e.title.includes('факта') || e.detail.includes('→')),
  )

  const masterCats = resolveJournalCategories({ roleId: 'workshop_master' })
  check(
    'workshop_master sees timesheet category',
    masterCats.includes('timesheet'),
  )

  const financeRoleCats = resolveJournalCategories({ roleId: 'finance' })
  check('finance role sees finance category', financeRoleCats.includes('finance'))

  const failed = checks.filter((c) => !c.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`E2 PASSED — ${checks.length} checks`)
    process.exit(0)
  }
  console.error(`E2 FAILED — ${failed.length}/${checks.length}`)
  for (const f of failed) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
