/**
 * R3.1C — pure packaging lineage guards.
 *
 * Canonical (WIP contract v1) orders may consume only the exact G3 WIP receipt
 * that belongs to the selected production order. Legacy orders keep the
 * historical balance-only path until they are explicitly migrated.
 */

import { createHash } from 'node:crypto'

const EPS = 1e-9

function str(value) {
  return String(value ?? '').trim()
}

function qty(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function sameQty(left, right) {
  return (
    Number.isFinite(qty(left)) &&
    Number.isFinite(qty(right)) &&
    Math.abs(qty(left) - qty(right)) <= EPS
  )
}

function orderIdOf(value) {
  return str(value?.productionOrderId ?? value?.orderId)
}

function isReceipt(value) {
  return value === 'receipt' || value === 'in'
}

function fail(error, extra = {}) {
  return { ok: false, error, status: 409, ...extra }
}

const PACK_LINE_ALIASES = new Set(['pack', 'packing', 'packaging', 'pack-line', 'line-pack'])

function isPackBinding(row) {
  const lineId = str(row?.lineId || row?.id).toLowerCase()
  return PACK_LINE_ALIASES.has(lineId)
}

function exactRows(rows, id, key = 'id') {
  return (Array.isArray(rows) ? rows : []).filter((row) => str(row?.[key]) === id)
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalJsonValue(value[key])]),
    )
  }
  return value
}

/** Versioned cryptographic fingerprint for irreversible packaging payload replay. */
export function canonicalPackagingCommandFingerprint(commandType, command) {
  const semanticJson = JSON.stringify(
    canonicalJsonValue({ commandType: str(commandType), command: command ?? {} }),
  )
  return `g4-packaging:v1:sha256:${createHash('sha256').update(semanticJson).digest('hex')}`
}

/** Resolve the one authoritative packaging route; strict v1 also verifies its ledger roots. */
export function resolveCanonicalPackBinding(warehouse, command, { strict = false } = {}) {
  const candidates = (warehouse?.productionLineBindings ?? []).filter(isPackBinding)
  if (candidates.length > 1) return fail('canonical_pack_binding_ambiguous')

  if (candidates.length === 0) {
    if (strict) return fail('canonical_pack_binding_required')
    const packagingWarehouseId = str(command?.packagingWarehouseId ?? command?.warehouseId)
    const packagingLocationId = str(command?.packagingLocationId ?? command?.locationId)
    if (!packagingWarehouseId || !packagingLocationId) {
      return { ok: false, error: 'pack_location_not_configured' }
    }
    return {
      ok: true,
      packagingWarehouseId,
      packagingLocationId,
      fgWarehouseId: str(command?.finishedGoodsWarehouseId) || packagingWarehouseId,
      fgLocationId: str(command?.finishedGoodsLocationId) || packagingLocationId,
      fromCommand: true,
    }
  }

  const binding = candidates[0]
  const packagingWarehouseId = str(
    binding?.packagingWarehouseId ??
      binding?.productionWarehouseId ??
      binding?.sourceWarehouseId,
  )
  const packagingLocationId = str(
    binding?.packagingLocationId ?? binding?.productionLocationId,
  )
  if (!packagingWarehouseId || !packagingLocationId) {
    return strict
      ? fail('pack_location_not_configured')
      : { ok: false, error: 'pack_location_not_configured' }
  }
  const fgWarehouseId =
    str(binding?.finishedGoodsWarehouseId ?? binding?.fgWarehouseId) || packagingWarehouseId
  const fgLocationId =
    str(binding?.finishedGoodsLocationId ?? binding?.fgLocationId) || packagingLocationId

  const claims = [
    [str(command?.packagingWarehouseId ?? command?.warehouseId), packagingWarehouseId],
    [str(command?.packagingLocationId ?? command?.locationId), packagingLocationId],
    [str(command?.finishedGoodsWarehouseId), fgWarehouseId],
    [str(command?.finishedGoodsLocationId), fgLocationId],
  ]
  if (claims.some(([claimed, expected]) => claimed && claimed !== expected)) {
    return { ok: false, error: 'pack_location_mismatch' }
  }

  if (strict) {
    for (const id of new Set([
      packagingWarehouseId,
      packagingLocationId,
      fgWarehouseId,
      fgLocationId,
    ])) {
      const matches = exactRows(warehouse?.locations, id)
      if (matches.length !== 1 || matches[0]?.active === false) {
        return fail(matches.length > 1 ? 'pack_location_ambiguous' : 'pack_location_unavailable', {
          locationId: id,
        })
      }
    }
    for (const warehouseId of new Set([packagingWarehouseId, fgWarehouseId])) {
      const matches = exactRows(warehouse?.accountingByWarehouse, warehouseId, 'warehouseId')
      if (matches.length === 0) return fail('pack_accounting_not_configured', { warehouseId })
      if (matches.length !== 1) return fail('pack_accounting_ambiguous', { warehouseId })
      if (matches[0]?.status !== 'active') {
        return fail('pack_accounting_inactive', { warehouseId })
      }
    }
  }

  return {
    ok: true,
    packagingWarehouseId,
    packagingLocationId,
    fgWarehouseId,
    fgLocationId,
  }
}

