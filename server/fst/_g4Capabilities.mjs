/**
 * PHASE G4 — deny-by-default packaging / QC / shipment capabilities.
 * Canonical ACL = FstPrincipalAccess.capabilitiesJson (never AppStore roleId / QcPermission alone).
 */

export const G4_CAPS = Object.freeze({
  PACKAGING_READ: 'packaging.read',
  PACKAGING_REPORT_EDIT: 'packaging.report.edit',
  PACKAGING_REPORT_CONFIRM: 'packaging.report.confirm',
  PACKAGING_REPORT_CORRECT: 'packaging.report.correct',
  QC_ATTACHMENT_UPLOAD: 'qc.attachment.upload',
  QC_REVIEW: 'qc.review',
  QC_RELEASE: 'qc.release',
  QC_REGRADE: 'qc.regrade',
  QC_REJECT: 'qc.reject',
  QC_SCRAP_WRITEOFF: 'qc.scrap.writeoff',
  SHIPMENT_DRAFT_EDIT: 'shipment.draft.edit',
  SHIPMENT_POST: 'shipment.post',
  SHIPMENT_CANCEL: 'shipment.cancel',
})

/** Map legacy P1C.3 QcPermission flags → G4 capability keys. */
export const QC_PERMISSION_TO_G4 = Object.freeze({
  canView: G4_CAPS.PACKAGING_READ,
  canUpload: G4_CAPS.QC_ATTACHMENT_UPLOAD,
  canRelease: G4_CAPS.QC_RELEASE,
  canRegrade: G4_CAPS.QC_REGRADE,
  canReject: G4_CAPS.QC_REJECT,
  canPostShipment: G4_CAPS.SHIPMENT_POST,
})

export function defaultPackagingQcCapabilities(partial = {}) {
  const out = {}
  for (const key of Object.values(G4_CAPS)) {
    out[key] = partial[key] === true
  }
  if (Array.isArray(partial.productionLineIds)) {
    out.productionLineIds = partial.productionLineIds.map(String)
  }
  if (Array.isArray(partial.warehouseIds)) {
    out.warehouseIds = partial.warehouseIds.map(String)
  }
  if (Array.isArray(partial.scopes?.productionLineIds)) {
    out.productionLineIds = partial.scopes.productionLineIds.map(String)
  }
  if (Array.isArray(partial.scopes?.warehouseIds)) {
    out.warehouseIds = partial.scopes.warehouseIds.map(String)
  }
  return out
}

export function parseWarehouseScope(caps) {
  const raw = caps?.warehouseIds ?? caps?.scopes?.warehouseIds
  if (!Array.isArray(raw)) return []
  return raw.map((id) => String(id).trim()).filter(Boolean)
}

export function hasWarehouseScope(caps, warehouseId) {
  const allowed = parseWarehouseScope(caps)
  if (allowed.length === 0) return true // unset = store-wide when capability granted
  if (allowed.includes('*')) return true
  return allowed.includes(String(warehouseId ?? '').trim())
}
