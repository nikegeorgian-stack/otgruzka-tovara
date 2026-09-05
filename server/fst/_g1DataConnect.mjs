import { getDataConnect } from 'firebase-admin/data-connect'
import { initFirebaseAdmin } from './_adminAuth.mjs'
import { resolveAdminDataConnectConfig } from './_dataConnectRuntime.mjs'
import {
  connectorConfig,
  getFstCommandReceipt,
  getFstCriticalStore,
  getFstPrincipalAccessById,
  getFstPrincipalAccessByUidStore,
  insertFstCommandReceipt,
  updateFstCriticalStoreCas,
  upsertFstCriticalStore,
  upsertFstPrincipalAccess,
} from '@fst/dataconnect-admin-generated'

function syncDataConnectEmulatorEnv() {
  const host = String(process.env.DATA_CONNECT_EMULATOR_HOST ?? '').trim()
  if (!host) return
  if (!process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST) {
    process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = host
  }
}

export function getG1DataConnect() {
  initFirebaseAdmin()
  syncDataConnectEmulatorEnv()
  return getDataConnect(resolveAdminDataConnectConfig(connectorConfig))
}

export {
  connectorConfig,
  getFstCommandReceipt,
  getFstCriticalStore,
  getFstPrincipalAccessById,
  getFstPrincipalAccessByUidStore,
  insertFstCommandReceipt,
  updateFstCriticalStoreCas,
  upsertFstCriticalStore,
  upsertFstPrincipalAccess,
}
