/**
 * PHASE G1/G2 — architecture decision record (local reference; not a deploy gate).
 *
 * Chosen model: C — hybrid
 *   now: server-only FstCriticalStore + typed command gateway + FstPrincipalAccess
 *   later: normalize warehouse/production into SQL tables
 *
 * G2 expands warehouse-originated lifecycle to the gateway:
 *   draft / post / transfer / inventory / opening / daily issue / excel drafts /
 *   cancel(storno) / period close|reopen
 *
 * Remaining NOT authoritative (G3+): production reservations/handoff, shift/packaging,
 * recipes, QC, loading, procurement receive, sales reserve.
 */
export const G1_ARCHITECTURE = 'C_hybrid_server_critical_store' as const
export const G1_WAREHOUSE_VERTICAL_SLICE = 'READY_LOCAL' as const
export const G2_WAREHOUSE_ORIGINATED_COMMANDS = 'READY_LOCAL' as const
export const G1_GLOBAL_UPDATEFSTSTORE_SECURITY = 'BLOCK_UNTIL_ALL_CRITICAL_GATED' as const
export const G2_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
