/**
 * PHASE G3 — deny-by-default production capabilities + line scopes.
 * Never trust roleId / workshopMasterProductionLines from FstStore.payloadJson.
 */

export const G3_CAPS = Object.freeze({
  READ: 'production.read',
  RECIPE_DRAFT_EDIT: 'production.recipe.draft.edit',
  RECIPE_APPROVE: 'production.recipe.approve',
  ORDER_EDIT: 'production.order.edit',
  ORDER_CONFIRM: 'production.order.confirm',
  ORDER_CANCEL: 'production.order.cancel',
  ORDER_PACKAGING_BOM_SNAPSHOT_MIGRATE: 'production.order.packagingBomSnapshot.migrate',
  RESERVATION_REALLOCATE: 'production.reservation.reallocate',
  MATERIAL_ISSUE: 'production.material.issue',
  MATERIAL_RETURN: 'production.material.return',
  IMPREGNATION_QC_DECIDE: 'production.impregnationQc.decide',
  LINE_BINDING_CONFIGURE: 'production.lineBinding.configure',
  SHIFT_EDIT: 'production.shift.edit',
  SHIFT_CONFIRM: 'production.shift.confirm',
  SHIFT_CORRECT: 'production.shift.correct',
  /** R2.9L — authoritative keeper line post (WH + WIP; pack also FG QC lot). */
  REQUEST_POST: 'production.request.post',
})

export function parseLineScope(caps) {
  const raw = caps?.productionLineIds ?? caps?.scopes?.productionLineIds
  if (!Array.isArray(raw)) return []
  return raw.map((id) => String(id).trim()).filter(Boolean)
}

export function hasLineScope(caps, lineId) {
  const allowed = parseLineScope(caps)
  if (allowed.length === 0) return false
  if (allowed.includes('*')) return true
  return allowed.includes(String(lineId ?? '').trim())
}

export function defaultProductionCapabilities(partial = {}) {
  const out = {}
  for (const key of Object.values(G3_CAPS)) {
    out[key] = partial[key] === true
  }
  if (Array.isArray(partial.productionLineIds)) {
    out.productionLineIds = partial.productionLineIds.map(String)
  }
  return out
}
