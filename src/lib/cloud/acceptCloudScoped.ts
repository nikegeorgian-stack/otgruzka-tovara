/**
 * Scoped «Accept cloud»: apply cloud only for conflicted entities/domains.
 * Unrelated local dirty state (e.g. PO ordered, other warehouse items) is preserved.
 * Empty / missing / malformed / stale scope → failure + unchanged local (never full remote replace).
 */
import type { AppStore } from '@/lib/types'
import type { EntityConflict } from './dirtyOperations'
import { findStableEntity } from './dirtyOperations'
import { isPersistentDomainKey } from './persistentDomains'
import { STABLE_ID_COLLECTION_PATHS, getPathValue } from './stableIdPaths'

function cloneStore(store: AppStore): AppStore {
  return JSON.parse(JSON.stringify(store)) as AppStore
}

function deepClone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function setPath(store: AppStore, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: Record<string, unknown> = store as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = value
}

function replaceEntityInArray(
  store: AppStore,
  domain: string,
  entityId: string,
  entity: unknown | undefined,
): void {
  const arr = getPathValue(store, domain)
  if (!Array.isArray(arr)) {
    if (entity !== undefined) setPath(store, domain, [entity])
    return
  }
  const next = arr.filter(
    (x) =>
      !(
        x &&
        typeof x === 'object' &&
        String((x as { id?: string }).id ?? '') === entityId
      ),
  )
  if (entity !== undefined && entity !== null) next.push(entity)
  setPath(store, domain, next)
}

export type AcceptCloudScopeFailure =
  | 'empty_scope'
  | 'missing_scope'
  | 'malformed_scope'
  | 'stale_scope'

export type AcceptCloudScopedResult =
  | { ok: true; store: AppStore }
  | { ok: false; reason: AcceptCloudScopeFailure; store: AppStore }

const STABLE = new Set<string>(STABLE_ID_COLLECTION_PATHS)

function isUsableConflict(c: unknown): c is EntityConflict {
  if (c == null || typeof c !== 'object') return false
  const row = c as Partial<EntityConflict>
  return (
    typeof row.domain === 'string' &&
    row.domain.trim().length > 0 &&
    typeof row.entityId === 'string' &&
    row.entityId.trim().length > 0
  )
}

function domainRoot(domain: string): string {
  return domain.split('.')[0] ?? domain
}

function isKnownAcceptDomain(domain: string): boolean {
  if (STABLE.has(domain) || domain.startsWith('trash.')) return true
  return isPersistentDomainKey(domainRoot(domain))
}

function resolveCloudEntity(
  remote: AppStore,
  c: EntityConflict,
): unknown | undefined {
  if (c.cloudSnapshot !== undefined) return c.cloudSnapshot
  return findStableEntity(remote, c.domain, c.entityId)
}

function validateScope(
  remote: AppStore,
  conflicts: unknown,
): AcceptCloudScopeFailure | null {
  if (conflicts == null) return 'missing_scope'
  if (!Array.isArray(conflicts)) return 'malformed_scope'
  if (conflicts.length === 0) return 'empty_scope'

  for (const c of conflicts) {
    if (!isUsableConflict(c)) return 'malformed_scope'
    if (!isKnownAcceptDomain(c.domain)) return 'malformed_scope'

    if (c.entityId === '*') {
      const pathVal = c.domain.includes('.')
        ? getPathValue(remote, c.domain)
        : (remote as unknown as Record<string, unknown>)[c.domain]
      if (pathVal === undefined) return 'stale_scope'
      continue
    }

    if (STABLE.has(c.domain) || c.domain.startsWith('trash.')) {
      if (resolveCloudEntity(remote, c) === undefined) return 'stale_scope'
    } else {
      const rv = (remote as unknown as Record<string, unknown>)[c.domain]
      if (rv === undefined) return 'stale_scope'
    }
  }
  return null
}

/**
 * Merge remote conflict resolutions into local without replacing the whole AppStore.
 * Requires a non-empty, well-formed, non-stale conflict scope — never implicit full remote replace.
 */
export function acceptCloudScopedMerge(
  local: AppStore,
  remote: AppStore,
  conflicts: EntityConflict[] | null | undefined,
): AcceptCloudScopedResult {
  const failure = validateScope(remote, conflicts)
  if (failure) {
    return { ok: false, reason: failure, store: cloneStore(local) }
  }

  const list = conflicts as EntityConflict[]
  const result = cloneStore(local)

  for (const c of list) {
    if (c.entityId === '*') {
      if (c.domain.includes('.')) {
        setPath(result, c.domain, deepClone(getPathValue(remote, c.domain)))
      } else {
        const rv = (remote as unknown as Record<string, unknown>)[c.domain]
        ;(result as unknown as Record<string, unknown>)[c.domain] = deepClone(rv)
      }
      continue
    }

    if (STABLE.has(c.domain) || c.domain.startsWith('trash.')) {
      const cloudEntity = resolveCloudEntity(remote, c)
      replaceEntityInArray(result, c.domain, c.entityId, deepClone(cloudEntity))
    } else {
      const rv = (remote as unknown as Record<string, unknown>)[c.domain]
      ;(result as unknown as Record<string, unknown>)[c.domain] = deepClone(rv)
    }
  }

  return { ok: true, store: result }
}
