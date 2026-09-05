import {
  getDataConnect,
  executeQuery,
  executeMutation,
  subscribe,
} from 'firebase/data-connect'
import {
  connectorConfig,
  createFstStoreRef,
  getFstStoreMetaRef,
  getFstStoreRef,
  updateFstStoreRef,
  type GetFstStoreData,
  type GetFstStoreMetaData,
} from '@/lib/dataconnect-generated'
import { cloudRefuseWipeUserMessage } from '@/lib/cloud/refuseStoreWipe'

export type FstStoreRow = NonNullable<GetFstStoreData['fstStore']>
export type FstStoreMetaRow = NonNullable<GetFstStoreMetaData['fstStore']>

function getDc() {
  return getDataConnect(connectorConfig)
}

export async function sqlGetFstStore(storeId: string): Promise<FstStoreRow | null> {
  const { data } = await executeQuery(getFstStoreRef(getDc(), { id: storeId }))
  return (data as GetFstStoreData).fstStore ?? null
}

export async function sqlGetFstStoreMeta(storeId: string): Promise<FstStoreMetaRow | null> {
  const { data } = await executeQuery(getFstStoreMetaRef(getDc(), { id: storeId }))
  return (data as GetFstStoreMetaData).fstStore ?? null
}

export async function sqlCreateFstStore(
  storeId: string,
  payloadJson: string,
  fingerprint: string,
  updatedByUid: string,
): Promise<void> {
  await executeMutation(
    createFstStoreRef(getDc(), {
      id: storeId,
      payloadJson,
      fingerprint,
      updatedByUid,
    }),
  )
}

export async function sqlUpdateFstStore(
  storeId: string,
  expectedRevision: number,
  nextRevision: number,
  payloadJson: string,
  fingerprint: string,
  updatedByUid: string,
): Promise<void> {
  await executeMutation(
    updateFstStoreRef(getDc(), {
      id: storeId,
      expectedRevision: Math.trunc(expectedRevision),
      revision: Math.trunc(nextRevision),
      payloadJson,
      fingerprint,
      updatedByUid,
    }),
  )
}

export function sqlSubscribeFstStoreMeta(
  storeId: string,
  onMeta: (meta: FstStoreMetaRow) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribe(
    getFstStoreMetaRef(getDc(), { id: storeId }),
    (res) => {
      const row = (res.data as GetFstStoreMetaData | undefined)?.fstStore
      if (row) onMeta(row)
    },
    (err: unknown) => onError?.(err),
  )
}

export function isSqlRevisionConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const hint = msg.toLowerCase()
  return (
    hint.includes('revision_conflict') ||
    hint.includes('failed precondition') ||
    hint.includes('aborted') ||
    hint.includes('check failed') ||
    hint.includes('precondition')
  )
}

export function sqlConnectErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('sql_shared_store_missing') || msg.includes('NOT_FOUND') || msg.includes('store_not_found')) {
    return 'Общая база SQL Connect не найдена. Нельзя подставить локальный seed — обратитесь к администратору (восстановление из бэкапа).'
  }
  const wipeHint = cloudRefuseWipeUserMessage(err, 'sql')
  if (wipeHint) return wipeHint
  if (isSqlRevisionConflict(err)) {
    return 'Конфликт версий — подтягиваем SQL и сохраняем снова.'
  }
  if (msg.includes('INVALID_ARGUMENT') && msg.toLowerCase().includes('expectedrevision')) {
    return 'Старая версия приложения — обновите страницу (Ctrl+F5) на обоих адресах.'
  }
  if (msg.length > 0 && msg.length < 160) return `${fallback} (${msg})`
  return fallback
}
