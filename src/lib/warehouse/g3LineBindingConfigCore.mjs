/** Pure staging line-binding validation shared by the web client and G3 server. */

export const LINE_BINDING_CONFIG_STAGING_ONLY =
  'production_line_binding_config_staging_only'
export const LINE_BINDING_CONFIG_INPUT_INVALID =
  'production_line_binding_config_input_invalid'
export const LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND =
  'production_line_binding_config_warehouse_not_found'
export const LINE_BINDING_CONFIG_LOCATION_NOT_FOUND =
  'production_line_binding_config_location_not_found'
export const LINE_BINDING_CONFIG_LOCATION_AMBIGUOUS =
  'production_line_binding_config_location_ambiguous'
export const LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND =
  'production_line_binding_config_accounting_not_found'
export const LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS =
  'production_line_binding_config_accounting_ambiguous'
export const LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE =
  'production_line_binding_config_accounting_inactive'
export const LINE_BINDING_CONFIG_LINE_AMBIGUOUS =
  'production_line_binding_config_line_ambiguous'
export const LINE_BINDING_CONFIG_ID_CONFLICT =
  'production_line_binding_config_id_conflict'
export const LINE_BINDING_CONFIG_ACK_MISMATCH =
  'production_line_binding_config_ack_mismatch'

function text(value) {
  return String(value ?? '').trim()
}

function canonical(input) {
  return {
    lineId: text(input?.lineId),
    productionWarehouseId: text(input?.productionWarehouseId),
    productionLocationId: text(input?.productionLocationId),
    note: text(input?.note),
  }
}

export function canonicalProductionLineBindingPayload(input) {
  return JSON.stringify(canonical(input))
}

/**
 * Browser-safe, collision-free command identity. This is the encoded canonical
 * payload, not a short checksum. The authoritative server separately stores a
 * SHA-256 fingerprint.
 */
export function productionLineBindingFingerprint(input) {
  return `line-binding-command:v1:${encodeURIComponent(
    canonicalProductionLineBindingPayload(input),
  )}`
}

/** Recompute the authoritative server fingerprint in browsers before mirroring. */
export async function authoritativeProductionLineBindingFingerprint(input) {
  try {
    const bytes = new TextEncoder().encode(canonicalProductionLineBindingPayload(input))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    return `line-binding:v2:${hex}`
  } catch {
    return null
  }
}

function matchingBindings(bindings, lineId) {
  return bindings.filter((row) => {
    const canonicalLineId = text(row?.lineId)
    return canonicalLineId ? canonicalLineId === lineId : text(row?.id) === lineId
  })
}

function exactRowsById(rows, id) {
  return rows.filter((row) => text(row?.id) === id)
}

