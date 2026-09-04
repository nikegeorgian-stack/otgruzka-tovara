/**
 * PHASE G4.1 — dry-run mapping of legacy QcPermission rows → FstPrincipalAccess.
 *
 * READ-ONLY and OFFLINE. This script never contacts Firebase, SQL Connect or
 * Storage, never reads a credential and never writes anything. It only parses
 * local JSON files handed to it on the command line and prints the capability
 * set each legacy row would produce.
 *
 * After G4.1 `FstPrincipalAccess.capabilitiesJson` is the only ACL the server
 * reads once `domainMeta.production.features.packagingQc.active` is true;
 * `QcPermission` becomes a deprecated projection. This inventory is what an
 * operator reviews before granting the real capabilities by hand.
 *
 * Usage:
 *   node scripts/g41-qcpermission-migrate-dryrun.mjs
 *   node scripts/g41-qcpermission-migrate-dryrun.mjs --input path/to/qc-permissions.json
 *
 * Accepted input shapes:
 *   [ { firebaseUid, storeId, active, canView, ... } ]
 *   { qcPermissions: [ ... ] }
 *   { data: { qcPermissions: [ ... ] } }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** Kept in sync with `QC_PERMISSION_TO_G4` in `api/fst/_g4Capabilities.mjs`. */
const QC_PERMISSION_TO_G4 = Object.freeze({
  canView: 'packaging.read',
  canUpload: 'qc.attachment.upload',
  canRelease: 'qc.release',
  canRegrade: 'qc.regrade',
  canReject: 'qc.reject',
  canPostShipment: 'shipment.post',
})

/** Capabilities that exist only in G4 and therefore need an explicit human grant. */
const G4_ONLY_CAPS = Object.freeze([
  'packaging.report.edit',
  'packaging.report.confirm',
  'packaging.report.correct',
  'qc.review',
  'qc.scrap.writeoff',
  'shipment.draft.edit',
  'shipment.cancel',
])

function log(msg = '') {
  process.stdout.write(`[g41-acl-dryrun] ${msg}\n`)
}

function readInputPaths() {
  const out = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--input' || argv[i] === '-i') && argv[i + 1]) {
      out.push(path.resolve(root, argv[++i]))
    }
  }
  // Local sample shapes only — never a production export path.
  for (const candidate of ['data/g41-qc-permissions-sample.json', 'data/qc-permissions-sample.json']) {
    const full = path.join(root, candidate)
    if (fs.existsSync(full)) out.push(full)
  }
  return [...new Set(out)]
}

function pickRows(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return null
  if (Array.isArray(raw.qcPermissions)) return raw.qcPermissions
  if (Array.isArray(raw.data?.qcPermissions)) return raw.data.qcPermissions
  if (Array.isArray(raw.rows)) return raw.rows
  return null
}

function principalAccessId(storeId, uid) {
  return `${String(storeId ?? '').trim()}::${String(uid ?? '').trim()}`
}

/**
 * Same rule as `flagsToG4Caps` in `_qcService.mjs`: only flags that are literally
 * `true` map to a capability. `canView !== false` defaulting is deliberately NOT
 * reproduced here — a migration must never widen access.
 */
function mapRow(row) {
  const storeId = String(row?.storeId ?? '').trim()
  const firebaseUid = String(row?.firebaseUid ?? row?.uid ?? '').trim()
  const active = row?.active !== false
  const capabilities = {}
  const grantedFlags = []
  for (const [flag, cap] of Object.entries(QC_PERMISSION_TO_G4)) {
    const granted = row?.[flag] === true
    capabilities[cap] = granted
    if (granted) grantedFlags.push(flag)
  }
  const problems = []
  if (!storeId) problems.push('missing storeId')
  if (!firebaseUid) problems.push('missing firebaseUid')
  if (!active) problems.push('revoked row — do not migrate')
  if (active && grantedFlags.length === 0) problems.push('no mappable flag — nothing to grant')
  for (const key of Object.keys(row ?? {})) {
    if (key.startsWith('can') && !(key in QC_PERMISSION_TO_G4)) {
      problems.push(`unmapped legacy flag ${key}`)
    }
  }
  return {
    id: principalAccessId(storeId, firebaseUid),
    storeId,
    firebaseUid,
    active,
    grantedFlags,
    capabilities,
    problems,
  }
}

function summarize(mapped) {
  const summary = {
    rows: mapped.length,
    migratable: 0,
    skipped: 0,
    duplicates: 0,
    byStore: {},
    capabilityHistogram: {},
    problems: [],
  }
  const seen = new Set()
  for (const row of mapped) {
    const blocking = row.problems.some(
      (p) => p.startsWith('missing') || p.startsWith('revoked') || p.startsWith('no mappable'),
    )
    if (row.id !== '::' && seen.has(row.id)) {
      summary.duplicates++
      row.problems.push('duplicate storeId::uid')
    }
    seen.add(row.id)

    if (blocking) summary.skipped++
    else summary.migratable++

    if (row.storeId) {
      summary.byStore[row.storeId] = (summary.byStore[row.storeId] ?? 0) + 1
    }
    for (const [cap, granted] of Object.entries(row.capabilities)) {
      if (granted) summary.capabilityHistogram[cap] = (summary.capabilityHistogram[cap] ?? 0) + 1
    }
    for (const problem of row.problems) {
      summary.problems.push(`${row.id || '<no id>'}: ${problem}`)
    }
  }
  return summary
}

