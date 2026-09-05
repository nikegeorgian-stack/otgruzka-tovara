import { verifyBearerToken, isFstSysadmin } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { grantPrincipalAccess, revokePrincipalAccess } from './_g1WarehouseService.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    jsonError(res, 405, 'method_not_allowed')
    return
  }

  const auth = await verifyBearerToken(req)
  if (!auth.ok) {
    jsonError(res, auth.status, auth.error)
    return
  }
  if (!isFstSysadmin(auth.claims)) {
    jsonError(res, 403, 'forbidden')
    return
  }

  const body = await readJsonBody(req)
  const action = String(body.action ?? '').trim()
  const actor = { uid: auth.uid, email: auth.email, claims: auth.claims }

  if (action === 'grant') {
    const result = await grantPrincipalAccess({
      actor,
      firebaseUid: body.firebaseUid,
      storeId: body.storeId,
      roleId: body.roleId,
      capabilities: body.capabilities,
      active: body.active,
    })
    if (!result.ok) {
      jsonError(res, result.status ?? 400, result.error)
      return
    }
    jsonOk(res, { ok: true, principal: result.principal })
    return
  }

  if (action === 'revoke') {
    const result = await revokePrincipalAccess({
      actor,
      firebaseUid: body.firebaseUid,
      storeId: body.storeId,
      reason: body.reason,
    })
    if (!result.ok) {
      jsonError(res, result.status ?? 400, result.error)
      return
    }
    jsonOk(res, { ok: true, principal: result.principal })
    return
  }

  jsonError(res, 400, 'invalid_action')
}
