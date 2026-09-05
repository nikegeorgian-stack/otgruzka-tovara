/**
 * PHASE G1/G2/G3/G3.1/G4/G4.1/G5 — architecture decision record (local reference; not a deploy gate).
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
 * G5: masterData + sales + planning(MRP) + procurement domains on same critical store;
 *     activation: domainMeta.masterData|salesPlanning|procurement.active (explicit commands only);
 *     salesPlanning gates both sales and planning; empty domain ≠ authoritative;
 *     AppStore finishedProducts/counterparties/sales/procurement blob not trusted after activation;
 *     name matching forbidden; G3 production confirm stays separate from MRP accept drafts;
 *     capacity м²/shift deferred to G6.
 *
 * Remaining NOT authoritative (G6+): production capacity planning, full P2P AP automation.
 */
export const G1_ARCHITECTURE = 'C_hybrid_server_critical_store' as const
export const G1_WAREHOUSE_VERTICAL_SLICE = 'READY_LOCAL' as const
export const G2_WAREHOUSE_ORIGINATED_COMMANDS = 'READY_LOCAL' as const
export const G3_PRODUCTION_CORE_COMMANDS = 'READY_LOCAL' as const
export const G31_CROSS_DOMAIN_ACTIVATION = 'READY_LOCAL' as const
export const G4_PACKAGING_QC_SHIPMENT = 'READY_LOCAL' as const
export const G41_SINGLE_PACKAGING_QC_ACL = 'READY_LOCAL' as const
export const G5_SALES_MRP_PROCUREMENT = 'READY_LOCAL' as const
export const G1_GLOBAL_UPDATEFSTSTORE_SECURITY = 'BLOCK_UNTIL_ALL_CRITICAL_GATED' as const
export const G2_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G3_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G4_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
export const G5_PRODUCTION_DEPLOY_READY = 'BLOCK' as const
