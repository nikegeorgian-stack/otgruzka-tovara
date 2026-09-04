/**
 * PHASE G2.1 — re-export canonical FEFO/FIFO for Admin API.
 * Source of truth: src/lib/warehouse/batchAllocationCore.mjs
 */
export {
  BATCH_OVERRIDE_REASON_REQUIRED,
  BATCH_UNKNOWN,
  BATCH_INSUFFICIENT,
  BATCH_EXPIRED_FORBIDDEN,
  buildBatchLotsFromMovements,
  sortLotsFefoFifo,
  allocateBatchesFefoFifo,
  allocateIssueLineBatches,
  ordinaryAvailableQty,
} from '../../src/lib/warehouse/batchAllocationCore.mjs'
