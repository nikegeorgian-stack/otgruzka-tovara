/**
 * PHASE R1 — read critical domain operatingMode from AppStore domainMeta (SQL sync).
 */
import type { AppStore } from '@/lib/types'

export type CriticalOperatingMode = 'inactive' | 'active' | 'frozen'

export type DomainFreezeKey =
  | 'warehouse'
  | 'production'
  | 'packagingQc'
  | 'masterData'
  | 'salesPlanning'
  | 'procurement'
  | 'capacityPlanning'

export const DOMAIN_FREEZE_KEYS: readonly DomainFreezeKey[] = [
  'warehouse',
  'production',
  'packagingQc',
  'masterData',
  'salesPlanning',
  'procurement',
  'capacityPlanning',
] as const

type MetaSlot = {
  active?: boolean
  operatingMode?: string
  freezeReason?: string
  frozenAt?: string
  frozenBy?: string
}

type CriticalDomainMeta = {
  warehouse?: MetaSlot
  production?: MetaSlot & {
    features?: {
      packagingQc?: MetaSlot
      capacityPlanning?: MetaSlot
    }
  }
  masterData?: MetaSlot
  salesPlanning?: MetaSlot
  procurement?: MetaSlot
}

function readMeta(store: AppStore | null | undefined): CriticalDomainMeta | null {
  if (!store) return null
  const production = store.production as unknown as Record<string, unknown> | undefined
  const warehouse = store.warehouse as unknown as Record<string, unknown> | undefined
  const fromProduction = production?.criticalDomainMeta as CriticalDomainMeta | undefined
  const fromWarehouse = warehouse?.criticalDomainMeta as CriticalDomainMeta | undefined
  const fromStore = (store as unknown as { criticalDomainMeta?: CriticalDomainMeta }).criticalDomainMeta
  return fromProduction ?? fromWarehouse ?? fromStore ?? null
}

function slotMode(slot: MetaSlot | null | undefined): CriticalOperatingMode {
  if (!slot || slot.active !== true) return 'inactive'
  if (slot.operatingMode === 'frozen') return 'frozen'
  return 'active'
}

export function getDomainMetaSliceFromStore(
  store: AppStore | null | undefined,
  key: DomainFreezeKey,
): MetaSlot | null {
  const meta = readMeta(store)
  if (!meta) return null
  if (key === 'packagingQc') return meta.production?.features?.packagingQc ?? null
  if (key === 'capacityPlanning') return meta.production?.features?.capacityPlanning ?? null
  return (meta[key] as MetaSlot | undefined) ?? null
}

export function getDomainOperatingModeFromStore(
  store: AppStore | null | undefined,
  key: DomainFreezeKey,
): CriticalOperatingMode {
  return slotMode(getDomainMetaSliceFromStore(store, key))
}

export function isDomainFrozenInStore(
  store: AppStore | null | undefined,
  key: DomainFreezeKey,
): boolean {
  return getDomainOperatingModeFromStore(store, key) === 'frozen'
}

export function listFrozenCriticalDomains(
  store: AppStore | null | undefined,
): DomainFreezeKey[] {
  return DOMAIN_FREEZE_KEYS.filter((k) => isDomainFrozenInStore(store, k))
}

export function anyCriticalDomainFrozen(store: AppStore | null | undefined): boolean {
  return listFrozenCriticalDomains(store).length > 0
}
