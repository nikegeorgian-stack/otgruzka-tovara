/**
 * Shared, side-effect-free readiness rules for production line routing.
 *
 * This module deliberately has no browser or Node dependencies so the same
 * predicates can guard both the UI and the authoritative command boundary.
 */

export const LINE_READINESS_EPSILON = 1e-9

export const LINE_ID_REQUIRED = 'production.line.readiness.line_id_required'
export const LINE_BINDING_NOT_CONFIGURED =
  'production.line.readiness.binding_not_configured'
export const LINE_BINDING_DUPLICATE = 'production.line.readiness.binding_duplicate'
export const LINE_BINDING_WAREHOUSE_REQUIRED =
  'production.line.readiness.binding_warehouse_required'
export const LINE_BINDING_LOCATION_REQUIRED =
  'production.line.readiness.binding_location_required'
export const LINE_BINDING_WAREHOUSE_MISSING =
  'production.line.readiness.binding_warehouse_missing'
export const LINE_BINDING_LOCATION_MISSING =
  'production.line.readiness.binding_location_missing'
export const LINE_BINDING_WAREHOUSE_DUPLICATE =
  'production.line.readiness.binding_warehouse_duplicate'
export const LINE_BINDING_LOCATION_DUPLICATE =
  'production.line.readiness.binding_location_duplicate'
export const LINE_BINDING_ACCOUNTING_DUPLICATE =
  'production.line.readiness.binding_accounting_duplicate'
export const LINE_BINDING_ACCOUNTING_MISSING =
  'production.line.readiness.binding_accounting_missing'
export const LINE_BINDING_ACCOUNTING_INACTIVE =
  'production.line.readiness.binding_accounting_inactive'

export const SCRAP_WASTE_QUANTITY_INVALID =
  'production.line.readiness.scrap_waste_quantity_invalid'
export const SCRAP_LINE_ROUTE_REQUIRED =
  'production.line.readiness.scrap_line_route_required'
export const SCRAP_LOCATION_REQUIRED =
  'production.line.readiness.scrap_location_required'
export const SCRAP_LOCATION_MISSING =
  'production.line.readiness.scrap_location_missing'
export const SCRAP_LOCATION_DUPLICATE =
  'production.line.readiness.scrap_location_duplicate'
export const SCRAP_LOCATION_EQUALS_LINE =
  'production.line.readiness.scrap_location_equals_line'
export const SCRAP_ACCOUNTING_DUPLICATE =
  'production.line.readiness.scrap_accounting_duplicate'
export const SCRAP_ACCOUNTING_MISSING =
  'production.line.readiness.scrap_accounting_missing'
export const SCRAP_ACCOUNTING_INACTIVE =
  'production.line.readiness.scrap_accounting_inactive'

function stableId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function rowsWithId(rows, id, field = 'id') {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => stableId(row?.[field]) === id)
}

/**
 * Resolve exactly one production-line binding without guessing by label,
 * array position, or an unrelated row id.
 *
 * A legacy row may use its `id` as the line id only when `lineId` is blank.
 * When an accounting state exists for the production warehouse it must be
 * unique and active; an absent state is allowed for legacy stores.
 *
 * @param {{
 *   productionLineBindings?: readonly Record<string, unknown>[],
 *   locations?: readonly Record<string, unknown>[],
 *   accountingByWarehouse?: readonly Record<string, unknown>[],
 * }} store
 * @param {string} lineId
 * @param {{ requireActiveAccounting?: boolean }} [options]
 */
