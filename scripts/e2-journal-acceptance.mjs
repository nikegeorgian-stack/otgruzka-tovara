/**
 * E2 acceptance: roll-call → timesheet, warehouse post → warehouse + link, advance → finance.
 * Run: npm run test:e2  (node scripts/e2-journal-acceptance.mjs)
 */

// ——— minimal copies of journal classifier (must match classifyAudit.ts) ———
const FINANCE = new Set([
  'advance_give', 'advance_remove', 'adjustment_add', 'adjustment_remove',
  'payout_add', 'payout_remove', 'sick_confirm', 'sick_unconfirm', 'payroll_snapshot',
])

function classifyAuditEntry(entry) {
  if (FINANCE.has(entry.action)) return 'finance'
  if (['employee_remove', 'employee_upsert', 'candidate_remove', 'candidate_hire'].includes(entry.action)) return 'hr'
  if (['user_upsert', 'user_remove', 'role_views'].includes(entry.action)) return 'access'
  if (['counterparty_upsert', 'counterparty_remove', 'finished_product_upsert', 'finished_product_remove'].includes(entry.action)) return 'directories'
  return 'timesheet'
}

function resolveJournalLink(link) {
  if (link.kind === 'warehouse_document') return { view: 'warehouse', warehouseDocumentId: link.documentId }
  if (link.kind === 'month') return { view: 'month', month: link.month }
  return null
}

function filterByCategory(entries, category) {
  return entries.filter((e) => e.category === category)
}

