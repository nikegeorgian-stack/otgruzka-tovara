/**
 * PHASE G1 — compatibility facade.
 * Authoritative warehouse commands live in _g2WarehouseService.mjs (G2 lifecycle).
 */
export {
  requirePrincipalCapability,
  grantPrincipalAccess,
  revokePrincipalAccess,
  getAuthoritativeCriticalStore,
  postWarehouseDocumentCommand,
  resolveAuthoritativeWarehouse,
  executeG2Command,
} from './_g2WarehouseService.mjs'
