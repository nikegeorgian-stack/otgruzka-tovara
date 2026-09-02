import { warehouseItemDisplayName } from '@/lib/warehouse/technicalName'
import type { WarehouseItem } from '@/lib/warehouse/types'

export function WarehouseItemName({
  item,
  className = '',
}: {
  item: Pick<WarehouseItem, 'name' | 'technicalName'>
  className?: string
}) {
  const display = warehouseItemDisplayName(item)
  const invoice = item.name.trim()
  const showInvoice = Boolean(item.technicalName?.trim() && invoice && display !== invoice)
  return (
    <span className={className}>
      <span className="font-medium">{display}</span>
      {showInvoice ? (
        <span className="mt-0.5 block text-[11px] font-normal text-stone-400">{invoice}</span>
      ) : null}
    </span>
  )
}
