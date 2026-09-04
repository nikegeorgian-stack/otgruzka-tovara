/**
 * PHASE G5 — offline dry-run: print activation/domain inventory for a critical payload.
 * No Firebase / SQL I/O. Does not mutate production data.
 *
 * Usage: node scripts/g5-sales-mrp-migrate-dryrun.mjs [path-to-payload.json]
 */
import { readFileSync } from 'node:fs'
import {
  emptyCriticalPayload,
  isMasterDataDomainActive,
  isPackagingQcFeatureActive,
  isProcurementDomainActive,
  isProductionDomainActive,
  isSalesPlanningActive,
  isWarehouseDomainActive,
  parseCriticalPayload,
  G1_ALLOWED_DOMAINS,
} from '../api/fst/_g1CriticalHelpers.mjs'

const path = process.argv[2]
let raw = emptyCriticalPayload()
let revision = 0
if (path) {
  const file = JSON.parse(readFileSync(path, 'utf8'))
  revision = Number(file.revision) || 0
  const parsed = parseCriticalPayload(file.payloadJson ?? file, { revision })
  if (!parsed.ok) {
    console.error('parse_failed', parsed.error)
    process.exit(1)
  }
  raw = parsed.payload
}

const md = raw.domains.masterData ?? {}
const items = md.items ?? []
const products = md.finishedProducts ?? []
const suppliers = md.suppliers ?? []
const customers = md.customers ?? []
const boms = md.packagingBoms ?? []

function duplicateCodes(rows) {
  const seen = new Map()
  const dups = []
  for (const row of rows) {
    const code = String(row.code ?? '')
      .trim()
      .toUpperCase()
    if (!code) continue
    if (seen.has(code)) dups.push({ code, id: row.id, otherId: seen.get(code) })
    else seen.set(code, row.id)
  }
  return dups
}

function nameOnlyWarnings(rows, kind) {
  return rows
    .filter((r) => String(r.name ?? '').trim() && !String(r.code ?? '').trim())
    .map((r) => ({ kind, id: r.id, name: r.name }))
}

const productsMissingBom = products.filter((p) => {
  if (p.archived === true) return false
  const bomId = p.packagingBomId
  if (!bomId) return true
  return !boms.some((b) => b.id === bomId && b.archived !== true)
})

const itemsMissingMoq = items.filter(
  (i) => i.archived !== true && (i.moq == null || !(Number(i.moq) > 0)),
)

const activation = {
  warehouse: isWarehouseDomainActive(raw, revision),
  production: isProductionDomainActive(raw, revision),
  packagingQc: isPackagingQcFeatureActive(raw),
  masterData: isMasterDataDomainActive(raw),
  salesPlanning: isSalesPlanningActive(raw),
  procurement: isProcurementDomainActive(raw),
}

const activationOrderWarnings = []
if (activation.salesPlanning && !activation.masterData) {
  activationOrderWarnings.push('salesPlanning_active_without_masterData')
}
if (activation.procurement && !activation.masterData) {
  activationOrderWarnings.push('procurement_active_without_masterData')
}
if (activation.procurement && !activation.warehouse) {
  activationOrderWarnings.push('procurement_active_without_warehouse')
}
if (activation.salesPlanning && !activation.warehouse) {
  activationOrderWarnings.push('salesPlanning_active_without_warehouse_for_shipments')
}

const report = {
  allowedDomains: [...G1_ALLOWED_DOMAINS],
  revision,
  activation,
  activationOrderWarnings,
  counts: {
    masterDataItems: items.length,
    products: products.length,
    suppliers: suppliers.length,
    customers: customers.length,
    packagingBoms: boms.length,
    salesOrders: raw.domains.sales?.orders?.length ?? 0,
    planningRuns: raw.domains.planning?.planningRuns?.length ?? 0,
    shortages: raw.domains.planning?.shortages?.length ?? 0,
    procurementOrders: raw.domains.procurement?.orders?.length ?? 0,
  },
  checks: {
    duplicateItemCodes: duplicateCodes(items),
    duplicateProductCodes: duplicateCodes(products),
    duplicateSupplierCodes: duplicateCodes(suppliers),
    duplicateCustomerCodes: duplicateCodes(customers),
    nameOnlyWarnings: [
      ...nameOnlyWarnings(items, 'item'),
      ...nameOnlyWarnings(products, 'product'),
      ...nameOnlyWarnings(suppliers, 'supplier'),
      ...nameOnlyWarnings(customers, 'customer'),
    ],
    productsMissingBom: productsMissingBom.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    itemsMissingMoq: itemsMissingMoq.map((i) => ({ id: i.id, code: i.code, name: i.name })),
  },
  notes: [
    'Empty domain ≠ authoritative without active marker.',
    'Warehouse/production/packaging active does NOT activate G5.',
    'Bootstrap only via explicit *.domain.activate commands.',
    'Recommended activation order: warehouse → masterData → salesPlanning → procurement.',
    'Capacity м²/shift is G6 — not calculated.',
  ],
  g52Checks: {
    useG5GatewayWhenProcurementActive: activation.procurement
      ? 'G2 purpose=purchase must return use_g5_gateway'
      : 'n/a (procurement inactive)',
    useG5GatewayWhenSalesPlanningActive: activation.salesPlanning
      ? 'G4 shipment.post must return use_g5_gateway'
      : 'n/a (salesPlanning inactive)',
    stalePlanningRun: 'generateDraftsFromMrp rejects planning_run_stale after newer mrp.run',
    receiptInboundVsOnhand:
      'After procurement.receipt.post, MRP inbound = open remaining only (not received+onhand double count)',
    issuedToLineNotFree: 'Line-warehouse stock with productionOrderId is not free supply for other demand',
    uiFailClosed: 'executeG5Command failure must not call mirrorG5Ack (use mirrorG5AckIfOk)',
    liveSmoke: 'node scripts/g52-live-dataconnect-smoke.mjs (demo-otgruzka emulator; G52_ALLOW_MEMORY_FALLBACK=1 for CI offline only)',
  },
}

console.log(JSON.stringify(report, null, 2))
