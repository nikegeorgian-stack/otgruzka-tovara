/**
 * PHASE G1/G2/G3/G3.1 — architecture decision record (local reference; not a deploy gate).
 *
 * Chosen model: C — hybrid
 *   now: server-only FstCriticalStore + typed command gateway + FstPrincipalAccess
 *   later: normalize warehouse/production into SQL tables
 *
 * G2: warehouse-originated lifecycle on gateway
 * G3: production recipes/orders/reserve/handoff/shift on SAME critical envelope + CAS
 * G3.1: per-domain activation (domainMeta.warehouse|production.active);
 *       CAS-embedded commandReceipts for idempotency fail-safe
 *
 * Remaining NOT authoritative (G4+): packaging/FG/QC, loading, procurement, sales reserve.
 */
export const G1_ARCHITECTURE = 'C_hybrid_server_critical_store' as const
export const G1_WAREHOUSE_VERTICAL_SLICE = 'READY_LOCAL' as const
export const G2_WAREHOUSE_ORIGINATED_COMMANDS = 'READY_LOCAL' as const
export const G3_PRODUCTION_CORE_COMMANDS = 'READY_LOCAL' as const
export const G31_CROSS_DOMAIN_ACTIVATION = 'READY_LOCAL' as const
export const G1_GLOBAL_UPDATEFSTSTORE_SECURITY = 'BLOCK_UNTIL_ALL_CRITICAL_GATED' as const
export const G2_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G3_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
