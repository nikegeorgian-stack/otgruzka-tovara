/** Persistent outbox for deferred Firebase Auth / Storage side effects. */

export type ExternalEffectKind = 'auth-user-delete' | 'storage-object-delete'

export type ExternalEffectStatus = 'pending' | 'processing' | 'failed' | 'completed'

/** Multi-phase deletion — external call only after SQL ack of prior step. */
export type ExternalEffectStep =
  | 'await_initial_sql'
  | 'await_external'
  | 'await_final_sql'
  | 'completed'

export type ExternalEffectOutboxItem = {
  /** Stable id — same as operationId. */
  id: string
  operationId: string
  kind: ExternalEffectKind
  /** Email (auth) or storage fullPath — no secrets. */
  targetId: string
  relatedDomain: string
  relatedEntityId: string
  status: ExternalEffectStatus
  step: ExternalEffectStep
  requestedBy?: string
  requestedByName?: string
  requestedAt: string
  attempts: number
  lastErrorCode?: string
  lastAttemptAt?: string
}

export type ExternalEffectsStore = {
  outbox: ExternalEffectOutboxItem[]
}

export type PendingDeletionEntity = {
  pendingDeletion?: boolean
  externalEffectOperationId?: string
}

export type ExternalEffectUiPhase =
  | 'await_save'
  | 'executing'
  | 'await_final_save'
  | 'failed'
  | 'completed'