export function isCanonicalPackagingOrder(order) {
  return Number(order?.wipContractVersion) >= 1
}

function isAreaUnit(value) {
  return new Set(['m2', 'м2', 'м²', 'sqm']).has(str(value).toLowerCase())
}

/**
 * Bind G4 output to the exact server-owned G3 order identities. Canonical/staging
 * commands may not choose an arbitrary finished product or warehouse item. The
 * selected warehouse item must also be an active area item in the authoritative
 * catalogue; when G5 master data is active the finished-product identity is
 * checked there as well.
 */
export function validateCanonicalFinishedGoodsMapping({
  order,
  command,
  warehouse,
  masterData,
  masterDataActive = false,
  enforceCanonical = false,
}) {
  const canonical = enforceCanonical === true || isCanonicalPackagingOrder(order)
  if (!canonical) {
    return {
      ok: true,
      canonical: false,
      finishedProductId: str(command?.finishedProductId),
      warehouseItemId: str(command?.warehouseItemId) || str(command?.finishedProductId),
    }
  }

  const finishedProductId = str(order?.finishedProductId)
  const warehouseItemId = str(order?.warehouseItemId)
  if (!finishedProductId) return fail('finished_product_mapping_required')
  if (!warehouseItemId) return fail('finished_goods_item_mapping_required')
  if (warehouseItemId === str(order?.semiFinishedItemId)) {
    return fail('wip_item_must_differ_from_finished_goods')
  }

  const claimedProductId = str(command?.finishedProductId)
  const claimedItemId = str(command?.warehouseItemId)
  if (!claimedProductId || claimedProductId !== finishedProductId) {
    return fail('finished_product_mismatch')
  }
  if (!claimedItemId || claimedItemId !== warehouseItemId) {
    return fail('finished_goods_item_mismatch')
  }

  const itemCatalogue = masterDataActive
    ? masterData?.items ?? []
    : warehouse?.items ?? []
  const itemMatches = itemCatalogue.filter((item) => str(item?.id) === warehouseItemId)
  if (itemMatches.length !== 1) return fail('finished_goods_item_unavailable')
  const item = itemMatches[0]
  if (item?.active === false || item?.archived === true) {
    return fail('finished_goods_item_unavailable')
  }
  const unitSnapshot = str(item?.baseUnit ?? item?.unit)
  if (!isAreaUnit(unitSnapshot)) return fail('finished_goods_item_area_unit_required')

  if (masterDataActive) {
    const productMatches = (masterData?.finishedProducts ?? []).filter(
      (product) => str(product?.id) === finishedProductId,
    )
    if (productMatches.length !== 1) return fail('finished_product_unavailable')
    const product = productMatches[0]
    if (product?.active === false || product?.archived === true) {
      return fail('finished_product_unavailable')
    }
    const productUnit = str(product?.baseUnit ?? product?.unit)
    if (!isAreaUnit(productUnit)) return fail('finished_product_area_unit_required')
  }

  return {
    ok: true,
    canonical: true,
    finishedProductId,
    warehouseItemId,
    unitSnapshot,
  }
}

/**
 * Once QC, regrade/reject, write-off, or shipment has touched a canonical lot,
 * its packaging report is immutable. Reversing it would orphan downstream
 * evidence and can create a negative FG ledger.
 */
