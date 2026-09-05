/**
 * Catch-all Vercel function for /api/fst/* — preserves public URLs while
 * counting as a single serverless function (Hobby function-count limit).
 */
import clearMustChangePassword from '../../server/fst/clear-must-change-password.mjs'
import createUser from '../../server/fst/create-user.mjs'
import deleteUser from '../../server/fst/delete-user.mjs'
import g1AccessAdmin from '../../server/fst/g1-access-admin.mjs'
import g1DomainFreeze from '../../server/fst/g1-domain-freeze.mjs'
import g1WarehouseGet from '../../server/fst/g1-warehouse-get.mjs'
import g1WarehousePostDocument from '../../server/fst/g1-warehouse-post-document.mjs'
import g2WarehouseCommand from '../../server/fst/g2-warehouse-command.mjs'
import g3ProductionCommand from '../../server/fst/g3-production-command.mjs'
import g4ProductionCommand from '../../server/fst/g4-production-command.mjs'
import g5PlanningCommand from '../../server/fst/g5-planning-command.mjs'
import g6CapacityCommand from '../../server/fst/g6-capacity-command.mjs'
import listUsers from '../../server/fst/list-users.mjs'
import migrateCloudShards from '../../server/fst/migrate-cloud-shards.mjs'
import qcLotUpsert from '../../server/fst/qc-lot-upsert.mjs'
import qcPermissionsAdmin from '../../server/fst/qc-permissions-admin.mjs'
import qcPermissionsSelf from '../../server/fst/qc-permissions-self.mjs'
import qcRegrade from '../../server/fst/qc-regrade.mjs'
import qcReject from '../../server/fst/qc-reject.mjs'
import qcRelease from '../../server/fst/qc-release.mjs'
import qcShipment from '../../server/fst/qc-shipment.mjs'
import qcShipmentCancel from '../../server/fst/qc-shipment-cancel.mjs'
import qcUploadFinalize from '../../server/fst/qc-upload-finalize.mjs'
import qcUploadInitiate from '../../server/fst/qc-upload-initiate.mjs'
import qcUploadPut from '../../server/fst/qc-upload-put.mjs'
import sendPush from '../../server/fst/send-push.mjs'
import updateUser from '../../server/fst/update-user.mjs'

/** @type {Record<string, (req: any, res: any) => unknown>} */
export const FST_ROUTE_HANDLERS = {
  'clear-must-change-password': clearMustChangePassword,
  'create-user': createUser,
  'delete-user': deleteUser,
  'g1-access-admin': g1AccessAdmin,
  'g1-domain-freeze': g1DomainFreeze,
  'g1-warehouse-get': g1WarehouseGet,
  'g1-warehouse-post-document': g1WarehousePostDocument,
  'g2-warehouse-command': g2WarehouseCommand,
  'g3-production-command': g3ProductionCommand,
  'g4-production-command': g4ProductionCommand,
  'g5-planning-command': g5PlanningCommand,
  'g6-capacity-command': g6CapacityCommand,
  'list-users': listUsers,
  'migrate-cloud-shards': migrateCloudShards,
  'qc-lot-upsert': qcLotUpsert,
  'qc-permissions-admin': qcPermissionsAdmin,
  'qc-permissions-self': qcPermissionsSelf,
  'qc-regrade': qcRegrade,
  'qc-reject': qcReject,
  'qc-release': qcRelease,
  'qc-shipment': qcShipment,
  'qc-shipment-cancel': qcShipmentCancel,
  'qc-upload-finalize': qcUploadFinalize,
  'qc-upload-initiate': qcUploadInitiate,
  'qc-upload-put': qcUploadPut,
  'send-push': sendPush,
  'update-user': updateUser,
}

export function resolveFstRoutePath(queryPath) {
  if (Array.isArray(queryPath)) {
    if (queryPath.length !== 1) return null
    return String(queryPath[0] ?? '').trim() || null
  }
  if (queryPath == null) return null
  const raw = String(queryPath).trim()
  if (!raw || raw.includes('/')) return null
  return raw
}

/** Resolve single-segment FST route from Vercel query and/or request URL. */
export function resolveFstRouteFromRequest(req) {
  const fromQuery = resolveFstRoutePath(req?.query?.path)
  if (fromQuery) return fromQuery
  try {
    const pathname = new URL(String(req?.url || ''), 'http://localhost').pathname
    const parts = pathname.split('/').filter(Boolean)
    if (parts[0] === 'api' && parts[1] === 'fst' && parts.length === 3) return parts[2]
    // Some runtimes mount the catch-all so url is only the remainder.
    if (parts.length === 1) return parts[0]
  } catch {
    /* ignore */
  }
  return null
}

export default async function handler(req, res) {
  const route = resolveFstRouteFromRequest(req)
  if (!route) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const routeHandler = FST_ROUTE_HANDLERS[route]
  if (!routeHandler) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  return routeHandler(req, res)
}
