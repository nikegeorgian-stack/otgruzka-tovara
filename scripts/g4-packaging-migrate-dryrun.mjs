/**
 * PHASE G4 — dry-run migration inventory for packaging / FG lots / QC / shipments.
 *
 * READ-ONLY and OFFLINE. This script never touches Firebase, SQL Connect or any
 * remote credential; it only reads local JSON files that are handed to it and
 * counts code references. Nothing is written anywhere.
 *
 * Usage:
 *   node scripts/g4-packaging-migrate-dryrun.mjs
 *   node scripts/g4-packaging-migrate-dryrun.mjs --input path/to/store-export.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function log(msg = '') {
  process.stdout.write(`[g4-dryrun] ${msg}\n`)
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
  for (const candidate of ['data/example-tabel.json', 'data/g4-packaging-sample.json']) {
    const full = path.join(root, candidate)
    if (fs.existsSync(full)) out.push(full)
  }
  return [...new Set(out)]
}

function countMatches(dir, pattern) {
  let n = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
        stack.push(full)
      } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        const m = text.match(pattern)
        if (m) n += m.length
      }
    }
  }
  return n
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function pickStore(raw) {
  // Accept either a raw AppStore, a { store } wrapper, or an FstCriticalStore payload.
  if (!raw || typeof raw !== 'object') return null
  if (raw.domains && typeof raw.domains === 'object') {
    return {
      shape: 'fst_critical_payload',
      production: raw.domains.production ?? {},
      warehouse: raw.domains.warehouse ?? {},
    }
  }
  const store = raw.store && typeof raw.store === 'object' ? raw.store : raw
  if (!store.production && !store.warehouse) return null
  return { shape: 'legacy_app_store', production: store.production ?? {}, warehouse: store.warehouse ?? {} }
}

function emptyReport() {
  return {
    legacyPackagingReports: 0,
    packagingReportsByStatus: {},
    finishedGoodsLots: 0,
    qcStatusHistogram: {},
    qcAttachments: 0,
    loadingShipments: 0,
    loadingShipmentsByStatus: {},
    missingStableIds: 0,
    missingStableIdSamples: [],
    duplicateLotNumbers: 0,
    duplicateLotNumberSamples: [],
    shippedRemainingInconsistencies: 0,
    shippedRemainingSamples: [],
    lotsWithoutServerDecision: 0,
    shipmentLinesWithoutLotId: 0,
  }
}

function inspect(store) {
  const report = emptyReport()
  const production = store.production ?? {}
  const warehouse = store.warehouse ?? {}

  const packagingReports = asArray(production.packagingReports)
  report.legacyPackagingReports = packagingReports.length
  for (const item of packagingReports) {
    const status = String(item?.status ?? 'unknown')
    report.packagingReportsByStatus[status] = (report.packagingReportsByStatus[status] ?? 0) + 1
    if (!String(item?.id ?? '').trim()) {
      report.missingStableIds++
      if (report.missingStableIdSamples.length < 5) {
        report.missingStableIdSamples.push(`packagingReport number=${item?.number ?? '?'}`)
      }
    }
  }

  const lots = asArray(production.finishedGoodsLots)
  report.finishedGoodsLots = lots.length
  const seenLotNumbers = new Map()
  for (const lot of lots) {
    const status = String(lot?.qcStatus ?? 'unknown')
    report.qcStatusHistogram[status] = (report.qcStatusHistogram[status] ?? 0) + 1

    if (!String(lot?.id ?? '').trim()) {
      report.missingStableIds++
      if (report.missingStableIdSamples.length < 5) {
        report.missingStableIdSamples.push(`finishedGoodsLot batchNo=${lot?.batchNo ?? '?'}`)
      }
    }

    const lotNumber = String(lot?.batchNo ?? lot?.lotNumber ?? '').trim()
    if (lotNumber) {
      const prev = seenLotNumbers.get(lotNumber) ?? 0
      seenLotNumbers.set(lotNumber, prev + 1)
      if (prev === 1) {
        report.duplicateLotNumbers++
        if (report.duplicateLotNumberSamples.length < 5) {
          report.duplicateLotNumberSamples.push(lotNumber)
        }
      }
    }

    const released = Number(lot?.quantityQcReleased) || 0
    const shipped = Number(lot?.quantityShipped) || 0
    const remaining = Number(lot?.quantityRemaining) || 0
    const produced = Number(lot?.quantityProduced) || 0
    const expectedRemaining = Math.max(0, released - shipped)
    const inconsistent =
      Math.abs(expectedRemaining - remaining) > 1e-6 ||
      shipped > produced + 1e-6 ||
      shipped > released + 1e-6
    if (inconsistent) {
      report.shippedRemainingInconsistencies++
      if (report.shippedRemainingSamples.length < 5) {
        report.shippedRemainingSamples.push(
          `${lotNumber || lot?.id || '?'}: produced=${produced} released=${released} shipped=${shipped} remaining=${remaining}`,
        )
      }
    }

    if (String(lot?.qcStatus ?? '') === 'released' && !String(lot?.serverQcDecisionId ?? '').trim()) {
      report.lotsWithoutServerDecision++
    }
  }

  report.qcAttachments = asArray(production.qcAttachments).length

  const shipments = asArray(warehouse.loadingShipments)
  report.loadingShipments = shipments.length
  for (const shipment of shipments) {
    const status = String(shipment?.status ?? 'unknown')
    report.loadingShipmentsByStatus[status] = (report.loadingShipmentsByStatus[status] ?? 0) + 1
    if (!String(shipment?.id ?? '').trim()) {
      report.missingStableIds++
      if (report.missingStableIdSamples.length < 5) {
        report.missingStableIdSamples.push(`loadingShipment number=${shipment?.number ?? '?'}`)
      }
    }
    for (const line of asArray(shipment?.lines)) {
      if (!String(line?.lotId ?? '').trim()) report.shipmentLinesWithoutLotId++
    }
  }

  return report
}

function printReport(label, report) {
  log(`source: ${label}`)
  log(`  legacy packaging reports .......... ${report.legacyPackagingReports}`)
  log(`    by status ...................... ${JSON.stringify(report.packagingReportsByStatus)}`)
  log(`  finished goods lots .............. ${report.finishedGoodsLots}`)
  log(`    qc status histogram ............ ${JSON.stringify(report.qcStatusHistogram)}`)
  log(`    released without server decision  ${report.lotsWithoutServerDecision}`)
  log(`  qc attachments ................... ${report.qcAttachments}`)
  log(`  loading shipments ................ ${report.loadingShipments}`)
  log(`    by status ...................... ${JSON.stringify(report.loadingShipmentsByStatus)}`)
  log(`    lines without lotId ............ ${report.shipmentLinesWithoutLotId}`)
  log(`  missing stable ids ............... ${report.missingStableIds}`)
  if (report.missingStableIdSamples.length) {
    log(`    samples ........................ ${report.missingStableIdSamples.join(' | ')}`)
  }
  log(`  duplicate lot numbers ............ ${report.duplicateLotNumbers}`)
  if (report.duplicateLotNumberSamples.length) {
    log(`    samples ........................ ${report.duplicateLotNumberSamples.join(' | ')}`)
  }
  log(`  shipped/remaining inconsistencies  ${report.shippedRemainingInconsistencies}`)
  if (report.shippedRemainingSamples.length) {
    for (const sample of report.shippedRemainingSamples) log(`    ${sample}`)
  }
  log()
}

// ---------------------------------------------------------------------------

log('PHASE G4 dry-run — packaging / FG lots / QC / shipments')
log('NO production Firebase, SQL Connect or Storage access; nothing is written.')
log()

log('Code reference inventory (src/ only):')
log(`  packagingReports ................. ${countMatches(path.join(root, 'src'), /packagingReports/g)}`)
log(`  finishedGoodsLots ................ ${countMatches(path.join(root, 'src'), /finishedGoodsLots/g)}`)
log(`  qcAttachments .................... ${countMatches(path.join(root, 'src'), /qcAttachments/g)}`)
log(`  qcStatus ......................... ${countMatches(path.join(root, 'src'), /qcStatus/g)}`)
log(`  loadingShipments ................. ${countMatches(path.join(root, 'src'), /loadingShipments/g)}`)
log(`  serverQcDecisionId ............... ${countMatches(path.join(root, 'src'), /serverQcDecisionId/g)}`)
log()

const inputs = readInputPaths()
if (inputs.length === 0) {
  log('No local JSON sample supplied (--input <file>) and no data/*.json sample present.')
  log('Planned counts structure that a real export would fill in:')
  printReport('<none — structure preview>', emptyReport())
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
    const store = pickStore(parsed)
    if (!store) {
      log(`source: ${path.relative(root, file)} — SKIPPED (no production/warehouse roots)`)
      log()
      continue
    }
    inspected++
    printReport(`${path.relative(root, file)} [${store.shape}]`, inspect(store))
  }
  if (inspected === 0) {
    log('No supplied file carried a store shape. Planned counts structure:')
    printReport('<none — structure preview>', emptyReport())
  }
}

log('Bootstrap plan (explicit, never automatic):')
log('  1. Export legacy AppStore production.packagingReports / finishedGoodsLots / qcAttachments')
log('     and warehouse.loadingShipments from a controlled backup (not from a live pull)')
log('  2. Reject records without a stable id, without warehouseItemId, or with a duplicate lot number')
log('  3. Re-derive quantityRemaining = quantityQcReleased − quantityShipped; never trust the export')
log('  4. Drop client qcStatus=released that has no matching QcLotDecision; import such lots as pending')
log('  5. Upsert into FstCriticalStore.domains.production (+ warehouse.loadingShipments) via admin CAS')
log('  6. Only then run packaging.domain.activate; production.domain.activate must already be true')
log('  7. Rollback: clear domainMeta.production.features.packagingQc.active — legacy stays readable')
log()
log('Out of scope: employees/months/timesheets, procurement, sales, finance')
log('DRY-RUN COMPLETE — no writes performed')
process.exitCode = 0
