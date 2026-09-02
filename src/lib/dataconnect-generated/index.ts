/**
 * Hand-written SDK stub — заменится после `firebase dataconnect:sdk:generate`.
 */
import { queryRef, mutationRef, type DataConnect } from 'firebase/data-connect'
import { fstSqlConnectConfig as connectorConfig } from '../sqlconnect/config'

export { connectorConfig }

export type GetFstStoreData = {
  fstStore: {
    id: string
    revision: number
    payloadJson: string
    fingerprint: string | null
    updatedByUid: string | null
    updatedAt: string
  } | null
}

export type GetFstStoreMetaData = {
  fstStore: {
    id: string
    revision: number
    fingerprint: string | null
    updatedAt: string
  } | null
}

export function getFstStoreRef(dc: DataConnect, vars: { id: string }) {
  return queryRef(dc, 'GetFstStore', vars)
}

export function getFstStoreMetaRef(dc: DataConnect, vars: { id: string }) {
  return queryRef(dc, 'GetFstStoreMeta', vars)
}

export function createFstStoreRef(
  dc: DataConnect,
  vars: { id: string; payloadJson: string; fingerprint: string; updatedByUid: string },
) {
  return mutationRef(dc, 'CreateFstStore', vars)
}

export function updateFstStoreRef(
  dc: DataConnect,
  vars: {
    id: string
    expectedRevision: number
    revision: number
    payloadJson: string
    fingerprint: string
    updatedByUid: string
  },
) {
  return mutationRef(dc, 'UpdateFstStore', vars)
}
