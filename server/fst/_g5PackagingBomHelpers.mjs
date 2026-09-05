/**
 * PHASE G5.4 — shared packaging BOM helpers (MRP / G3 / G4).
 *
 * Pure functions only. No Data Connect I/O.
 * Legacy pallet/box mapping is migration-aid only → draft components + requires_review.
 */
import { createHash } from 'node:crypto'

const EPS = 1e-9
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function str(value) {
  return String(value ?? '').trim()
}

function num(value) {
  return Number(value)
}

function roundQty(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1e9) / 1e9
}

function findById(list, id) {
  const key = str(id)
  if (!key) return null
  return (list ?? []).find((row) => str(row.id) === key) ?? null
}

/** Deterministic JSON for fingerprints (sorted object keys). */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

/** SHA-256 of canonical packaging BOM body. */
export function packagingBomContentHash({ finishedProductId, baseOutputQty, components }) {
  const canonical = {
    finishedProductId: str(finishedProductId),
    baseOutputQty: roundQty(num(baseOutputQty) || 1),
    components: (components ?? []).map((c) => ({
      itemId: str(c.itemId || c.warehouseItemId),
      quantity: roundQty(num(c.quantity ?? c.qty) || 0),
      unit: str(c.unit),
      conversionFactor:
        c.conversionFactor != null && Number.isFinite(num(c.conversionFactor))
          ? num(c.conversionFactor)
          : undefined,
      wasteFactor:
        c.wasteFactor != null && Number.isFinite(num(c.wasteFactor))
          ? num(c.wasteFactor)
          : undefined,
      tolerance:
        c.tolerance != null && Number.isFinite(num(c.tolerance)) ? num(c.tolerance) : undefined,
    })),
  }
  return createHash('sha256').update(stableJson(canonical), 'utf8').digest('hex')
}

export function bomComponentList(bom) {
  if (Array.isArray(bom?.components) && bom.components.length) return bom.components
  if (Array.isArray(bom?.lines) && bom.lines.length) return bom.lines
  return []
}

export function bomIsApprovedEffective(bom, asOfDate) {
  if (!bom) return false
  if (bom.archived === true || bom.status === 'retired') return false
  if (bom.status === 'draft') return false
  if (bom.status != null && bom.status !== 'approved') return false
  const day = str(asOfDate).slice(0, 10)
  const from = bom.effectiveFrom != null ? str(bom.effectiveFrom).slice(0, 10) : ''
  const to = bom.effectiveTo != null ? str(bom.effectiveTo).slice(0, 10) : ''
  if (from && DATE_RE.test(from) && day && day < from) return false
  if (to && DATE_RE.test(to) && day && day > to) return false
  return true
}

export function selectApprovedPackagingBom(masterData, product, asOfDate) {
  const boms = masterData?.packagingBoms ?? []
  const preferredId = str(product?.packagingBomId)
  if (preferredId) {
    const pref = findById(boms, preferredId)
    if (bomIsApprovedEffective(pref, asOfDate)) return pref
  }
  const candidates = boms.filter(
    (b) => str(b.finishedProductId) === str(product?.id) && bomIsApprovedEffective(b, asOfDate),
  )
  candidates.sort((a, b) => (num(b.version) || 0) - (num(a.version) || 0))
  return candidates[0] || null
}

export function productRequiresPackagingBom(product) {
  if (!product) return true
  return product.packagingBomRequired !== false
}

export function trustedBomRefFromBom(bom, finishedProductId) {
  if (!bom) return null
  return {
    finishedProductId: str(finishedProductId || bom.finishedProductId),
    packagingBomId: str(bom.id || bom.packagingBomId),
    packagingBomVersion: num(bom.version) || 1,
    packagingBomContentHash: str(bom.contentHash),
  }
}

/**
 * Immutable snapshot frozen onto a confirmed G3 production order.
 * Never accept client-supplied snapshot objects — always build server-side.
 */
export function buildPackagingBomSnapshot(bom, product, actor, now, asOfDate) {
  const components = bomComponentList(bom).map((c) => ({
    itemId: str(c.itemId || c.warehouseItemId),
    warehouseItemId: str(c.warehouseItemId || c.itemId),
    quantity: roundQty(num(c.quantity ?? c.qty) || 0),
    unit: str(c.unit || 'pcs'),
    conversionFactor:
      c.conversionFactor != null && Number.isFinite(num(c.conversionFactor))
        ? num(c.conversionFactor)
        : 1,
    wasteFactor:
      c.wasteFactor != null && Number.isFinite(num(c.wasteFactor)) ? num(c.wasteFactor) : 0,
    tolerance:
      c.tolerance != null && Number.isFinite(num(c.tolerance)) ? num(c.tolerance) : undefined,
  }))
  const finishedProductId = str(product?.id || bom.finishedProductId)
  const baseOutputQty = Math.max(EPS, num(bom.baseOutputQty) || 1)
  const contentHash =
    str(bom.contentHash) ||
    packagingBomContentHash({ finishedProductId, baseOutputQty, components })
  return {
    packagingBomId: str(bom.id || bom.packagingBomId),
    version: num(bom.version) || 1,
    contentHash,
    effectiveFrom: bom.effectiveFrom != null ? str(bom.effectiveFrom).slice(0, 10) : undefined,
    effectiveTo: bom.effectiveTo != null ? str(bom.effectiveTo).slice(0, 10) : undefined,
    asOfDate: str(asOfDate || now).slice(0, 10),
    finishedProductId,
    baseOutputQty,
    components,
    approvedBy: bom.approvedBy != null ? str(bom.approvedBy) : undefined,
    approvedAt: bom.approvedAt != null ? str(bom.approvedAt) : undefined,
    snapshotAt: now,
    snapshotBy: actor?.uid != null ? str(actor.uid) : undefined,
  }
}

