/**
 * PHASE G1/G2/G3/G3.1/G4/G4.1 — architecture decision record (local reference; not a deploy gate).
 *
 * Chosen model: C — hybrid
 *   now: server-only FstCriticalStore + typed command gateway + FstPrincipalAccess
 *   later: normalize warehouse/production into SQL tables
 *
 * G2: warehouse-originated lifecycle on gateway
 * G3: production recipes/orders/reserve/handoff/shift on SAME critical envelope + CAS
 * G3.1: per-domain activation (domainMeta.warehouse|production.active);
 *       CAS-embedded commandReceipts for idempotency fail-safe
 * G4: packaging / FG lots / QC decisions / loading shipments;
 *     feature flag domainMeta.production.features.packagingQc.active;
 *     QcAttachmentRecord = Storage metadata SoT; QcLotDecision/QcFinishedGoodsLot = projections
 * G4.1: exactly ONE ACL for packaging/QC = FstPrincipalAccess.capabilitiesJson.
 *     QcPermission is a DEPRECATED read-model projection: it is written for
 *     backwards compatibility but never authorizes a G4 command. While
 *     packagingQc.active is true the server ignores it entirely; while the flag
 *     is off it still serves the legacy P1C.3 endpoints. AppStore roleId /
 *     roleViews / webViews are never an ACL source at either stage.
 *     Legacy mutating QC endpoints answer `use_g4_gateway` (409) once the flag is on.
 *     SQL projections may lag; `reconcileQcProjectionsFromCritical` rebuilds them.
 *
 * Remaining NOT authoritative (G5+): sales orders, procurement/MRP, global masterdata CRUD.
 */
export const G1_ARCHITECTURE = 'C_hybrid_server_critical_store' as const
export const G1_WAREHOUSE_VERTICAL_SLICE = 'READY_LOCAL' as const
export const G2_WAREHOUSE_ORIGINATED_COMMANDS = 'READY_LOCAL' as const
export const G3_PRODUCTION_CORE_COMMANDS = 'READY_LOCAL' as const
export const G31_CROSS_DOMAIN_ACTIVATION = 'READY_LOCAL' as const
export const G4_PACKAGING_QC_SHIPMENT = 'READY_LOCAL' as const
export const G41_SINGLE_PACKAGING_QC_ACL = 'READY_LOCAL' as const
export const G1_GLOBAL_UPDATEFSTSTORE_SECURITY = 'BLOCK_UNTIL_ALL_CRITICAL_GATED' as const
export const G2_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G3_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G4_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