function printMapped(label, mapped) {
  const summary = summarize(mapped)
  log(`source: ${label}`)
  log(`  legacy QcPermission rows ......... ${summary.rows}`)
  log(`  would grant a principal .......... ${summary.migratable}`)
  log(`  skipped (revoked / invalid) ...... ${summary.skipped}`)
  log(`  duplicate storeId::uid ........... ${summary.duplicates}`)
  log(`  rows by store .................... ${JSON.stringify(summary.byStore)}`)
  log(`  capability histogram ............. ${JSON.stringify(summary.capabilityHistogram)}`)
  if (summary.problems.length) {
    log('  review before granting:')
    for (const problem of summary.problems.slice(0, 20)) log(`    - ${problem}`)
    if (summary.problems.length > 20) {
      log(`    ... and ${summary.problems.length - 20} more`)
    }
  }
  const preview = mapped
    .filter((row) => row.active && row.storeId && row.firebaseUid && row.grantedFlags.length > 0)
    .slice(0, 5)
  if (preview.length) {
    log('  planned FstPrincipalAccess rows (first 5, nothing is written):')
    for (const row of preview) {
      const caps = Object.entries(row.capabilities)
        .filter(([, granted]) => granted)
        .map(([cap]) => cap)
      log(`    ${row.id} → ${JSON.stringify(caps)}`)
    }
  }
  log()
}

function samplePreview() {
  // Illustrative in-memory rows so the report shape is visible without any input.
  return [
    { storeId: 'example-store', firebaseUid: 'uid-viewer', active: true, canView: true },
    {
      storeId: 'example-store',
      firebaseUid: 'uid-qc',
      active: true,
      canView: true,
      canUpload: true,
      canRelease: true,
    },
    {
      storeId: 'example-store',
      firebaseUid: 'uid-revoked',
      active: false,
      canView: true,
      canRelease: true,
    },
  ]
}

// ---------------------------------------------------------------------------

log('PHASE G4.1 dry-run — QcPermission → FstPrincipalAccess capability mapping')
log('NO Firebase / SQL Connect / Storage access; nothing is written anywhere.')
log()

log('Flag mapping:')
for (const [flag, cap] of Object.entries(QC_PERMISSION_TO_G4)) {
  log(`  ${flag.padEnd(16)} → ${cap}`)
}
log()
log('G4 capabilities with NO legacy equivalent (must be granted explicitly):')
for (const cap of G4_ONLY_CAPS) log(`  ${cap}`)
log()

const inputs = readInputPaths()
if (inputs.length === 0) {
  log('No local JSON supplied (--input <file>) and no data/*qc-permissions*.json sample present.')
  log('Showing the report shape against an illustrative in-memory sample:')
  printMapped('<none — illustrative sample>', samplePreview().map(mapRow))
} else {
  let inspected = 0
  for (const file of inputs) {
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    } catch (err) {
      log(`source: ${path.relative(root, file)} — SKIPPED (unreadable JSON: ${err?.message ?? err})`)
      log()
      continue
    }
    const rows = pickRows(parsed)
    if (!rows) {
      log(`source: ${path.relative(root, file)} — SKIPPED (no qcPermissions array)`)
      log()
      continue
    }
    inspected++
    printMapped(path.relative(root, file), rows.map(mapRow))
  }
  if (inspected === 0) {
    log('No supplied file carried a qcPermissions array. Showing the report shape:')
    printMapped('<none — illustrative sample>', samplePreview().map(mapRow))
  }
}

log('Cut-over plan (every step explicit, never automatic):')
log('  1. Export QcPermission from a controlled backup — not from a live production pull')
log('  2. Run this dry-run and review every "review before granting" line with the QC owner')
log('  3. Grant FstPrincipalAccess capabilities per user via the admin endpoint')
log('     (qc-permissions-admin writes the principal as canonical + the QcPermission projection)')
log('  4. Verify with requireActivePermission / requireG4Capability that each uid resolves')
log('  5. Only then run packaging.domain.activate — from that moment QcPermission grants nothing')
log('  6. Rollback: clear domainMeta.production.features.packagingQc.active; the legacy')
log('     QcPermission path becomes authoritative again, so do not delete those rows yet')
log()
log('Out of scope: AppStore roleId / roleViews / webViews — never an ACL source for G4')
log('DRY-RUN COMPLETE — no writes performed')
process.exitCode = 0
