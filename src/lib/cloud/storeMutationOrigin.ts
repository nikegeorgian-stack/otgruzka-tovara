/** Tracks why the AppStore is mutating. Prefer explicit origin args over ambient stack. */

export type StoreMutationOrigin =
  | 'user'
  | 'system'
  | 'hydration'
  | 'pull'
  | 'merge'
  | 'seed'
  | 'import'
  | 'restore'
  | 'reset'
  | 'clear_months'

export type StoreUpdateMeta = {
  origin: StoreMutationOrigin
  /** PHASE W0.6 — explicit atomic transaction group (warehouse business ops). */
  transactionGroupId?: string
  transactionGroupKind?: string
  transactionGroupLabel?: string
  /** When true with transactionGroupId, all dirty ops from this setStore are one atomic group. */
  atomic?: boolean
}

const NON_USER = new Set<StoreMutationOrigin>([
  'hydration',
  'pull',
  'merge',
  'seed',
  'system',
  'import',
  'restore',
  'reset',
  'clear_months',
])

/** Ambient stack — only for sync call sites that cannot yet pass meta; never rely across await/startTransition. */
let stack: StoreMutationOrigin[] = ['user']

export function getStoreMutationOrigin(): StoreMutationOrigin {
  return stack[stack.length - 1] ?? 'user'
}

export function isUserMutationOrigin(origin: StoreMutationOrigin): boolean {
  return origin === 'user'
}

export function shouldTrackDirtyOps(origin: StoreMutationOrigin): boolean {
  return origin === 'user'
}

export function isBulkPreviewOrigin(origin: StoreMutationOrigin): boolean {
  return (
    origin === 'import' ||
    origin === 'restore' ||
    origin === 'reset' ||
    origin === 'clear_months'
  )
}

export function runWithStoreOrigin<T>(origin: StoreMutationOrigin, fn: () => T): T {
  stack.push(origin)
  try {
    return fn()
  } finally {
    stack.pop()
  }
}

export function resetStoreMutationOrigin(): void {
  stack = ['user']
}

export { NON_USER as NON_USER_ORIGINS }
