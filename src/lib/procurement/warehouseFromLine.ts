import { newId } from '@/lib/production/files'
import type { PurchaseOrderLine } from './types'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

export function warehouseItemFromOrderLine(
  line: PurchaseOrderLine,
  warehouse: WarehouseStore,
  warehouseId?: string,
): WarehouseItem {
  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const categoryId = warehouse.categories[0]?.id || newId()
  const now = new Date().toISOString()
  return {
    id: newId(),
    internalCode: '',
    name: line.name.trim(),
    categoryId,
    warehouseId: whId,
    unit: line.unit || 'шт',
    sku: line.supplierSku?.trim() || undefined,
    price: line.unitPrice,
    note: line.note,
    active: true,
    sortOrder: warehouse.items.length,
    createdAt: now,
  }
}
