/**
 * PHASE G5.3 — local-only legacy domain scan + heuristic validation for activation wizard.
 * No server writes. Heuristics only — not authoritative migration.
 */
import type { AppStore } from '@/lib/types'
import type { G5ActivationFlags } from './g5Activation'
import { g5FlagsFromStore } from './g5Activation'

/** Exact confirmation phrase (English, constant) — not localized for safety. */
export const G5_ACTIVATION_CONFIRM_PHRASE = 'ACTIVATE G5'

export type G5LegacyScanCounts = {
  counterparties: number
  finishedProducts: number
  warehouseItems: number
  salesOrders: number
  purchaseOrders: number
  packagingRecipes: number
}

export type G5PreviewIssueKind =
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'missingStableId'
  | 'nameOnlyLink'
  | 'bomUnitSupplierError'
  | 'requires_review'

export type G5PreviewIssue = {
  kind: G5PreviewIssueKind
  entity: string
  id: string
  detail: string
}

export type G5DryRunSummary = {
  flags: G5ActivationFlags
  counts: G5LegacyScanCounts
  issues: G5PreviewIssue[]
  acceptedEstimate: number
  rejectedEstimate: number
  notes: string[]
  /** Confirmed/active production orders missing packagingBomSnapshot (local heuristic). */
  ordersMissingBomSnapshotCount: number
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

/** Production orders may live on critical overlay (`orders`) not legacy ProductionStore typing. */
function productionOrders(store: AppStore | null | undefined): unknown[] {
  if (!store?.production) return []
  const prod = store.production as AppStore['production'] & {
    orders?: unknown[]
    g3Orders?: unknown[]
  }
  const primary = asArr(prod.orders)
  if (primary.length) return primary
  return asArr(prod.g3Orders)
}

/**
 * Local heuristic: active/confirmed orders missing packagingBomSnapshot
 * when finished-product master data (or packaging recipes) exists.
 */
export function scanOrdersMissingPackagingBomSnapshot(
  store: AppStore | null | undefined,
): G5PreviewIssue[] {
  if (!store) return []
  const products = asArr(store.finishedProducts?.items)
  const recipes = asArr(store.packagingRecipes?.items)
  if (products.length === 0 && recipes.length === 0) return []

  const productIds = new Set(products.map((r) => str(asRec(r)?.id)).filter(Boolean))
  const issues: G5PreviewIssue[] = []
  for (const raw of productionOrders(store)) {
    const order = asRec(raw)
    if (!order) continue
    const status = str(order.status).toLowerCase()
    if (status !== 'active' && status !== 'confirmed') continue
    const snap = asRec(order.packagingBomSnapshot)
    const hash = str(snap?.contentHash).trim()
    if (hash) continue
    const fpId = str(order.finishedProductId || order.productId)
    const hasProductContext =
      !fpId || productIds.size === 0 || productIds.has(fpId) || recipes.length > 0
    if (!hasProductContext) continue
    issues.push({
      kind: 'requires_review',
      entity: 'productionOrder',
      id: str(order.id) || '(no-id)',
      detail: 'confirmed order missing packagingBomSnapshot — migrate before G4 packaging',
    })
  }
  return issues
}

/** Read-only counts from local AppStore legacy domains. */
export function scanG5LegacyDomain(store: AppStore | null | undefined): G5LegacyScanCounts {
  if (!store) {
    return {
      counterparties: 0,
      finishedProducts: 0,
      warehouseItems: 0,
      salesOrders: 0,
      purchaseOrders: 0,
      packagingRecipes: 0,
    }
  }
  return {
    counterparties: asArr(store.counterparties?.items).length,
    finishedProducts: asArr(store.finishedProducts?.items).length,
    warehouseItems: asArr(store.warehouse?.items).length,
    salesOrders: asArr(store.sales?.orders).length,
    purchaseOrders: asArr(store.procurement?.orders).length,
    packagingRecipes: asArr(store.packagingRecipes?.items).length,
  }
}

function duplicateCodes(rows: unknown[], entity: string): G5PreviewIssue[] {
  const seen = new Map<string, string>()
  const out: G5PreviewIssue[] = []
  for (const raw of rows) {
    const row = asRec(raw)
    if (!row) continue
    const code = str(row.code).trim().toUpperCase()
    const id = str(row.id)
    if (!code) continue
    if (seen.has(code)) {
      out.push({
        kind: 'duplicate',
        entity,
        id,
        detail: `code=${code} otherId=${seen.get(code)}`,
      })
    } else {
      seen.set(code, id)
    }
  }
  return out
}

function missingIds(rows: unknown[], entity: string): G5PreviewIssue[] {
  return rows.flatMap((raw) => {
    const row = asRec(raw)
    if (!row) return []
    const id = str(row.id).trim()
    if (id) return []
    return [
      {
        kind: 'missingStableId' as const,
        entity,
        id: '(empty)',
        detail: str(row.name || row.code || 'unnamed'),
      },
    ]
  })
}

function nameOnly(rows: unknown[], entity: string): G5PreviewIssue[] {
  return rows.flatMap((raw) => {
    const row = asRec(raw)
    if (!row) return []
    const name = str(row.name).trim()
    const code = str(row.code).trim()
    const id = str(row.id).trim()
    if (name && !code) {
      return [
        {
          kind: 'nameOnlyLink' as const,
          entity,
          id: id || '(no-id)',
          detail: name,
        },
      ]
    }
    return []
  })
}

/** Heuristic local validation — accepted/rejected/duplicate/missing IDs/name-only/BOM errors. */
export function previewG5ActivationIssues(
  store: AppStore | null | undefined,
): G5PreviewIssue[] {
  if (!store) return []
  const counterparties = asArr(store.counterparties?.items)
  const products = asArr(store.finishedProducts?.items)
  const items = asArr(store.warehouse?.items)
  const recipes = asArr(store.packagingRecipes?.items)
  const salesOrders = asArr(store.sales?.orders)
  const pos = asArr(store.procurement?.orders)

  const issues: G5PreviewIssue[] = [
    ...missingIds(counterparties, 'counterparty'),
    ...missingIds(products, 'finishedProduct'),
    ...missingIds(items, 'warehouseItem'),
    ...missingIds(recipes, 'packagingRecipe'),
    ...missingIds(salesOrders, 'salesOrder'),
    ...missingIds(pos, 'purchaseOrder'),
    ...duplicateCodes(counterparties, 'counterparty'),
    ...duplicateCodes(products, 'finishedProduct'),
    ...duplicateCodes(items, 'warehouseItem'),
    ...nameOnly(counterparties, 'counterparty'),
    ...nameOnly(products, 'finishedProduct'),
    ...nameOnly(items, 'warehouseItem'),
    ...scanOrdersMissingPackagingBomSnapshot(store),
  ]

  const itemIds = new Set(
    items.map((r) => str(asRec(r)?.id)).filter(Boolean),
  )
  const productIds = new Set(
    products.map((r) => str(asRec(r)?.id)).filter(Boolean),
  )

  for (const raw of recipes) {
    const recipe = asRec(raw)
    if (!recipe) continue
    const rid = str(recipe.id) || '(no-id)'
    const productId = str(recipe.finishedProductId || recipe.productId)
    if (productId && !productIds.has(productId)) {
      issues.push({
        kind: 'bomUnitSupplierError',
        entity: 'packagingRecipe',
        id: rid,
        detail: `product link missing: ${productId}`,
      })
    }
    const lines = asArr(recipe.lines ?? recipe.components ?? recipe.materials)
    const hasCanonicalComponents = lines.length > 0
    const hasLegacyPalletBox =
      !hasCanonicalComponents && (Boolean(recipe.palletItemId) || Boolean(recipe.boxItemId))
    if (hasLegacyPalletBox) {
      issues.push({
        kind: 'requires_review',
        entity: 'packagingRecipe',
        id: rid,
        detail:
          'legacy pallet/box mapping only — draft BOM requires_review; approve canonical components before G5 explode',
      })
    }
    for (const lnRaw of lines) {
      const ln = asRec(lnRaw)
      if (!ln) continue
      const itemId = str(ln.itemId || ln.warehouseItemId)
      const unit = str(ln.unit || ln.uom)
      const supplierId = str(ln.supplierId || ln.defaultSupplierId)
      if (itemId && !itemIds.has(itemId)) {
        issues.push({
          kind: 'bomUnitSupplierError',
          entity: 'packagingRecipe',
          id: rid,
          detail: `component item missing: ${itemId}`,
        })
      }
      if (itemId && !unit) {
        issues.push({
          kind: 'bomUnitSupplierError',
          entity: 'packagingRecipe',
          id: rid,
          detail: `component ${itemId} missing unit`,
        })
      }
      if (supplierId && !counterparties.some((c) => str(asRec(c)?.id) === supplierId)) {
        issues.push({
          kind: 'bomUnitSupplierError',
          entity: 'packagingRecipe',
          id: rid,
          detail: `supplier missing: ${supplierId}`,
        })
      }
    }
  }

  for (const raw of salesOrders) {
    const so = asRec(raw)
    if (!so) continue
    const customerId = str(so.customerId || so.counterpartyId)
    if (!customerId && str(so.customerName || so.customer)) {
      issues.push({
        kind: 'nameOnlyLink',
        entity: 'salesOrder',
        id: str(so.id) || '(no-id)',
        detail: `customer name-only: ${str(so.customerName || so.customer)}`,
      })
    } else if (
      customerId &&
      !counterparties.some((c) => str(asRec(c)?.id) === customerId)
    ) {
      issues.push({
        kind: 'rejected',
        entity: 'salesOrder',
        id: str(so.id) || '(no-id)',
        detail: `customerId not in counterparties: ${customerId}`,
      })
    } else if (str(so.id)) {
      issues.push({
        kind: 'accepted',
        entity: 'salesOrder',
        id: str(so.id),
        detail: 'stable id + customer link ok',
      })
    }
  }

  return issues
}

/** Dry-run mapping summary — no server activate. */
export function buildG5DryRunSummary(
  store: AppStore | null | undefined,
): G5DryRunSummary {
  const counts = scanG5LegacyDomain(store)
  const issues = previewG5ActivationIssues(store)
  const ordersMissingBomSnapshotCount = issues.filter(
    (i) => i.entity === 'productionOrder' && i.kind === 'requires_review',
  ).length
  const acceptedEstimate = issues.filter((i) => i.kind === 'accepted').length
  const rejectedEstimate = issues.filter(
    (i) =>
      i.kind === 'rejected' ||
      i.kind === 'duplicate' ||
      i.kind === 'missingStableId' ||
      i.kind === 'bomUnitSupplierError' ||
      i.kind === 'requires_review',
  ).length
  const notes = [
    'Local/demo heuristic only — not production bootstrap.',
    'Server activate requires typed confirmation and admin capability.',
    'Full migration command is future work.',
    'Activation order: masterData → salesPlanning → procurement.',
  ]
  if (ordersMissingBomSnapshotCount > 0) {
    notes.push(
      `g5.activation.note.ordersMissingBomSnapshot:${ordersMissingBomSnapshotCount}`,
    )
  }
  return {
    flags: g5FlagsFromStore(store),
    counts,
    issues,
    acceptedEstimate,
    rejectedEstimate,
    notes,
    ordersMissingBomSnapshotCount,
  }
}
