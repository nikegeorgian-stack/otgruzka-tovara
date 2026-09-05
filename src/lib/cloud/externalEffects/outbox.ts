import type { AppStore } from '@/lib/types'
import { nextOperationId } from '@/lib/cloud/dirtyOperations'
import { findStableEntity } from '@/lib/cloud/dirtyOperations'
import type {
  ExternalEffectKind,
  ExternalEffectOutboxItem,
  ExternalEffectsStore,
  ExternalEffectUiPhase,
  PendingDeletionEntity,
} from './types'
import { normalizeExternalEffectsStore } from './init'

export function getExternalEffects(store: AppStore): ExternalEffectsStore {
  return normalizeExternalEffectsStore(store.externalEffects)
}

export function findOutboxItem(
  store: AppStore,
  operationId: string,
): ExternalEffectOutboxItem | undefined {
  return getExternalEffects(store).outbox.find((o) => o.operationId === operationId)
}

export function createOutboxItem(input: {
  kind: ExternalEffectKind
  targetId: string
  relatedDomain: string
  relatedEntityId: string
  requestedBy?: string
  requestedByName?: string
  operationId?: string
}): ExternalEffectOutboxItem {
  const operationId = input.operationId ?? nextOperationId()
  const now = new Date().toISOString()
  return {
    id: operationId,
    operationId,
    kind: input.kind,
    targetId: input.targetId,
    relatedDomain: input.relatedDomain,
    relatedEntityId: input.relatedEntityId,
    status: 'pending',
    step: 'await_initial_sql',
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    requestedAt: now,
    attempts: 0,
  }
}

export function upsertOutboxItem(
  store: AppStore,
  item: ExternalEffectOutboxItem,
): AppStore {
  const effects = getExternalEffects(store)
  const idx = effects.outbox.findIndex((o) => o.id === item.id)
  const outbox =
    idx >= 0
      ? effects.outbox.map((o, i) => (i === idx ? item : o))
      : [...effects.outbox, item]
  return { ...store, externalEffects: { outbox } }
}

export function patchOutboxItem(
  store: AppStore,
  operationId: string,
  patch: Partial<ExternalEffectOutboxItem>,
): AppStore {
  const effects = getExternalEffects(store)
  const idx = effects.outbox.findIndex((o) => o.operationId === operationId)
  if (idx < 0) return store
  const next = { ...effects.outbox[idx]!, ...patch }
  const outbox = effects.outbox.map((o, i) => (i === idx ? next : o))
  return { ...store, externalEffects: { outbox } }
}

export function activeOutboxItems(store: AppStore): ExternalEffectOutboxItem[] {
  return getExternalEffects(store).outbox.filter((o) => o.status !== 'completed')
}

export function hasPendingOutboxWork(store: AppStore): boolean {
  return activeOutboxItems(store).length > 0
}

export function entityMatchesOutbox(
  entity: PendingDeletionEntity | undefined,
  item: ExternalEffectOutboxItem,
): boolean {
  if (!entity?.pendingDeletion) return false
  return entity.externalEffectOperationId === item.operationId
}

export function isEntityAbsentFromStore(
  store: AppStore,
  domain: string,
  entityId: string,
): boolean {
  return findStableEntity(store, domain, entityId) === undefined
}

export function outboxUiPhase(
  item: ExternalEffectOutboxItem,
  entity: PendingDeletionEntity | undefined,
  baseline: AppStore | null,
): ExternalEffectUiPhase {
  if (item.status === 'completed' || item.step === 'completed') return 'completed'
  if (item.status === 'failed') return 'failed'
  if (item.step === 'await_initial_sql') return 'await_save'
  if (item.step === 'await_external') return 'executing'
  if (item.step === 'await_final_sql') {
    if (baseline && isEntityAbsentFromStore(baseline, item.relatedDomain, item.relatedEntityId)) {
      return 'completed'
    }
    return 'await_final_save'
  }
  if (entity?.pendingDeletion) {
    if (item.step === 'await_external' || item.status === 'processing') return 'executing'
    return 'await_save'
  }
  return 'await_final_save'
}

/** Max retry backoff cap (ms). */
export const OUTBOX_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000] as const

export function outboxRetryDelayMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 0), OUTBOX_BACKOFF_MS.length - 1)
  return OUTBOX_BACKOFF_MS[idx]!
}
