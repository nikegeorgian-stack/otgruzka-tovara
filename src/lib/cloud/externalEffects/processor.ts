import type { AppStore } from '@/lib/types'
import type { AppUser } from '@/lib/access/types'
import type { TaskAttachment } from '@/lib/tasks/types'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import { findStableEntity } from '@/lib/cloud/dirtyOperations'
import { recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { isBulkOverwriteBlockingAutosave } from '@/lib/cloud/bulkStoreOverwrite'
import { isCloudWriteLifecycleReady } from '@/lib/cloud/syncLifecycle'
import { appendAudit } from '@/lib/audit'
import { normalizeAccessStore } from '@/lib/access/init'
import { normalizeTasksStore } from '@/lib/tasks/init'
import type { ExternalEffectsAdapters } from './adapters'
import { getExternalEffectsAdapters } from './adapters'
import {
  activeOutboxItems,
  createOutboxItem,
  entityMatchesOutbox,
  getExternalEffects,
  isEntityAbsentFromStore,
  outboxRetryDelayMs,
  patchOutboxItem,
  upsertOutboxItem,
} from './outbox'
import { assertExternalDeletionRuntime } from './runtime'
import type { ExternalEffectOutboxItem } from './types'

export type ExternalEffectsProcessorContext = {
  getStore: () => AppStore
  getBaselineStore: () => AppStore | null
  getPendingOps: () => DirtyOperation[]
  applyStore: (fn: (s: AppStore) => AppStore, origin: 'user' | 'system') => void
  scheduleSave: () => void
  adapters?: ExternalEffectsAdapters
  isSysAdmin: boolean
  canManageTasks: boolean
  actor?: { id?: string; name?: string }
}

function hasPendingForItem(pending: DirtyOperation[], item: ExternalEffectOutboxItem): boolean {
  return pending.some(
    (op) =>
      (op.domain === 'externalEffects.outbox' && op.entityId === item.id) ||
      (op.domain === item.relatedDomain && op.entityId === item.relatedEntityId),
  )
}

function findBaselineOutboxItem(
  baseline: AppStore,
  operationId: string,
): ExternalEffectOutboxItem | undefined {
  return getExternalEffects(baseline).outbox.find((o) => o.operationId === operationId)
}

function isInitialSqlAcked(
  item: ExternalEffectOutboxItem,
  baseline: AppStore,
  pending: DirtyOperation[],
): boolean {
  const baseItem = findBaselineOutboxItem(baseline, item.operationId)
  if (!baseItem || baseItem.step !== 'await_initial_sql') return false
  return !hasPendingForItem(pending, item)
}

function isFinalSqlAcked(
  item: ExternalEffectOutboxItem,
  baseline: AppStore,
  pending: DirtyOperation[],
): boolean {
  if (item.step !== 'await_final_sql') return false
  if (!isEntityAbsentFromStore(baseline, item.relatedDomain, item.relatedEntityId)) return false
  return !hasPendingForItem(pending, item)
}

function pickNextItem(
  items: ExternalEffectOutboxItem[],
  baseline: AppStore,
  pending: DirtyOperation[],
): ExternalEffectOutboxItem | null {
  for (const item of items) {
    if (item.status === 'processing') continue
    if (item.status === 'failed') {
      if (item.lastAttemptAt) {
        const elapsed = Date.now() - new Date(item.lastAttemptAt).getTime()
        if (elapsed < outboxRetryDelayMs(item.attempts)) continue
      }
    }
    if (item.step === 'await_initial_sql' && isInitialSqlAcked(item, baseline, pending)) {
      return item
    }
    if (item.step === 'await_final_sql' && isFinalSqlAcked(item, baseline, pending)) {
      return item
    }
  }
  return null
}

function staleItem(
  store: AppStore,
  item: ExternalEffectOutboxItem,
): boolean {
  const entity = findStableEntity(store, item.relatedDomain, item.relatedEntityId) as
    | (AppUser & TaskAttachment)
    | undefined
  if (item.step === 'await_initial_sql' || item.step === 'await_external') {
    return !entityMatchesOutbox(entity, item)
  }
  return false
}

async function runAuthPhaseB(
  ctx: ExternalEffectsProcessorContext,
  item: ExternalEffectOutboxItem,
  store: AppStore,
  adapters: ExternalEffectsAdapters,
): Promise<boolean> {
  const access = normalizeAccessStore(store.access)
  const user = access.users.find((u) => u.id === item.relatedEntityId)
  if (!user || !entityMatchesOutbox(user, item)) return false

  ctx.applyStore(
    (s) =>
      patchOutboxItem(s, item.operationId, {
        status: 'processing',
        step: 'await_external',
        lastAttemptAt: new Date().toISOString(),
        attempts: item.attempts + 1,
      }),
    'system',
  )

  try {
    await adapters.syncAllowlist(normalizeAccessStore(ctx.getStore().access))
  } catch (err) {
    console.error('FST: allowlist sync before auth delete failed', err)
  }

  const result = await adapters.deleteAuthUser(item.targetId)
  if (!result.ok) {
    ctx.applyStore(
      (s) =>
        patchOutboxItem(s, item.operationId, {
          status: 'failed',
          step: 'await_initial_sql',
          lastErrorCode: result.error,
          lastAttemptAt: new Date().toISOString(),
        }),
      'user',
    )
    ctx.scheduleSave()
    return true
  }

  recordSliceExplicitDelete('access.users', item.relatedEntityId, {
    actorId: ctx.actor?.id,
    actorName: ctx.actor?.name,
  })
  ctx.applyStore((s) => {
    const acc = normalizeAccessStore(s.access)
    const target = acc.users.find((u) => u.id === item.relatedEntityId)
    if (!target) return s
    let next: AppStore = {
      ...s,
      access: {
        ...acc,
        users: acc.users.filter((u) => u.id !== item.relatedEntityId),
      },
    }
    next = patchOutboxItem(next, item.operationId, {
      status: 'pending',
      step: 'await_final_sql',
      lastErrorCode: undefined,
    })
    next = appendAudit(next, {
      action: 'user_remove',
      detail: `${target.displayName} (${target.login}) · ${target.roleId}`,
      by: ctx.actor?.id,
      byName: ctx.actor?.name,
    })
    return next
  }, 'user')
  ctx.scheduleSave()
  return true
}

async function runStoragePhaseB(
  ctx: ExternalEffectsProcessorContext,
  item: ExternalEffectOutboxItem,
  store: AppStore,
  adapters: ExternalEffectsAdapters,
): Promise<boolean> {
  const tasks = normalizeTasksStore(store.tasks)
  const att = tasks.attachments.find((a) => a.id === item.relatedEntityId)
  if (!att || !entityMatchesOutbox(att, item)) return false

  ctx.applyStore(
    (s) =>
      patchOutboxItem(s, item.operationId, {
        status: 'processing',
        step: 'await_external',
        lastAttemptAt: new Date().toISOString(),
        attempts: item.attempts + 1,
      }),
    'system',
  )

  const result = await adapters.deleteStorageObject(item.targetId)
  if (!result.ok) {
    ctx.applyStore(
      (s) =>
        patchOutboxItem(s, item.operationId, {
          status: 'failed',
          step: 'await_initial_sql',
          lastErrorCode: result.error,
          lastAttemptAt: new Date().toISOString(),
        }),
      'user',
    )
    ctx.scheduleSave()
    return true
  }

  recordSliceExplicitDelete('tasks.attachments', item.relatedEntityId, {
    actorId: ctx.actor?.id,
    actorName: ctx.actor?.name,
  })
  ctx.applyStore((s) => {
    const tasks = normalizeTasksStore(s.tasks)
    const att = tasks.attachments.find((a) => a.id === item.relatedEntityId)
    const task = att ? tasks.tasks.find((t) => t.id === att.taskId) : undefined
    if (!att || !task) return s
    let next: AppStore = {
      ...s,
      tasks: {
        ...tasks,
        attachments: tasks.attachments.filter((a) => a.id !== item.relatedEntityId),
        tasks: tasks.tasks.map((t) =>
          t.id === att.taskId
            ? {
                ...t,
                attachmentIds: (t.attachmentIds ?? []).filter((id) => id !== item.relatedEntityId),
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      },
    }
    next = patchOutboxItem(next, item.operationId, {
      status: 'pending',
      step: 'await_final_sql',
      lastErrorCode: undefined,
    })
    next = appendAudit(next, {
      action: 'task_attach_remove',
      detail: `${task.number ?? task.title}: ${att.fileName}`,
      by: ctx.actor?.id,
      byName: ctx.actor?.name,
    })
    return next
  }, 'user')
  ctx.scheduleSave()
  return true
}

function completeOutboxItem(ctx: ExternalEffectsProcessorContext, item: ExternalEffectOutboxItem): void {
  ctx.applyStore(
    (s) =>
      patchOutboxItem(s, item.operationId, {
        status: 'completed',
        step: 'completed',
        lastErrorCode: undefined,
      }),
    'user',
  )
  ctx.scheduleSave()
}

/** Process at most one outbox item per invocation. Returns true if work was done or attempted. */
export async function processExternalEffectsOutbox(
  ctx: ExternalEffectsProcessorContext,
): Promise<boolean> {
  if (!isCloudWriteLifecycleReady()) return false
  if (isBulkOverwriteBlockingAutosave()) return false

  const baseline = ctx.getBaselineStore()
  if (!baseline) return false

  const store = ctx.getStore()
  const pending = ctx.getPendingOps()
  const items = activeOutboxItems(store)
  if (!items.length) return false

  const item = pickNextItem(items, baseline, pending)
  if (!item) return false

  if (staleItem(store, item)) {
    ctx.applyStore(
      (s) =>
        patchOutboxItem(s, item.operationId, {
          status: 'failed',
          lastErrorCode: 'stale_entity',
          lastAttemptAt: new Date().toISOString(),
        }),
      'user',
    )
    ctx.scheduleSave()
    return true
  }

  if (item.kind === 'auth-user-delete' && !ctx.isSysAdmin) return false
  if (item.kind === 'storage-object-delete' && !ctx.canManageTasks && !ctx.isSysAdmin) {
    return false
  }

  const adapters = ctx.adapters ?? getExternalEffectsAdapters()

  if (item.step === 'await_final_sql') {
    completeOutboxItem(ctx, item)
    return true
  }

  if (item.kind === 'auth-user-delete') {
    return runAuthPhaseB(ctx, item, store, adapters)
  }
  if (item.kind === 'storage-object-delete') {
    return runStoragePhaseB(ctx, item, store, adapters)
  }
  return false
}

/** Phase A — mark entity pending deletion and enqueue outbox (no external calls). */
export function beginAuthUserDeletion(
  store: AppStore,
  input: {
    userId: string
    email: string
    requestedBy?: string
    requestedByName?: string
  },
): { store: AppStore; operationId: string } {
  assertExternalDeletionRuntime()
  const operationId = createOutboxItem({
    kind: 'auth-user-delete',
    targetId: input.email.trim().toLowerCase(),
    relatedDomain: 'access.users',
    relatedEntityId: input.userId,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
  }).operationId

  const item = createOutboxItem({
    kind: 'auth-user-delete',
    targetId: input.email.trim().toLowerCase(),
    relatedDomain: 'access.users',
    relatedEntityId: input.userId,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    operationId,
  })

  const access = normalizeAccessStore(store.access)
  const now = new Date().toISOString()
  let next: AppStore = {
    ...store,
    access: {
      ...access,
      users: access.users.map((u) =>
        u.id === input.userId
          ? {
              ...u,
              active: false,
              pendingDeletion: true,
              externalEffectOperationId: operationId,
              updatedAt: now,
            }
          : u,
      ),
    },
  }
  next = upsertOutboxItem(next, item)
  return { store: next, operationId }
}

export function beginStorageAttachmentDeletion(
  store: AppStore,
  input: {
    attachmentId: string
    storagePath: string
    requestedBy?: string
    requestedByName?: string
  },
): { store: AppStore; operationId: string } {
  assertExternalDeletionRuntime()
  const operationId = createOutboxItem({
    kind: 'storage-object-delete',
    targetId: input.storagePath,
    relatedDomain: 'tasks.attachments',
    relatedEntityId: input.attachmentId,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
  }).operationId

  const item = createOutboxItem({
    kind: 'storage-object-delete',
    targetId: input.storagePath,
    relatedDomain: 'tasks.attachments',
    relatedEntityId: input.attachmentId,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    operationId,
  })

  const tasks = normalizeTasksStore(store.tasks)
  let next: AppStore = {
    ...store,
    tasks: {
      ...tasks,
      attachments: tasks.attachments.map((a) =>
        a.id === input.attachmentId
          ? {
              ...a,
              pendingDeletion: true,
              externalEffectOperationId: operationId,
            }
          : a,
      ),
    },
  }
  next = upsertOutboxItem(next, item)
  return { store: next, operationId }
}

export function retryExternalEffectOperation(store: AppStore, operationId: string): AppStore {
  return patchOutboxItem(store, operationId, {
    status: 'pending',
    step: 'await_initial_sql',
    lastErrorCode: undefined,
  })
}
