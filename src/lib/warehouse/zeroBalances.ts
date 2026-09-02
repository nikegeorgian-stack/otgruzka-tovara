import { appendWarehouseAudit } from './audit'
import type { WarehouseStore } from './types'

/**
 * @deprecated PHASE W1 — bare zero-balance inventory movements are blocked.
 * Use inventory / opening-inventory WarehouseDocument lifecycle instead.
 * Legacy movements already in the ledger are left untouched.
 */
export function zeroAllWarehouseBalances(
  warehouse: WarehouseStore,
  date: string,
): WarehouseStore {
  void date
  return appendWarehouseAudit(warehouse, {
    action: 'inventory',
    detail: 'Обнуление остатков заблокировано (W1: только через документ)',
  })
}
