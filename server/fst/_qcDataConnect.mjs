import { getDataConnect } from 'firebase-admin/data-connect'
import { initFirebaseAdmin } from './_adminAuth.mjs'
import {
  connectorConfig,
  getLatestQcLotDecision,
  getQcAttachmentByIdempotency,
  getQcAttachmentRecord,
  getQcFinishedGoodsLot,
  getQcLotDecision,
  getQcLotDecisionByIdempotency,
  getQcPermissionById,
  getQcPermissionByUidStore,
  insertQcAttachmentRecord,
  insertQcLotDecision,
  listQcPermissionsForStore,
  listVerifiedLotAttachments,
  updateQcAttachmentRecord,
  updateQcFinishedGoodsLotShipped,
  upsertQcFinishedGoodsLot,
  upsertQcPermission,
} from '@fst/dataconnect-admin-generated'

function syncDataConnectEmulatorEnv() {
  const host = String(process.env.DATA_CONNECT_EMULATOR_HOST ?? '').trim()
  if (!host) return
  if (!process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST) {
    process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = host
  }
}

export function getQcDataConnect() {
  initFirebaseAdmin()
  syncDataConnectEmulatorEnv()
  return getDataConnect(connectorConfig)
}

export {
  connectorConfig,
  getLatestQcLotDecision,
  getQcAttachmentByIdempotency,
  getQcAttachmentRecord,
  getQcFinishedGoodsLot,
  getQcLotDecision,
  getQcLotDecisionByIdempotency,
  getQcPermissionById,
  getQcPermissionByUidStore,
  insertQcAttachmentRecord,
  insertQcLotDecision,
  listQcPermissionsForStore,
  listVerifiedLotAttachments,
  updateQcAttachmentRecord,
  updateQcFinishedGoodsLotShipped,
  upsertQcFinishedGoodsLot,
  upsertQcPermission,
}
