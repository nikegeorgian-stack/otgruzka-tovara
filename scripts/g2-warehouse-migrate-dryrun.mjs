#!/usr/bin/env node
/**
 * PHASE G2 — dry-run migration / cutover plan ONLY.
 * No production reads/writes. Extends G1 dry-run for full warehouse lifecycle.
 *
 * Order (design):
 * 1. schema deploy (FstCriticalStore / FstPrincipalAccess / FstCommandReceipt) — NOT executed here
 * 2. API deploy (g1-* + g2-warehouse-command) — NOT executed here
 * 3. bootstrap critical warehouse from legacy snapshot (checksums) — dry-run only
 * 4. grant FstPrincipalAccess capabilities (sysadmin) — NOT executed here
 * 5. read switch (overlay when revision>0) — already in FstSqlConnectSync
 * 6. write switch (web VITE_FST_WEB uses g2 client) — local code path
 * 7. rollback: stop using overlay / disable web authoritative path; legacy FstStore untouched
 *
 * Usage:
 *   node scripts/g2-warehouse-migrate-dryrun.mjs [--fixture path/to/local-store.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  parseCriticalPayload,
  serializeCriticalPayload,
} from '../api/fst/_g1CriticalHelpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function ok(msg) {
  console.log(`[g2-dryrun] OK: ${msg}`)
}

function fail(msg) {
  console.error(`[g2-dryrun] FAIL: ${msg}`)
  process.exitCode = 1
}

const args = process.argv.slice(2)
const fixtureIdx = args.indexOf('--fixture')
const fixture =
  fixtureIdx >= 0
    ? path.resolve(args[fixtureIdx + 1] ?? '')
    : path.join(root, 'scripts/fixtures/g2-warehouse-demo.json')

ok('G2 cutover plan (no production I/O)')
ok('schema → API → bootstrap critical → grant access → read overlay → write switch')
ok('rollback keeps legacy FstStore; set criticalRevision=0 / disable web authoritative path')

if (!fs.existsSync(fixture)) {
  ok(`no fixture at ${fixture}; printing empty critical preview only`)
  const payload = emptyCriticalPayload()
  const json = serializeCriticalPayload(payload)
  console.log(JSON.stringify({
    revision: 1,
    fingerprint: fingerprintCriticalPayload(json),
    documents: 0,
    movements: 0,
    closedMonths: 0,
  }, null, 2))
  process.exit(process.exitCode ?? 0)
}

const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'))
const warehouse = raw.warehouse ?? raw
const critical = emptyCriticalPayload()
critical.domains.warehouse = {
  ...critical.domains.warehouse,
  items: warehouse.items ?? [],
  locations: warehouse.locations ?? [],
  categories: warehouse.categories ?? [],
  documents: warehouse.documents ?? [],
  movements: warehouse.movements ?? [],
  auditLog: warehouse.auditLog ?? [],
  closedMonths: warehouse.closedMonths ?? [],
  periodHistory: warehouse.periodHistory ?? [],
  accountingByWarehouse: warehouse.accountingByWarehouse ?? [],
  dailyIssueSessions: warehouse.dailyIssueSessions ?? [],
}
const parsed = parseCriticalPayload(serializeCriticalPayload(critical))
if (!parsed.ok) fail(parsed.error)
else {
  const wh = parsed.payload.domains.warehouse
  console.log(JSON.stringify({
    documents: wh.documents.length,
    movements: wh.movements.length,
    closedMonths: wh.closedMonths.length,
    accountingRows: wh.accountingByWarehouse.length,
    fingerprint: fingerprintCriticalPayload(serializeCriticalPayload(parsed.payload)),
  }, null, 2))
  ok('fixture parsed into critical warehouse domains')
}
