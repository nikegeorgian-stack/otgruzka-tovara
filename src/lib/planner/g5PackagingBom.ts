/**
 * PHASE G5.3 — packaging BOM helpers (canonical body + recipe → components).
 *
 * Server computes sha256 contentHash from the same canonical shape (see
 * packagingBomContentHash in server/fst/_g5SalesProcurementService.mjs).
 *
 * G4 compatibility: packaging reports / recipeSnapshot should carry packagingBomId +
 * version (+ contentHash) when available so printed packaging matches MRP packagingBomRefs.
 * If G4 already has recipeSnapshot fields, map packagingBomId/version into the snapshot
 * when posting; until then MRP packagingBomRefs remain the authority.
 */
import type { PackagingRecipe } from '@/lib/packaging/types'

export type PackagingBomStatus = 'draft' | 'approved' | 'retired'

export type PackagingBomComponent = {
  itemId: string
  warehouseItemId?: string
  quantity: number
  unit: string
  conversionFactor?: number
  wasteFactor?: number
  note?: string
}

export type PackagingBomRef = {
  finishedProductId: string
  packagingBomId: string
  version: number
  contentHash?: string
}

export type PackagingBomSnapshot = {
  packagingBomId: string
  version: number
  contentHash: string
  asOfDate?: string
  snapshotAt?: string
  finishedProductId?: string
  baseOutputQty?: number
  components?: PackagingBomComponent[]
}

export type PackagingRequirementLine = {
  itemId: string
  warehouseItemId?: string
  unit: string
  normQty: number
  tolerance?: number
}

export type PackagingComponentNorm = {
  itemId: string
  warehouseItemId?: string
  unit: string
  normQty: number
  actualQty?: number
  deviation?: number
  tolerance?: number
  overTolerance?: boolean
}

/** Short display for sha256 content hashes in tables. */
export function shortContentHash(hash?: string | null): string {
  const h = hash == null ? '' : String(hash).trim()
  if (!h) return '—'
  return h.length > 10 ? `${h.slice(0, 8)}…` : h
}

/** Deterministic JSON (sorted object keys) — mirrors server stableJson. */
export function stableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableCanonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableCanonicalJson(obj[k])}`).join(',')}}`
}

/**
 * Map packaging recipe stack (pallet/box/…) into BOM components.
 * Migration aid only — legacy pallet/box mapping produces draft/requires_review components.
 * After masterData activation, MRP/G3/G4 must NOT use this for live explode; approved
 * packagingBoms from master data are the only authority for requirements and snapshots.
 */
export function packagingRecipeToBomComponents(
  recipe: PackagingRecipe & { components?: PackagingBomComponent[] },
): PackagingBomComponent[] {
  if (Array.isArray(recipe.components) && recipe.components.length > 0) {
    return recipe.components.map((c) => ({
      itemId: String(c.itemId || c.warehouseItemId || '').trim(),
      warehouseItemId: c.warehouseItemId,
      quantity: Number(c.quantity) || 0,
      unit: String(c.unit || 'pcs'),
      conversionFactor: c.conversionFactor,
      wasteFactor: c.wasteFactor,
      note: c.note,
    }))
  }

  const stack =
    Array.isArray(recipe.stack) && recipe.stack.length > 0
      ? recipe.stack
      : (['pallet', 'box'] as const)
  const out: PackagingBomComponent[] = []
  for (const layer of stack) {
    if (layer === 'pallet' && recipe.palletItemId) {
      out.push({ itemId: recipe.palletItemId, quantity: 1, unit: 'pcs' })
    } else if (layer === 'box' && recipe.boxItemId) {
      out.push({
        itemId: recipe.boxItemId,
        quantity: Math.max(1, Number(recipe.rollsPerBox) || 1),
        unit: 'pcs',
      })
    }
  }
  if (out.length === 0) {
    if (recipe.palletItemId) out.push({ itemId: recipe.palletItemId, quantity: 1, unit: 'pcs' })
    if (recipe.boxItemId) {
      out.push({
        itemId: recipe.boxItemId,
        quantity: Math.max(1, Number(recipe.rollsPerBox) || 1),
        unit: 'pcs',
      })
    }
  }
  return out.filter((c) => c.itemId && c.quantity > 0)
}
