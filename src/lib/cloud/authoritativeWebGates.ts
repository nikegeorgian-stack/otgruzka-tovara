/**
 * R2.9K — web must not soft-write stock-affecting packaging / production / shipment
 * when the matching critical domain is inactive (avoids FstStore↔critical split-brain).
 * Desktop (non-web) keeps legacy soft paths.
 */

export const G3_PRODUCTION_INACTIVE = 'g3_production_inactive'
export const G4_PACKAGING_INACTIVE = 'g4_packaging_inactive'
export const G5_SALES_PLANNING_INACTIVE = 'g5_sales_planning_inactive'

export function webRequiresAuthoritativeDomain(isWebPath: boolean, domainActive: boolean): boolean {
  return isWebPath === true && domainActive !== true
}
