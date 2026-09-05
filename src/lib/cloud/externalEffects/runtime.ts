/** External Auth/Storage deletion requires web SQL sync processor (FstSqlConnectSync). */

export const EXTERNAL_DELETION_WEB_ONLY = 'external_deletion_web_only' as const

export function isExternalDeletionRuntimeEnabled(): boolean {
  return import.meta.env.VITE_FST_WEB === 'true'
}

export function assertExternalDeletionRuntime(): void {
  if (!isExternalDeletionRuntimeEnabled()) {
    throw new Error(EXTERNAL_DELETION_WEB_ONLY)
  }
}