/** Explode packaging requirements for outputQty of finished product (base units). */
export function computePackagingRequirements(snapshotOrBom, outputQty) {
  const baseOutputQty = Math.max(EPS, num(snapshotOrBom.baseOutputQty) || 1)
  const scale = roundQty(num(outputQty) || 0) / baseOutputQty
  const components = bomComponentList(snapshotOrBom)
  return components
    .map((c) => {
      const itemId = str(c.warehouseItemId || c.itemId)
      const qty = num(c.quantity ?? c.qty)
      const conversion =
        c.conversionFactor != null && Number.isFinite(num(c.conversionFactor))
          ? num(c.conversionFactor)
          : 1
      const waste =
        c.wasteFactor != null && Number.isFinite(num(c.wasteFactor)) ? num(c.wasteFactor) : 0
      const tolerance =
        c.tolerance != null && Number.isFinite(num(c.tolerance)) ? num(c.tolerance) : 0
      const need = roundQty(qty * scale * conversion * (1 + waste))
      return {
        itemId,
        warehouseItemId: itemId,
        unit: str(c.unit || 'pcs'),
        normQty: need,
        conversionFactor: conversion,
        wasteFactor: waste,
        tolerance,
      }
    })
    .filter((r) => r.itemId && r.normQty > EPS)
}

/**
 * Compare actual material lines to snapshot norms.
 * Returns { ok, error?, components, excessRequiresReason }.
 */
export function comparePackagingActualToNorm(snapshot, outputQty, materialLines, opts = {}) {
  const norms = computePackagingRequirements(snapshot, outputQty)
  const byItem = new Map(norms.map((n) => [n.itemId, { ...n, actualQty: 0 }]))
  const lines = Array.isArray(materialLines) ? materialLines : []
  const excessReason = str(opts.excessReason ?? opts.deviationReason ?? opts.reason)

  for (const line of lines) {
    const itemId = str(line.itemId || line.warehouseItemId)
    if (!itemId) {
      return { ok: false, error: 'packaging_material_item_required', status: 400 }
    }
    const unit = str(line.unitSnapshot || line.unit || '')
    const qty = roundQty(num(line.quantity) || 0)
    if (qty <= EPS) continue
    const norm = byItem.get(itemId)
    if (!norm) {
      return {
        ok: false,
        error: 'packaging_material_not_in_snapshot',
        status: 400,
        itemId,
      }
    }
    if (unit && norm.unit && unit !== norm.unit) {
      return {
        ok: false,
        error: 'packaging_unit_mismatch',
        status: 400,
        itemId,
        expectedUnit: norm.unit,
        actualUnit: unit,
      }
    }
    norm.actualQty = roundQty(norm.actualQty + qty)
  }

  const components = []
  let excessRequiresReason = false
  for (const norm of byItem.values()) {
    const deviation = roundQty(norm.actualQty - norm.normQty)
    const tolAbs =
      norm.tolerance > 0
        ? roundQty(norm.normQty * norm.tolerance)
        : 0
    const overTol = deviation > tolAbs + EPS
    if (overTol) excessRequiresReason = true
    components.push({
      itemId: norm.itemId,
      warehouseItemId: norm.warehouseItemId,
      unit: norm.unit,
      normQty: norm.normQty,
      actualQty: norm.actualQty,
      deviation,
      tolerance: norm.tolerance,
      overTolerance: overTol,
    })
  }

  if (excessRequiresReason && !excessReason) {
    return {
      ok: false,
      error: 'packaging_excess_reason_required',
      status: 400,
      components,
    }
  }

  return {
    ok: true,
    components,
    excessRequiresReason,
    excessReason: excessReason || undefined,
    packagingBomId: str(snapshot.packagingBomId),
    version: num(snapshot.version) || 1,
    contentHash: str(snapshot.contentHash),
  }
}

/**
 * Migration aid only: convert legacy pallet/box recipe fields into draft components.
 * NEVER auto-approve. Caller must mark requires_review.
 */
export function legacyRecipeToDraftComponents(recipe) {
  const out = []
  const stack =
    Array.isArray(recipe?.stack) && recipe.stack.length > 0
      ? recipe.stack
      : ['pallet', 'box']
  for (const layer of stack) {
    if (layer === 'pallet' && recipe?.palletItemId) {
      out.push({
        itemId: str(recipe.palletItemId),
        warehouseItemId: str(recipe.palletItemId),
        quantity: 1,
        unit: 'pcs',
        source: 'legacy_pallet',
      })
    } else if (layer === 'box' && recipe?.boxItemId) {
      out.push({
        itemId: str(recipe.boxItemId),
        warehouseItemId: str(recipe.boxItemId),
        quantity: Math.max(1, Math.trunc(num(recipe.rollsPerBox) || 1)),
        unit: 'pcs',
        source: 'legacy_box',
      })
    }
  }
  return {
    components: out,
    status: 'draft',
    requiresReview: true,
    migrationAid: true,
    reviewKind: 'requires_review',
  }
}

export { EPS, findById, num, roundQty, str }
