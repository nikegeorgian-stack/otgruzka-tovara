import type { StoreSliceDeps } from '../storeApi'

/** Поля исполнителя для appendAudit из текущей учётки. */
export function actorAuditFields(getActor: StoreSliceDeps['getActor']): {
  by?: string
  byName?: string
} {
  const a = getActor?.() ?? null
  return { by: a?.id, byName: a?.name }
}