export function resolveProductionLineBinding(store, lineId, options = {}) {
  const targetLineId = stableId(lineId)
  if (!targetLineId) return { ok: false, error: LINE_ID_REQUIRED }

  const bindings = Array.isArray(store?.productionLineBindings)
    ? store.productionLineBindings
    : []
  const candidates = bindings.filter((row) => {
    const canonicalLineId = stableId(row?.lineId)
    if (canonicalLineId) return canonicalLineId === targetLineId
    return stableId(row?.id) === targetLineId
  })

  if (candidates.length === 0) {
    return { ok: false, error: LINE_BINDING_NOT_CONFIGURED }
  }
  if (candidates.length !== 1) {
    return { ok: false, error: LINE_BINDING_DUPLICATE }
  }

  const binding = candidates[0]
  const productionWarehouseId =
    stableId(binding?.productionWarehouseId) || stableId(binding?.sourceWarehouseId)
  const productionLocationId = stableId(binding?.productionLocationId)
  if (!productionWarehouseId) {
    return { ok: false, error: LINE_BINDING_WAREHOUSE_REQUIRED }
  }
  if (!productionLocationId) {
    return { ok: false, error: LINE_BINDING_LOCATION_REQUIRED }
  }

  const warehouseLocations = rowsWithId(store?.locations, productionWarehouseId)
  if (warehouseLocations.length === 0) {
    return { ok: false, error: LINE_BINDING_WAREHOUSE_MISSING }
  }
  if (warehouseLocations.length !== 1) {
    return { ok: false, error: LINE_BINDING_WAREHOUSE_DUPLICATE }
  }
  if (warehouseLocations[0]?.active === false) {
    return { ok: false, error: LINE_BINDING_WAREHOUSE_MISSING }
  }

  const productionLocations = rowsWithId(store?.locations, productionLocationId)
  if (productionLocations.length === 0) {
    return { ok: false, error: LINE_BINDING_LOCATION_MISSING }
  }
  if (productionLocations.length !== 1) {
    return { ok: false, error: LINE_BINDING_LOCATION_DUPLICATE }
  }
  if (productionLocations[0]?.active === false) {
    return { ok: false, error: LINE_BINDING_LOCATION_MISSING }
  }

  const accountingStates = rowsWithId(
    store?.accountingByWarehouse,
    productionWarehouseId,
    'warehouseId',
  )
  if (accountingStates.length > 1) {
    return { ok: false, error: LINE_BINDING_ACCOUNTING_DUPLICATE }
  }
  if (options.requireActiveAccounting === true && accountingStates.length === 0) {
    return { ok: false, error: LINE_BINDING_ACCOUNTING_MISSING }
  }
  if (accountingStates.length === 1 && accountingStates[0]?.status !== 'active') {
    return { ok: false, error: LINE_BINDING_ACCOUNTING_INACTIVE }
  }

  return { ok: true, productionWarehouseId, productionLocationId }
}

/**
 * Validate waste quantities and resolve a stable scrap location only when a
 * positive waste row remains after epsilon-zero rows are removed.
 *
 * @template {{ quantity: number }} T
 * @param {{
 *   scrapLocationId?: string,
 *   locations?: readonly Record<string, unknown>[],
 *   accountingByWarehouse?: readonly Record<string, unknown>[],
 *   productionWarehouseId?: string,
 *   productionLocationId?: string,
 *   wasteLines?: readonly T[] | null,
 * }} input
 */
export function resolveScrapReadiness(input) {
  const wasteLines = Array.isArray(input?.wasteLines) ? input.wasteLines : []
  if (
    wasteLines.some(
      (line) => !Number.isFinite(line?.quantity) || line.quantity < 0,
    )
  ) {
    return { ok: false, error: SCRAP_WASTE_QUANTITY_INVALID }
  }

  const positiveWasteLines = wasteLines.filter(
    (line) => line.quantity > LINE_READINESS_EPSILON,
  )
  if (positiveWasteLines.length === 0) {
    return {
      ok: true,
      wasteLines: positiveWasteLines,
      scrapLocationId: undefined,
    }
  }

  const productionWarehouseId = stableId(input?.productionWarehouseId)
  const productionLocationId = stableId(input?.productionLocationId)
  if (!productionWarehouseId || !productionLocationId) {
    return { ok: false, error: SCRAP_LINE_ROUTE_REQUIRED }
  }

  const scrapLocationId = stableId(input?.scrapLocationId)
  if (!scrapLocationId) {
    return { ok: false, error: SCRAP_LOCATION_REQUIRED }
  }
  if (
    scrapLocationId === productionWarehouseId ||
    scrapLocationId === productionLocationId
  ) {
    return { ok: false, error: SCRAP_LOCATION_EQUALS_LINE }
  }

  const scrapLocations = rowsWithId(input?.locations, scrapLocationId)
  if (scrapLocations.length === 0 || scrapLocations[0]?.active === false) {
    return { ok: false, error: SCRAP_LOCATION_MISSING }
  }
  if (scrapLocations.length !== 1) {
    return { ok: false, error: SCRAP_LOCATION_DUPLICATE }
  }

  const accountingStates = rowsWithId(
    input?.accountingByWarehouse,
    scrapLocationId,
    'warehouseId',
  )
  if (accountingStates.length > 1) {
    return { ok: false, error: SCRAP_ACCOUNTING_DUPLICATE }
  }
  if (accountingStates.length === 0) {
    return { ok: false, error: SCRAP_ACCOUNTING_MISSING }
  }
  if (accountingStates.length === 1 && accountingStates[0]?.status !== 'active') {
    return { ok: false, error: SCRAP_ACCOUNTING_INACTIVE }
  }

  return {
    ok: true,
    wasteLines: positiveWasteLines,
    scrapLocationId,
  }
}
