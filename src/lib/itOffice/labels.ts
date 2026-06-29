import type { ItActType, ItAssetKind, ItAssetStatus, ItMaintenanceKind } from './types'

export function itAssetKindLabelKey(kind: ItAssetKind): string {
  return `itOffice.kind.${kind}`
}

export function itAssetStatusLabelKey(status: ItAssetStatus): string {
  return `itOffice.status.${status}`
}

export function itActTypeLabelKey(type: ItActType): string {
  return `itOffice.actType.${type}`
}

export function itMaintenanceKindLabelKey(kind: ItMaintenanceKind): string {
  return `itOffice.maintenance.${kind}`
}