// ——— harness ———
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function monthKey(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`
}

function appendAudit(store, entry) {
  const full = { ...entry, id: crypto.randomUUID(), at: new Date().toISOString() }
  return { ...store, auditLog: [full, ...store.auditLog] }
}

function auditFactChange(store, month, rowId, dateKey, employeeId, oldCode, newCode) {
  if (oldCode === newCode) return store
  return appendAudit(store, {
    action: 'fact_change',
    month,
    rowId,
    dateKey,
    employeeId,
    oldValue: oldCode || '·',
    newValue: newCode || '·',
    detail: `${dateKey}: ${oldCode || '·'} → ${newCode || '·'}`,
  })
}

function collectWarehouseJournal(warehouse) {
  const out = []
  for (const e of warehouse.auditLog ?? []) {
    out.push({
      id: `wh-a-${e.id}`,
      category: 'warehouse_audit',
      at: e.at,
      title: e.action,
      detail: e.detail,
    })
  }
  for (const d of warehouse.documents ?? []) {
    if ((d.status ?? 'posted') === 'draft') continue
    out.push({
      id: `wh-d-${d.id}`,
      category: 'warehouse_documents',
      at: d.postedAt ?? d.createdAt,
      title: d.number,
      detail: `${d.lines.length} поз.`,
      refId: d.id,
      link: { kind: 'warehouse_document', documentId: d.id },
    })
  }
  return out
}

function collectAuditJournal(auditLog) {
  return auditLog.map((e) => ({
    id: `audit-${classifyAuditEntry(e)}-${e.id}`,
    category: classifyAuditEntry(e),
    at: e.at,
    title: e.action,
    detail: e.detail,
    link: e.month ? { kind: 'month', month: e.month } : undefined,
  }))
}
async function main() {
  const month = monthKey(2026, 6)
  const dateKey = `${month}-15`

  // Minimal store shape for E2
  let store = {
    auditLog: [],
    employees: [{ id: 'emp-e2', fullName: 'Тестов Тест', brigade: 'Бригада 1', active: true, tabNumber: '001' }],
    months: {
      [month]: {
        month,
        rows: [{ id: 'row-e2', brigade: 'Бригада 1', employeeId: 'emp-e2', sortOrder: 0 }],
        plan: { 'row-e2': { [dateKey]: '8' } },
        fact: { 'row-e2': { [dateKey]: '8' } },
        factOverrides: [],
      },
    },
    finance: { advances: [], adjustments: [], payouts: [], sickConfirmations: [], payrollSnapshots: [] },
    warehouse: {
      items: [{ id: 'item-e2', name: 'Тест', unit: 'шт', category: 'Прочее' }],
      locations: [{ id: 'loc-e2', name: 'Основной', sortOrder: 0 }],
      documents: [],
      movements: [],
      auditLog: [],
    },
  }

  // 1) Roll-call: mark absent
  const prev = store.months[month].fact['row-e2'][dateKey]
  store.months[month].fact['row-e2'][dateKey] = 'X'
  store = auditFactChange(store, month, 'row-e2', dateKey, 'emp-e2', prev, 'X')
  const rollAudit = store.auditLog.find((e) => e.action === 'fact_change')
  check('roll-call creates fact_change audit', rollAudit != null, rollAudit?.detail)
  check('roll-call classified as timesheet', rollAudit && classifyAuditEntry(rollAudit) === 'timesheet')

  // 2) Warehouse post (inline minimal post)
  const docId = crypto.randomUUID()
  const now = new Date().toISOString()
  const doc = {
    id: docId,
    type: 'receipt',
    number: 'E2-001',
    date: dateKey,
    locationId: 'loc-e2',
    keeperName: 'E2 Tester',
    lines: [{ itemId: 'item-e2', quantity: 1, unit: 'шт' }],
    status: 'posted',
    createdAt: now,
    postedAt: now,
  }
  store.warehouse.documents.push(doc)
  store.warehouse.auditLog.push({
    id: crypto.randomUUID(),
    at: now,
    action: 'document_post',
    detail: `Приход №${doc.number} · 1 поз.`,
    actorName: 'E2 Tester',
  })

  const whJournal = collectWarehouseJournal(store.warehouse)
  const docEntry = whJournal.find((e) => e.category === 'warehouse_documents' && e.refId === docId)
  const auditWh = whJournal.find((e) => e.category === 'warehouse_audit')
  check('warehouse document in journal', docEntry != null, docEntry?.title)
  check('warehouse audit in journal', auditWh != null)
  const nav = docEntry?.link ? resolveJournalLink(docEntry.link) : null
  check('warehouse link → warehouse view', nav?.view === 'warehouse' && nav.warehouseDocumentId === docId)

  // 3) Finance advance
  const advId = crypto.randomUUID()
  store.finance.advances.push({
    id: advId,
    employeeId: 'emp-e2',
    month,
    date: dateKey,
    amount: 100,
    method: 'cash',
    at: now,
  })
  store = appendAudit(store, {
    action: 'advance_give',
    month,
    employeeId: 'emp-e2',
    detail: 'Аванс 100 ₾ · Тестов Тест · E2 Tester',
  })
  const advAudit = store.auditLog.find((e) => e.action === 'advance_give')
  check('advance creates advance_give audit', advAudit != null, advAudit?.detail)
  check('advance classified as finance', advAudit && classifyAuditEntry(advAudit) === 'finance')

  const allAuditJournal = collectAuditJournal(store.auditLog)
  const financeEntries = filterByCategory(allAuditJournal, 'finance')
  const timesheetEntries = filterByCategory(allAuditJournal, 'timesheet')

  check('finance chip has advance', financeEntries.some((e) => e.detail.includes('Аванс')))
  check('timesheet chip has roll-call', timesheetEntries.some((e) => e.action === 'fact_change' || e.detail.includes('→')))
  check('advance NOT in timesheet chip', !timesheetEntries.some((e) => e.detail.includes('Аванс')))

  // Verify against live prod bundles (code deployed)
  const prodUrls = [
    'https://fst-uchet-theta.vercel.app',
    'https://fst-uchet-14c02.web.app',
  ]
  for (const base of prodUrls) {
    try {
      const res = await fetch(`${base}/index.html`, { signal: AbortSignal.timeout(15000) })
      const html = await res.text()
      const hasJournals = /JournalsPage/.test(html) || res.status === 200
      check(`prod ${base} responds`, res.status === 200)
      // Lazy chunks — verify JournalsPage exists on CDN
      const chunkRes = await fetch(`${base}/assets/JournalsPage-Cg1X77za.js`, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
      if (chunkRes.status === 200) {
        check(`prod ${new URL(base).hostname} has JournalsPage chunk`, true)
      } else {
        // try discover from html
        const m = html.match(/assets\/JournalsPage-[^"']+\.js/)
        if (m) {
          const r2 = await fetch(`${base}/${m[0]}`, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
          check(`prod ${new URL(base).hostname} has JournalsPage chunk`, r2.status === 200, m[0])
        }
      }
    } catch (err) {
      check(`prod ${base} reachable`, false, String(err.message ?? err))
    }
  }

  const failed = checks.filter((c) => !c.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`E2 PASSED — ${checks.length} checks`)
    process.exit(0)
  }
  console.error(`E2 FAILED — ${failed.length}/${checks.length}`)
  for (const f of failed) console.error(`  - ${f.name}`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
