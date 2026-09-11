import type { WarehouseStore, ProductionLineLocationBinding } from './types'

export const LINE_BINDING_CONFIG_STAGING_ONLY: string
export const LINE_BINDING_CONFIG_INPUT_INVALID: string
export const LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND: string
export const LINE_BINDING_CONFIG_LOCATION_NOT_FOUND: string
export const LINE_BINDING_CONFIG_LOCATION_AMBIGUOUS: string
export const LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND: string
export const LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS: string
export const LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE: string
export const LINE_BINDING_CONFIG_LINE_AMBIGUOUS: string
export const LINE_BINDING_CONFIG_ID_CONFLICT: string
export const LINE_BINDING_CONFIG_ACK_MISMATCH: string

export function productionLineBindingFingerprint(input: {
  lineId?: unknown
  productionWarehouseId?: unknown
  productionLocationId?: unknown
  note?: unknown
}): string

export function canonicalProductionLineBindingPayload(input: {
  lineId?: unknown
  productionWarehouseId?: unknown
  productionLocationId?: unknown
  note?: unknown
}): string

export function authoritativeProductionLineBindingFingerprint(input: {
  lineId?: unknown
  productionWarehouseId?: unknown
  productionLocationId?: unknown
  note?: unknown
}): Promise<string | null>

export type ApplyProductionLineBindingConfigResult =
  | {
      ok: true
      warehouse: WarehouseStore
      binding: ProductionLineLocationBinding
      bindingId: string
      bindingFingerprint: string
      previousBindingFingerprint?: string
      idempotent: boolean
    }
  | { ok: false; error: string; status: number }

export function applyProductionLineBindingConfig(
  warehouse: WarehouseStore,
  command: {
    lineId?: unknown
    productionWarehouseId?: unknown
    productionLocationId?: unknown
    note?: unknown
  },
  actor: { uid?: unknown },
  now: unknown,
  options?: { fingerprint?: (input: unknown) => string },
): ApplyProductionLineBindingConfigResult

export function validateProductionLineBindingAck(
  data: unknown,
  expected: {
    lineId?: unknown
    productionWarehouseId?: unknown
    productionLocationId?: unknown
    note?: unknown
  },
  options?: { previousCriticalRevision?: unknown },
): Promise<
  | {
      ok: true
      binding: ProductionLineLocationBinding
      bindingFingerprint: string
      criticalRevision: number
      idempotent: boolean
    }
  | { ok: false; error: string }
>
