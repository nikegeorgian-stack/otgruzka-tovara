/**
 * PHASE G1 — architecture decision record (local reference; not a deploy gate).
 *
 * Chosen model: C — hybrid
 *   now: server-only FstCriticalStore + typed command gateway + FstPrincipalAccess
 *   later: normalize warehouse/production into SQL tables
 *
 * Rejected A alone long-term: opaque blob still hard to query/index.
 * Rejected B now: too large for G1; risks timesheet/migration blast radius.
 *
 * Security boundary today:
 *   - Client UpdateFstStore (@auth USER) can still write legacy FstStore.payloadJson
 *     including forged warehouse — BUT read path overlays FstCriticalStore when revision>0.
 *   - Authoritative posts for receipt/issue go through /api/fst/g1-warehouse-post-document.
 *   - Remaining critical domains still LEGACY / NOT AUTHORITATIVE → GLOBAL flag stays BLOCK.
 */
export const G1_ARCHITECTURE = 'C_hybrid_server_critical_store' as const
export const G1_WAREHOUSE_VERTICAL_SLICE = 'READY_LOCAL' as const
export const G1_GLOBAL_UPDATEFSTSTORE_SECURITY = 'BLOCK_UNTIL_ALL_CRITICAL_GATED' as const