export function validateCanonicalPackagingCorrectionBoundary({
  production,
  warehouse,
  report,
  lot,
  enforceCanonical = false,
}) {
  const canonical = enforceCanonical === true || isCanonicalPackagingOrder(report)
  if (!canonical) return { ok: true, canonical: false }

  if (
    str(lot?.qcStatus) !== 'pending' ||
    Number(lot?.lotRevision ?? 1) !== 1 ||
    str(lot?.currentDecisionId) ||
    Number(lot?.quantityQcReleased ?? 0) > EPS ||
    Number(lot?.quantityShipped ?? 0) > EPS ||
    (Array.isArray(lot?.history) && lot.history.some((entry) => str(entry?.type) !== 'created'))
  ) {
    return fail('packaging_correction_downstream_started')
  }

  const lotId = str(lot?.id)
  const reportId = str(report?.id)
  if (
    (production?.qcDecisions ?? []).some(
      (decision) => str(decision?.finishedGoodsLotId ?? decision?.lotId) === lotId,
    ) ||
    (production?.finishedGoodsLots ?? []).some(
      (candidate) =>
        str(candidate?.id) !== lotId &&
        (str(candidate?.parentLotId) === lotId ||
          str(candidate?.sourceLotId) === lotId ||
          str(candidate?.correctsLotId) === lotId),
    ) ||
    (warehouse?.loadingShipments ?? []).some(
      (shipment) => str(shipment?.finishedGoodsLotId ?? shipment?.lotId) === lotId,
    )
  ) {
    return fail('packaging_correction_downstream_started')
  }

  const hasDownstreamDocument = (warehouse?.documents ?? []).some((document) => {
    const touchesLot =
      str(document?.finishedGoodsLotId) === lotId ||
      str(document?.parentFinishedGoodsLotId) === lotId
    if (!touchesLot) return false
    return str(document?.packagingReportId) !== reportId
  })
  const hasDownstreamMovement = (warehouse?.movements ?? []).some((movement) => {
    if (str(movement?.finishedGoodsLotId) !== lotId) return false
    return str(movement?.packagingReportId) !== reportId
  })
  if (hasDownstreamDocument || hasDownstreamMovement) {
    return fail('packaging_correction_downstream_started')
  }

  return { ok: true, canonical: true }
}

/**
 * Validate the complete G3 shift → WIP batch → posted receipt → G4 input path.
 * Every identity is server-owned; client fields are claims that must match it.
 */
