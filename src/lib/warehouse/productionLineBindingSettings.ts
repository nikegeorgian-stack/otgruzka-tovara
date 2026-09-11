import { isSysAdmin } from '@/lib/access/permissions'
import type { AppUser } from '@/lib/access/types'
import { PRODUCTION_LINES } from '@/lib/production/types'
import {
  LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS,
  LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE,
  LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND,
  LINE_BINDING_CONFIG_ACK_MISMATCH,
  LINE_BINDING_CONFIG_ID_CONFLICT,
  LINE_BINDING_CONFIG_INPUT_INVALID,
  LINE_BINDING_CONFIG_LINE_AMBIGUOUS,
  LINE_BINDING_CONFIG_LOCATION_AMBIGUOUS,
  LINE_BINDING_CONFIG_LOCATION_NOT_FOUND,
  LINE_BINDING_CONFIG_STAGING_ONLY,
  LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND,
  applyProductionLineBindingConfig,
} from '@/lib/warehouse/g3LineBindingConfigCore.mjs'
import type {
  ProductionLineLocationBinding,
  WarehouseLocation,
  WarehouseStore,
} from '@/lib/warehouse/types'

export type ProductionLineBindingSettingsWarehouse = Pick<
  WarehouseStore,
  'locations' | 'accountingByWarehouse' | 'productionLineBindings'
>

export type ProductionLineBindingSaveResult = {
  ok: boolean
  error?: string
  binding?: ProductionLineLocationBinding
  criticalRevision?: number
  idempotent?: boolean
}

type SelectableLocation = WarehouseLocation & { active?: boolean }

const ERROR_KEYS: Record<string, string> = {
  [LINE_BINDING_CONFIG_STAGING_ONLY]: 'settings.lineBinding.error.stagingOnly',
  [LINE_BINDING_CONFIG_INPUT_INVALID]: 'settings.lineBinding.error.inputInvalid',
  [LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND]: 'settings.lineBinding.error.warehouseNotFound',
  [LINE_BINDING_CONFIG_LOCATION_NOT_FOUND]: 'settings.lineBinding.error.locationNotFound',
  [LINE_BINDING_CONFIG_LOCATION_AMBIGUOUS]: 'settings.lineBinding.error.locationAmbiguous',
  [LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND]: 'settings.lineBinding.error.accountingNotFound',
  [LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS]: 'settings.lineBinding.error.accountingAmbiguous',
  [LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE]: 'settings.lineBinding.error.accountingInactive',
  [LINE_BINDING_CONFIG_LINE_AMBIGUOUS]: 'settings.lineBinding.error.lineAmbiguous',
  [LINE_BINDING_CONFIG_ID_CONFLICT]: 'settings.lineBinding.error.idConflict',
  [LINE_BINDING_CONFIG_ACK_MISMATCH]: 'settings.lineBinding.error.ackMismatch',
  production_authoritative_domain_inactive: 'settings.lineBinding.error.domainInactive',
  forbidden: 'settings.lineBinding.error.forbidden',
  forbidden_line_scope: 'settings.lineBinding.error.forbidden',
  unauthorized: 'settings.lineBinding.error.forbidden',
  network: 'settings.lineBinding.error.network',
}

export function canConfigureProductionLineBindings(
  allowStagingConfiguration: boolean,
  currentUser: AppUser | null | undefined,
): boolean {
  return allowStagingConfiguration && isSysAdmin(currentUser)
}

function exactUniqueActiveLocations(
  warehouse: ProductionLineBindingSettingsWarehouse,
): SelectableLocation[] {
  const rows = warehouse.locations as SelectableLocation[]
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = String(row.id ?? '').trim()
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return rows
    .filter((row) => {
      const id = String(row.id ?? '').trim()
      return Boolean(id) && row.active !== false && counts.get(id) === 1
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/** Exact active records only. Names are display labels and never selectors. */
export function productionLineBindingOptions(
  warehouse: ProductionLineBindingSettingsWarehouse,
): {
  productionWarehouses: SelectableLocation[]
  productionLocations: SelectableLocation[]
} {
  const productionLocations = exactUniqueActiveLocations(warehouse)
  const accounting = warehouse.accountingByWarehouse ?? []
  const productionWarehouses = productionLocations.filter((location) => {
    const rows = accounting.filter(
      (row) => String(row.warehouseId ?? '').trim() === String(location.id).trim(),
    )
    return rows.length === 1 && rows[0]?.status === 'active'
  })
  return { productionWarehouses, productionLocations }
}

export function prepareProductionLineBindingCommand(
  warehouse: ProductionLineBindingSettingsWarehouse,
  input: {
    lineId: string
    productionWarehouseId: string
    productionLocationId: string
    note?: string
  },
):
  | {
      ok: true
      command: {
        lineId: string
        productionWarehouseId: string
        productionLocationId: string
        note?: string
      }
    }
  | { ok: false; error: string } {
  const command = {
    lineId: input.lineId.trim(),
    productionWarehouseId: input.productionWarehouseId.trim(),
    productionLocationId: input.productionLocationId.trim(),
    note: input.note?.trim() || undefined,
  }
  if (!PRODUCTION_LINES.some((line) => line.id === command.lineId)) {
    return { ok: false, error: LINE_BINDING_CONFIG_INPUT_INVALID }
  }
  const checked = applyProductionLineBindingConfig(
    warehouse as WarehouseStore,
    command,
    { uid: 'ui-validation-only' },
    '',
  )
  if (!checked.ok) return { ok: false, error: checked.error }
  return { ok: true, command }
}

export function productionLineBindingErrorKey(error: string): string {
  return ERROR_KEYS[error] ?? 'settings.lineBinding.error.generic'
}

export function exactProductionLineBinding(
  warehouse: ProductionLineBindingSettingsWarehouse,
  lineId: string,
): ProductionLineLocationBinding | null {
  const matches = (warehouse.productionLineBindings ?? []).filter(
    (row) => String(row.lineId || row.id).trim() === lineId,
  )
  return matches.length === 1 ? matches[0]! : null
}
