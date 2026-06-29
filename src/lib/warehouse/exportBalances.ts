import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { exportWarehouseBalancesExcel } from '@/lib/warehouse/importExport'

/** Экспорт остатков склада в Excel (общая точка входа для App и WarehousePage). */
export async function exportWarehouseFromStore(
  warehouse: WarehouseStore,
  warehouseId?: string,
): Promise<void> {
  const balances = computeAllBalances(warehouse, warehouseId)
  await exportWarehouseBalancesExcel(warehouse, balances, warehouseId)
}