export function applyProductionLineBindingConfig(
  warehouse,
  command,
  actor,
  now,
  options = {},
) {
  const requested = canonical(command)
  if (
    !requested.lineId ||
    !requested.productionWarehouseId ||
    !requested.productionLocationId
  ) {
    return { ok: false, error: LINE_BINDING_CONFIG_INPUT_INVALID, status: 400 }
  }

  const locations = Array.isArray(warehouse?.locations) ? warehouse.locations : []
  const warehouseRows = exactRowsById(locations, requested.productionWarehouseId)
  const locationRows = exactRowsById(locations, requested.productionLocationId)
  if (warehouseRows.length === 0 || warehouseRows[0]?.active === false) {
    return { ok: false, error: LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND, status: 409 }
  }
  if (locationRows.length === 0 || locationRows[0]?.active === false) {
    return { ok: false, error: LINE_BINDING_CONFIG_LOCATION_NOT_FOUND, status: 409 }
  }
  if (warehouseRows.length !== 1 || locationRows.length !== 1) {
    return { ok: false, error: LINE_BINDING_CONFIG_LOCATION_AMBIGUOUS, status: 409 }
  }
  const accountingRows = (Array.isArray(warehouse?.accountingByWarehouse)
    ? warehouse.accountingByWarehouse
    : []
  ).filter(
    (row) => text(row?.warehouseId) === requested.productionWarehouseId,
  )
  if (accountingRows.length === 0) {
    return { ok: false, error: LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND, status: 409 }
  }
  if (accountingRows.length !== 1) {
    return { ok: false, error: LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS, status: 409 }
  }
  if (accountingRows[0]?.status !== 'active') {
    return { ok: false, error: LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE, status: 409 }
  }

  const bindings = Array.isArray(warehouse?.productionLineBindings)
    ? warehouse.productionLineBindings
    : []
  const matches = matchingBindings(bindings, requested.lineId)
  if (matches.length > 1) {
    return { ok: false, error: LINE_BINDING_CONFIG_LINE_AMBIGUOUS, status: 409 }
  }
  const existing = matches[0]
  const bindingId = text(existing?.id) || requested.lineId
  if (
    bindings.some(
      (row) =>
        row !== existing &&
        text(row?.id) === bindingId &&
        text(row?.lineId) !== requested.lineId,
    )
  ) {
    return { ok: false, error: LINE_BINDING_CONFIG_ID_CONFLICT, status: 409 }
  }

  const fingerprint =
    typeof options?.fingerprint === 'function'
      ? options.fingerprint
      : productionLineBindingFingerprint
  const bindingFingerprint = fingerprint(requested)
  const previousBindingFingerprint = existing
    ? fingerprint(existing)
    : undefined
  const unchanged =
    existing &&
    text(existing.lineId || existing.id) === requested.lineId &&
    text(existing.productionWarehouseId ?? existing.sourceWarehouseId) ===
      requested.productionWarehouseId &&
    text(existing.productionLocationId) === requested.productionLocationId &&
    text(existing.note) === requested.note &&
    text(existing.configurationFingerprint) === bindingFingerprint
  if (unchanged) {
    return {
      ok: true,
      warehouse,
      binding: existing,
      bindingId,
      bindingFingerprint,
      previousBindingFingerprint,
      idempotent: true,
    }
  }

  const binding = {
    ...(existing ?? {}),
    id: bindingId,
    lineId: requested.lineId,
    productionWarehouseId: requested.productionWarehouseId,
    productionLocationId: requested.productionLocationId,
    note: requested.note || undefined,
    configurationFingerprint: bindingFingerprint,
    updatedAt: text(now),
    updatedBy: text(actor?.uid),
    createdAt: existing?.createdAt ?? text(now),
    createdBy: existing?.createdBy ?? text(actor?.uid),
  }
  const nextBindings = existing
    ? bindings.map((row) => (row === existing ? binding : row))
    : [...bindings, binding]
  return {
    ok: true,
    warehouse: { ...warehouse, productionLineBindings: nextBindings },
    binding,
    bindingId,
    bindingFingerprint,
    previousBindingFingerprint,
    idempotent: false,
  }
}

export async function validateProductionLineBindingAck(data, expected, options = {}) {
  const wanted = canonical(expected)
  const authoritativeFingerprint = text(data?.bindingFingerprint)
  const recomputedFingerprint = await authoritativeProductionLineBindingFingerprint(wanted)
  const criticalRevision = Number(data?.criticalRevision)
  const previousCriticalRevision = Number(options?.previousCriticalRevision) || 0
  const idempotent = data?.idempotent === true
  const bindings = Array.isArray(data?.warehouse?.productionLineBindings)
    ? data.warehouse.productionLineBindings
    : []
  const matches = matchingBindings(bindings, wanted.lineId)
  const binding = matches[0]
  if (
    !Number.isInteger(criticalRevision) ||
    criticalRevision <= 0 ||
    criticalRevision < previousCriticalRevision ||
    (criticalRevision === previousCriticalRevision && !idempotent) ||
    text(data?.lineId) !== wanted.lineId ||
    text(data?.bindingId) !== text(binding?.id) ||
    text(data?.productionWarehouseId) !== wanted.productionWarehouseId ||
    text(data?.productionLocationId) !== wanted.productionLocationId ||
    !recomputedFingerprint ||
    authoritativeFingerprint !== recomputedFingerprint ||
    text(data?.note) !== wanted.note ||
    matches.length !== 1 ||
    text(binding?.lineId || binding?.id) !== wanted.lineId ||
    text(binding?.productionWarehouseId ?? binding?.sourceWarehouseId) !==
      wanted.productionWarehouseId ||
    text(binding?.productionLocationId) !== wanted.productionLocationId ||
    text(binding?.note) !== wanted.note ||
    text(binding?.configurationFingerprint) !== authoritativeFingerprint ||
    data?.production == null ||
    typeof data.production !== 'object'
  ) {
    return { ok: false, error: LINE_BINDING_CONFIG_ACK_MISMATCH }
  }
  return {
    ok: true,
    binding,
    bindingFingerprint: authoritativeFingerprint,
    criticalRevision,
    idempotent,
  }
}
