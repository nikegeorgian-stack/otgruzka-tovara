import { verifySysAdminRequest } from './_adminAuth.mjs'
import { readJsonBody, jsonError, jsonOk } from './_qcHttp.mjs'
import { grantPermission, revokePermission } from './_qcService.mjs'

function normalizeFlags(flags) {
  if (!flags || typeof flags !== 'object') return {}
  return {
    canView: flags.canView === true,
    canUpload: flags.canUpload === true,
    canRelease: flags.canRelease === true,
    canRegrade: flags.canRegrade === true,
    canReject: flags.canReject === true,
    canPostShipment: flags.canPostShipment === true,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    jsonError(res, 405, 'method_not_allowed')
    return
  }

  const auth = await verifySysAdminRequest(req)
  if (!auth.ok) {
    jsonError(res, auth.status, auth.error)
    return
  }

  const body = await readJsonBody(req)
  const firebaseUid = String(body.firebaseUid ?? '').trim()
  const storeId = String(body.storeId ?? '').trim()
  const action = String(body.action ?? '').trim().toLowerCase()
  const flags = normalizeFlags(body.flags)
  if (!firebaseUid || !storeId || (action !== 'grant' && action !== 'revoke')) {
    jsonError(res, 400, 'invalid_input')
    return
  }
  if (action === 'revoke' && !String(body.reason ?? '').trim()) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const actor = { uid: auth.uid, email: auth.email, claims: auth.claims }
  const result =
    action === 'grant'
      ? await grantPermission({ actor, firebaseUid, storeId, flags, active: true })
      : await revokePermission({ actor, firebaseUid, storeId, reason: String(body.reason ?? '').trim() })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, permission: result.permission })
}
