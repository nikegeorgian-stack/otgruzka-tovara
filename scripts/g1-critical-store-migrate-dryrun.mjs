#!/usr/bin/env node
/**
 * PHASE G1 — migration dry-run / plan ONLY.
 * No production reads/writes. No real import.
 *
 * Steps (design):
 * 1. read legacy critical roots from a provided local JSON snapshot (never prod)
 * 2. validate structure + invariants
 * 3. compute checksum/counts
 * 4. print preview
 * 5. describe backup/export path
 * 6. describe bootstrap of FstCriticalStore (server-only)
 * 7. re-verify checksum/counts
 * 8. describe read switch (overlay)
 * 9. describe rollback before switch
 *
 * Usage:
 *   node scripts/g1-critical-store-migrate-dryrun.mjs [--fixture path/to/local-store.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  parseCriticalPayload,
  serializeCriticalPayload,
  G1_ALLOWED_DOMAINS,
} from '../server/fst/_g1CriticalHelpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function fail(msg) {
  console.error(`[g1-dryrun] FAIL: ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`[g1-dryrun] ${msg}`)
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

function extractLegacyCriticalRoots(store) {
  return {
    warehouse: store?.warehouse ?? null,
    // Explicitly NOT migrating in G1:
    employees: 'SKIP',
    months: 'SKIP',
    timesheets: 'SKIP',
    // Remaining critical domains (later phases):
    production: store?.production ? 'PRESENT_NOT_MIGRATED' : 'ABSENT',
    formulations: store?.formulations ? 'PRESENT_NOT_MIGRATED' : 'ABSENT',
    packagingRecipes: store?.packagingRecipes ? 'PRESENT_NOT_MIGRATED' : 'ABSENT',
    finishedGoodsLots: store?.finishedGoodsLots ? 'PRESENT_NOT_MIGRATED' : 'ABSENT',
    access: store?.access ? 'PRESENT_NOT_TRUSTED' : 'ABSENT',
  }
}

function warehouseCounts(wh) {
  if (!wh || typeof wh !== 'object') return null
  return {
    items: Array.isArray(wh.items) ? wh.items.length : 0,
    documents: Array.isArray(wh.documents) ? wh.documents.length : 0,
    movements: Array.isArray(wh.movements) ? wh.movements.length : 0,
    auditLog: Array.isArray(wh.auditLog) ? wh.auditLog.length : 0,
    locations: Array.isArray(wh.locations) ? wh.locations.length : 0,
  }
}

function validateWarehouseInvariants(wh) {
  const errors = []
  if (!wh) {
    errors.push('warehouse_missing')
    return errors
  }
  for (const doc of wh.documents ?? []) {
    if (doc.status === 'posted' && !doc.id) errors.push('posted_doc_missing_id')
  }
  for (const m of wh.movements ?? []) {
    if (!m.documentId) errors.push('movement_missing_documentId')
    if (!m.warehouseId || !m.itemId) errors.push('movement_missing_keys')
  }
  return [...new Set(errors)]
}

function buildPreviewPayload(warehouse) {
  const payload = emptyCriticalPayload()
  payload.domains.warehouse = {
    items: warehouse?.items ?? [],
    locations: warehouse?.locations ?? [],
    documents: warehouse?.documents ?? [],
    movements: warehouse?.movements ?? [],
    auditLog: warehouse?.auditLog ?? [],
    counterparties: warehouse?.counterparties ?? [],
  }
  const json = serializeCriticalPayload(payload)
  const parsed = parseCriticalPayload(json)
  return { payload, json, parsed, fingerprint: fingerprintCriticalPayload(json) }
}

function main() {
  ok('PHASE G1 critical-store migration DRY-RUN (no production I/O)')
  ok(`Allowed domains: ${G1_ALLOWED_DOMAINS.join(', ')}`)

  const args = process.argv.slice(2)
  const fixtureIdx = args.indexOf('--fixture')
  const fixturePath =
    fixtureIdx >= 0
      ? path.resolve(args[fixtureIdx + 1] || '')
      : path.join(root, 'scripts', 'fixtures', 'g1-legacy-store.sample.json')

  let store = null
  if (fs.existsSync(fixturePath)) {
    ok(`1. read local fixture: ${fixturePath}`)
    store = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  } else {
    ok('1. no fixture found — using synthetic empty warehouse sample (safe)')
    store = {
      warehouse: {
        items: [{ id: 'item-1', name: 'Sample', unit: 'pcs' }],
        locations: [{ id: 'wh-1', name: 'Main' }],
        documents: [],
        movements: [],
        auditLog: [],
      },
      employees: [{ id: 'emp-should-not-migrate' }],
      months: { '2026-01': {} },
    }
  }

  const roots = extractLegacyCriticalRoots(store)
  ok(`2. critical roots map: ${JSON.stringify(roots, null, 0)}`)

  const inv = validateWarehouseInvariants(store.warehouse)
  if (inv.length) fail(`invariants: ${inv.join(', ')}`)
  else ok('2b. warehouse invariants OK')

  const counts = warehouseCounts(store.warehouse)
  const checksum = sha256(JSON.stringify(store.warehouse ?? {}))
  ok(`3. counts=${JSON.stringify(counts)} checksum=${checksum.slice(0, 16)}…`)

  const preview = buildPreviewPayload(store.warehouse)
  if (!preview.parsed.ok) {
    fail(`preview parse failed: ${preview.parsed.error}`)
    return
  }
  ok(`4. preview fingerprint=${preview.fingerprint} bytes=${preview.json.length}`)
  ok('5. backup/export (PLAN): export FstStore.payloadJson warehouse slice to encrypted file before bootstrap')
  ok('6. bootstrap (PLAN): Admin SDK UpsertFstCriticalStore(id=storeId, revision=1, payloadJson=preview)')
  ok('7. re-verify (PLAN): GetFstCriticalStore → recount + fingerprint match')
  ok('8. read switch (PLAN): client overlay via g1-warehouse-get when revision>0')
  ok('9. rollback (PLAN): before switch — delete/disable FstCriticalStore row OR set revision=0 sentinel; keep FstStore untouched')
  ok('Employees/months/timesheets: NEVER copied into FstCriticalStore')
  ok('DRY-RUN complete — no writes performed')
}

main()
