import type { AppStore } from '@/lib/types'
import type { ExternalEffectOutboxItem, ExternalEffectsStore } from './types'

export function createDefaultExternalEffectsStore(): ExternalEffectsStore {
  return { outbox: [] }
}

export function normalizeExternalEffectsStore(raw: unknown): ExternalEffectsStore {
  if (!raw || typeof raw !== 'object') return createDefaultExternalEffectsStore()
  const rec = raw as { outbox?: unknown }
  if (!Array.isArray(rec.outbox)) return createDefaultExternalEffectsStore()
  const outbox: ExternalEffectOutboxItem[] = []
  for (const row of rec.outbox) {
    if (!row || typeof row !== 'object') continue
    const item = row as Partial<ExternalEffectOutboxItem>
    if (
      typeof item.id !== 'string' ||
      typeof item.operationId !== 'string' ||
      typeof item.kind !== 'string' ||
      typeof item.targetId !== 'string' ||
      typeof item.relatedDomain !== 'string' ||
      typeof item.relatedEntityId !== 'string'
    ) {
      continue
    }
    if (item.kind !== 'auth-user-delete' && item.kind !== 'storage-object-delete') continue
    outbox.push({
      id: item.id,
      operationId: item.operationId,
      kind: item.kind,
      targetId: item.targetId,
      relatedDomain: item.relatedDomain,
      relatedEntityId: item.relatedEntityId,
      status: item.status ?? 'pending',
      step: item.step ?? 'await_initial_sql',
      requestedBy: item.requestedBy,
      requestedByName: item.requestedByName,
      requestedAt: item.requestedAt ?? new Date(0).toISOString(),
      attempts: typeof item.attempts === 'number' ? item.attempts : 0,
      lastErrorCode: item.lastErrorCode,
      lastAttemptAt: item.lastAttemptAt,
    })
  }
  return { outbox }
}

export function ensureExternalEffectsOnStore(store: AppStore): AppStore {
  const externalEffects = normalizeExternalEffectsStore(store.externalEffects)
  if (store.externalEffects === externalEffects) return store
  return { ...store, externalEffects }
}