export function validateCanonicalPackagingWipLineage({
  production,
  warehouse,
  order,
  binding,
  wipLines,
  outputM2,
}) {
  if (!isCanonicalPackagingOrder(order)) return { ok: true, canonical: false }

  const orderId = str(order?.id)
  const expectedItemId = str(order?.semiFinishedItemId)
  const outputQty = qty(outputM2)
  if (!orderId || !expectedItemId) return fail('canonical_wip_mapping_required')
  if (
    binding?.fromCommand === true ||
    !str(binding?.packagingWarehouseId) ||
    !str(binding?.packagingLocationId)
  ) {
    return fail('canonical_pack_binding_required')
  }
  if (!Number.isFinite(outputQty) || outputQty <= EPS) return fail('invalid_output')
  if (!Array.isArray(wipLines) || wipLines.length === 0) return fail('wip_lines_required')

  const batches = Array.isArray(production?.wipBatches) ? production.wipBatches : []
  const reports = Array.isArray(production?.shiftReports) ? production.shiftReports : []
  const documents = Array.isArray(warehouse?.documents) ? warehouse.documents : []
  const movements = Array.isArray(warehouse?.movements) ? warehouse.movements : []
  const usedBatchIds = new Set()
  let consumedTotal = 0

  for (const line of wipLines) {
    const claimedOrderId = str(line?.productionOrderId)
    const shiftReportId = str(line?.shiftReportId)
    const receiptDocumentId = str(line?.receiptDocumentId)
    const wipBatchId = str(line?.wipBatchId ?? line?.batchNo)
    const itemId = str(line?.itemId ?? line?.semiFinishedItemId)
    const lineId = str(line?.lineId)
    const requestedQty = qty(line?.quantity)

    if (!claimedOrderId || !shiftReportId || !receiptDocumentId || !wipBatchId || !lineId) {
      return fail('canonical_wip_lineage_required')
    }
    if (claimedOrderId !== orderId) return fail('wip_order_mismatch')
    if (itemId !== expectedItemId) return fail('wip_item_mismatch')
    if (!Number.isFinite(requestedQty) || requestedQty <= EPS) return fail('invalid_quantity')
    if (usedBatchIds.has(wipBatchId)) return fail('wip_batch_duplicate')
    usedBatchIds.add(wipBatchId)

    const batchMatches = batches.filter((batch) => str(batch?.id) === wipBatchId)
    if (batchMatches.length !== 1) return fail('wip_batch_ambiguous_or_missing')
    const batch = batchMatches[0]
    if (
      orderIdOf(batch) !== orderId ||
      str(batch?.shiftReportId) !== shiftReportId ||
      str(batch?.itemId) !== expectedItemId ||
      str(batch?.locationId) !== str(binding?.packagingLocationId) ||
      batch?.isFinishedGoods !== false ||
      Number(batch?.wipContractVersion) < 1
    ) {
      return fail('wip_batch_lineage_mismatch')
    }

    const reportMatches = reports.filter((report) => str(report?.id) === shiftReportId)
    if (reportMatches.length !== 1) return fail('shift_report_ambiguous_or_missing')
    const report = reportMatches[0]
    if (
      report?.status !== 'confirmed' ||
      orderIdOf(report) !== orderId ||
      str(report?.wipBatchId) !== wipBatchId ||
      str(report?.semiFinishedItemId) !== expectedItemId ||
      str(report?.packLocationId ?? report?.packagingLocationId) !==
        str(binding?.packagingLocationId) ||
      Number(report?.wipContractVersion) < 1
    ) {
      return fail('shift_report_wip_lineage_mismatch')
    }

    const receiptMatches = documents.filter((document) => str(document?.id) === receiptDocumentId)
    if (receiptMatches.length !== 1) return fail('wip_receipt_ambiguous_or_missing')
    const receipt = receiptMatches[0]
    const receiptRole = str(receipt?.docRole)
    const receiptLines = Array.isArray(receipt?.lines) ? receipt.lines : []
    if (
      receipt?.status !== 'posted' ||
      receipt?.purpose !== 'production_receipt' ||
      !new Set(['wip_receipt', 'production_wip_receipt']).has(receiptRole) ||
      receipt?.isWip !== true ||
      orderIdOf(receipt) !== orderId ||
      str(receipt?.shiftReportId) !== shiftReportId ||
      str(receipt?.warehouseId) !== str(binding?.packagingWarehouseId) ||
      receiptLines.length !== 1
    ) {
      return fail('wip_receipt_lineage_mismatch')
    }
    const receiptLine = receiptLines[0]
    if (
      str(receiptLine?.lineId) !== lineId ||
      str(receiptLine?.itemId) !== expectedItemId ||
      str(receiptLine?.locationId) !== str(binding?.packagingLocationId) ||
      str(receiptLine?.batchNo) !== wipBatchId ||
      !sameQty(receiptLine?.quantity, batch?.quantityMp) ||
      !sameQty(receiptLine?.quantity, report?.outputMp ?? report?.outputM2)
    ) {
      return fail('wip_receipt_line_mismatch')
    }

    const canonicalReceipts = movements.filter(
      (movement) =>
        !movement?.cancelled &&
        isReceipt(movement?.type) &&
        str(movement?.warehouseId) === str(binding?.packagingWarehouseId) &&
        str(movement?.locationId) === str(binding?.packagingLocationId) &&
        str(movement?.itemId) === expectedItemId &&
        str(movement?.batchNo) === wipBatchId &&
        orderIdOf(movement) === orderId &&
        str(movement?.shiftReportId) === shiftReportId &&
        movement?.isWip === true,
    )
    if (
      canonicalReceipts.length !== 1 ||
      str(canonicalReceipts[0]?.documentId) !== receiptDocumentId ||
      !sameQty(canonicalReceipts[0]?.quantity, receiptLine?.quantity)
    ) {
      return fail('wip_receipt_movement_mismatch')
    }

    const expectedUnit = str(batch?.unitSnapshot ?? receiptLine?.unitSnapshot)
    const claimedUnit = str(line?.unitSnapshot)
    if (expectedUnit && claimedUnit && expectedUnit !== claimedUnit) {
      return fail('wip_unit_mismatch')
    }
    consumedTotal += requestedQty
  }

  if (!sameQty(consumedTotal, outputQty)) {
    return fail('wip_output_quantity_mismatch', {
      wipQuantity: consumedTotal,
      outputM2: outputQty,
    })
  }

  return {
    ok: true,
    canonical: true,
    orderId,
    semiFinishedItemId: expectedItemId,
    sourceShiftReportIds: [...new Set(wipLines.map((line) => str(line.shiftReportId)))],
    sourceWipBatchIds: [...usedBatchIds],
  }
}

export { EPS }
