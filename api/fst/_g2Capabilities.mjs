/**
 * PHASE G2 — server-trusted warehouse capabilities (FstPrincipalAccess.capabilitiesJson).
 * Legacy G1 flags are accepted as aliases for backward compatibility.
 */

export const G2_CAPS = Object.freeze({
  READ: 'warehouse.read',
  DRAFT_EDIT: 'warehouse.draft.edit',
  DOCUMENT_POST: 'warehouse.document.post',
  TRANSFER_POST: 'warehouse.transfer.post',
  INVENTORY_POST: 'warehouse.inventory.post',
  OPENING_ACTIVATE: 'warehouse.opening.activate',
  DOCUMENT_CANCEL: 'warehouse.document.cancel',
  PERIOD_CLOSE: 'warehouse.period.close',
  PERIOD_REOPEN: 'warehouse.period.reopen',
})

/** Map legacy G1 capability keys → G2. */
const LEGACY_ALIASES = Object.freeze({
  canViewWarehouse: G2_CAPS.READ,
  canPostWarehouseDocument: G2_CAPS.DOCUMENT_POST,
  canCancelWarehouseDocument: G2_CAPS.DOCUMENT_CANCEL,
})

export function normalizeCapabilities(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (value !== true) continue
    const mapped = LEGACY_ALIASES[key] ?? key
    out[mapped] = true
  }
  return out
}

export function hasCapability(caps, capability) {
  const normalized = normalizeCapabilities(caps)
  if (normalized[capability] === true) return true
  // Accept legacy G1 capability names at the check site as well.
  const legacyToG2 = {
    canViewWarehouse: G2_CAPS.READ,
    canPostWarehouseDocument: G2_CAPS.DOCUMENT_POST,
    canCancelWarehouseDocument: G2_CAPS.DOCUMENT_CANCEL,
  }
  const mapped = legacyToG2[capability]
  return mapped ? normalized[mapped] === true : false
}

/** Default grant shape for sysadmin bootstrap (explicit, not from FstStore). */
export function defaultWarehouseCapabilities(partial = {}) {
  const out = {
    [G2_CAPS.READ]: partial[G2_CAPS.READ] !== false && partial.canViewWarehouse !== false,
    [G2_CAPS.DRAFT_EDIT]:
      partial[G2_CAPS.DRAFT_EDIT] === true || partial.canDraftEdit === true,
    [G2_CAPS.DOCUMENT_POST]:
      partial[G2_CAPS.DOCUMENT_POST] === true || partial.canPostWarehouseDocument === true,
    [G2_CAPS.TRANSFER_POST]: partial[G2_CAPS.TRANSFER_POST] === true,
    [G2_CAPS.INVENTORY_POST]: partial[G2_CAPS.INVENTORY_POST] === true,
    [G2_CAPS.OPENING_ACTIVATE]: partial[G2_CAPS.OPENING_ACTIVATE] === true,
    [G2_CAPS.DOCUMENT_CANCEL]:
      partial[G2_CAPS.DOCUMENT_CANCEL] === true || partial.canCancelWarehouseDocument === true,
    [G2_CAPS.PERIOD_CLOSE]: partial[G2_CAPS.PERIOD_CLOSE] === true,
    [G2_CAPS.PERIOD_REOPEN]: partial[G2_CAPS.PERIOD_REOPEN] === true,
  }
  // PHASE G3 — pass through production capabilities / line scopes explicitly granted.
  for (const [key, value] of Object.entries(partial)) {
    if (key.startsWith('production.') && value === true) out[key] = true
  }
  // PHASE G4 — packaging / QC / shipment capabilities
  for (const [key, value] of Object.entries(partial)) {
    if (
      (key.startsWith('packaging.') || key.startsWith('qc.') || key.startsWith('shipment.')) &&
      value === true
    ) {
      out[key] = true
    }
  }
  if (Array.isArray(partial.productionLineIds)) {
    out.productionLineIds = partial.productionLineIds.map(String)
  }
  if (Array.isArray(partial.warehouseIds)) {
    out.warehouseIds = partial.warehouseIds.map(String)
  }
  return out
}
