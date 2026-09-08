/**
 * PHASE P1A — lineId → production warehouse/location bindings (stable IDs only).
 * Never auto-creates locations in user data.
 */
import type { ProductionLineId } from '@/lib/production/types'
import { PRODUCTION_LINES } from '@/lib/production/types'
import type { ProductionLineLocationBinding, WarehouseStore } from './types'

export const LINE_LOCATION_NOT_CONFIGURED = 'warehouse.handoff.errLineNotConfigured' as const
export const LINE_LOCATION_MISSING = 'warehouse.handoff.errLocationMissing' as const

export function knownProductionLineIds(): string[] {
  return PRODUCTION_LINES.map((l) => l.id)
}

/** Soft/legacy rows may use sourceWarehouseId; canonical field is productionWarehouseId. */
export function bindingProductionWarehouseId(
  binding: Pick<ProductionLineLocationBinding, 'productionWarehouseId'> & {
    sourceWarehouseId?: string
  },
): string {
  return (
    String(binding.productionWarehouseId ?? '').trim() ||
    String(binding.sourceWarehouseId ?? '').trim()
  )
}

export function getProductionLineBinding(
  store: Pick<WarehouseStore, 'productionLineBindings'>,
  lineId: string,
): ProductionLineLocationBinding | undefined {
  const raw = (store.productionLineBindings ?? []).find((b) => b.lineId === lineId || b.id === lineId)
  if (!raw) return undefined
  const productionWarehouseId = bindingProductionWarehouseId(raw)
  const productionLocationId = String(raw.productionLocationId ?? '').trim()
  if (!productionWarehouseId || !productionLocationId) return raw
  return {
    ...raw,
    id: raw.id || raw.lineId,
    productionWarehouseId,
    productionLocationId,
  }
}

export function resolveProductionLineLocation(
  store: WarehouseStore,
  lineId: string,
):
  | {
      ok: true
      binding: ProductionLineLocationBinding
      productionWarehouseId: string
      productionLocationId: string
    }
  | { ok: false; error: typeof LINE_LOCATION_NOT_CONFIGURED | typeof LINE_LOCATION_MISSING } {
  const binding = getProductionLineBinding(store, lineId)
  const productionWarehouseId = binding ? bindingProductionWarehouseId(binding) : ''
  const productionLocationId = String(binding?.productionLocationId ?? '').trim()
  if (!productionWarehouseId || !productionLocationId) {
    return { ok: false, error: LINE_LOCATION_NOT_CONFIGURED }
  }
  const locIds = new Set(store.locations.map((l) => l.id))
  if (!locIds.has(productionWarehouseId) || !locIds.has(productionLocationId)) {
    return { ok: false, error: LINE_LOCATION_MISSING }
  }
  const normalized: ProductionLineLocationBinding = {
    ...binding!,
    id: binding!.id || binding!.lineId,
    productionWarehouseId,
    productionLocationId,
  }
  return {
    ok: true,
    binding: normalized,
    productionWarehouseId,
    productionLocationId,
  }
}

/** Upsert binding — does not create warehouse locations. */
export function upsertProductionLineBinding(
  store: WarehouseStore,
  binding: Omit<ProductionLineLocationBinding, 'id'> & { id?: string },
): WarehouseStore {
  const id = binding.id ?? binding.lineId
  const row: ProductionLineLocationBinding = {
    id,
    lineId: binding.lineId,
    productionWarehouseId: binding.productionWarehouseId,
    productionLocationId: binding.productionLocationId,
    note: binding.note,
  }
  const list = [...(store.productionLineBindings ?? [])]
  const idx = list.findIndex((b) => b.id === id || b.lineId === row.lineId)
  if (idx >= 0) list[idx] = row
  else list.push(row)
  return { ...store, productionLineBindings: list }
}

export function productionLineSetupState(
  store: WarehouseStore,
  lineIds: string[] = knownProductionLineIds(),
): {
  configured: string[]
  missing: string[]
  incomplete: string[]
} {
  const configured: string[] = []
  const missing: string[] = []
  const incomplete: string[] = []
  for (const lineId of lineIds) {
    const r = resolveProductionLineLocation(store, lineId)
    if (r.ok) configured.push(lineId)
    else if (r.error === LINE_LOCATION_NOT_CONFIGURED) {
      const b = getProductionLineBinding(store, lineId)
      if (b) incomplete.push(lineId)
      else missing.push(lineId)
    } else incomplete.push(lineId)
  }
  return { configured, missing, incomplete }
}

export function isKnownProductionLineId(lineId: string): lineId is ProductionLineId {
  return knownProductionLineIds().includes(lineId)
}
