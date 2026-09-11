export const LINE_READINESS_EPSILON: number

export const LINE_ID_REQUIRED: string
export const LINE_BINDING_NOT_CONFIGURED: string
export const LINE_BINDING_DUPLICATE: string
export const LINE_BINDING_WAREHOUSE_REQUIRED: string
export const LINE_BINDING_LOCATION_REQUIRED: string
export const LINE_BINDING_WAREHOUSE_MISSING: string
export const LINE_BINDING_LOCATION_MISSING: string
export const LINE_BINDING_WAREHOUSE_DUPLICATE: string
export const LINE_BINDING_LOCATION_DUPLICATE: string
export const LINE_BINDING_ACCOUNTING_DUPLICATE: string
export const LINE_BINDING_ACCOUNTING_MISSING: string
export const LINE_BINDING_ACCOUNTING_INACTIVE: string

export const SCRAP_WASTE_QUANTITY_INVALID: string
export const SCRAP_LINE_ROUTE_REQUIRED: string
export const SCRAP_LOCATION_REQUIRED: string
export const SCRAP_LOCATION_MISSING: string
export const SCRAP_LOCATION_DUPLICATE: string
export const SCRAP_LOCATION_EQUALS_LINE: string
export const SCRAP_ACCOUNTING_DUPLICATE: string
export const SCRAP_ACCOUNTING_MISSING: string
export const SCRAP_ACCOUNTING_INACTIVE: string

type ReadinessStore = {
  productionLineBindings?: readonly {
    id?: unknown
    lineId?: unknown
    productionWarehouseId?: unknown
    sourceWarehouseId?: unknown
    productionLocationId?: unknown
  }[]
  locations?: readonly { id?: unknown }[]
  accountingByWarehouse?: readonly { warehouseId?: unknown; status?: unknown }[]
}

export function resolveProductionLineBinding(
  store: ReadinessStore,
  lineId: string,
  options?: { requireActiveAccounting?: boolean },
):
  | { ok: true; productionWarehouseId: string; productionLocationId: string }
  | { ok: false; error: string }

export function resolveScrapReadiness<T extends { quantity: number }>(input: {
  scrapLocationId?: string
  locations?: readonly { id?: unknown }[]
  accountingByWarehouse?: readonly { warehouseId?: unknown; status?: unknown }[]
  productionWarehouseId?: string
  productionLocationId?: string
  wasteLines?: readonly T[] | null
}):
  | { ok: true; wasteLines: T[]; scrapLocationId?: string }
  | { ok: false; error: string }
