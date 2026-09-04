import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { getAuthoritativeCriticalStore, requirePrincipalCapability } from './_g1WarehouseService.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    jsonError(res, 405, 'method_not_allowed')
    return
  }

  const auth = await verifyBearerToken(req)
  if (!auth.ok) {
    jsonError(res, auth.status, auth.error)
    return
  }

  const body = req.method === 'POST' ? await readJsonBody(req) : {}
  const storeId = String(body.storeId ?? req.query?.storeId ?? '').trim()
  if (!storeId) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const perm = await requirePrincipalCapability(auth.uid, storeId, 'canViewWarehouse')
  if (!perm.ok) {
    // Allow read if can post (implicit view)
    const post = await requirePrincipalCapability(auth.uid, storeId, 'canPostWarehouseDocument')
    if (!post.ok) {
      jsonError(res, perm.status ?? 403, perm.error)
      return
    }
  }

  const result = await getAuthoritativeCriticalStore(storeId)
  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, {
    ok: true,
    authoritative: true,
    id: result.id,
    revision: result.revision,
    warehouse: result.warehouse,
    source: 'fst_critical_store',
  })
}
