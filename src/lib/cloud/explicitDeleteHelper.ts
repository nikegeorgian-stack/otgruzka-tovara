import {
  cloudDirtyTracker,
  findStableEntity,
  recordExplicitDelete,
} from './dirtyOperations'

export type ExplicitDeleteActor = {
  actorId?: string
  actorName?: string
}

/** Record one explicit delete op from a slice action (before local mutation). */
export function recordSliceExplicitDelete(
  domain: string,
  entityId: string,
  actor?: ExplicitDeleteActor,
  baselineEntity?: unknown,
): void {
  if (!entityId) return
  const snap =
    baselineEntity !== undefined
      ? baselineEntity
      : findStableEntity(cloudDirtyTracker.getBaselineStore(), domain, entityId)
  recordExplicitDelete({
    domain,
    entityId,
    baseRevision: cloudDirtyTracker.getBaseRevision(),
    actorId: actor?.actorId,
    actorName: actor?.actorName,
    origin: 'user',
    baselineEntity: snap,
  })
}

export function actorFromGetter(
  getActor?: () => { id?: string; name?: string } | null,
): ExplicitDeleteActor {
  const a = getActor?.()
  return { actorId: a?.id, actorName: a?.name }
}
