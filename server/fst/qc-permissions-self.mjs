import { getQcDataConnect, getQcPermissionByUidStore } from './_qcDataConnect.mjs'
import { readJsonBody, jsonError, jsonOk } from './_qcHttp.mjs'
import { verifyBearerToken } from './_qcAuth.mjs'

function readStoreId(req, body) {
  return String(body?.storeId ?? req?.query?.storeId ?? '').trim()
}

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
  const storeId = readStoreId(req, body)
  if (!storeId) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  try {
    const dc = getQcDataConnect()
    const { data } = await getQcPermissionByUidStore(dc, {
      firebaseUid: auth.uid,
      storeId,
    })
    jsonOk(res, {
      ok: true,
      storeId,
      firebaseUid: auth.uid,
      permission: data?.qcPermissions?.[0] ?? null,
    })
  } catch {
    jsonError(res, 500, 'query_failed')
  }
}
