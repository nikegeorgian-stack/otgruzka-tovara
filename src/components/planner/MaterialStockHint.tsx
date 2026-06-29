import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { materialLinesForOrder, orderNeedsMaterialPlanning } from '@/lib/planner/materialNeeds'
import { materialAvailabilityForOrder } from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import { formatQty } from '@/lib/warehouse/stock'
import type { StockMovement, WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  order: ProductionOrder
  warehouseItems: WarehouseItem[]
  warehouseMovements: StockMovement[]
  compact?: boolean
}

export function MaterialStockHint({ order, warehouseItems, warehouseMovements, compact }: Props) {
  const { t, tf } = useI18n()

  const rows = useMemo(() => {
    if (!orderNeedsMaterialPlanning(order)) return []
    const warehouse = { items: warehouseItems, movements: warehouseMovements }
    return materialAvailabilityForOrder(order, warehouse, warehouseItems)
  }, [order, warehouseItems, warehouseMovements])

  const lines = useMemo(
    () => materialLinesForOrder(order, warehouseItems),
    [order, warehouseItems],
  )

  if (!lines.length) {
    return (
      <p className="text-xs text-stone-500">{t('planner.material.configureHint')}</p>
    )
  }

  const totalShort = rows.reduce((s, r) => s + r.shortage, 0)
  const totalReserved = rows.reduce((s, r) => s + r.reservedForOrder, 0)
  const totalNeed = rows.reduce((s, r) => s + r.quantity, 0)

  if (compact) {
    if (totalShort > 0) {
      return (
        <p className="text-xs font-medium text-red-700">
          {tf('planner.material.shortageBanner', { count: formatQty(totalShort) })}
        </p>
      )
    }
    if (totalReserved >= totalNeed) {
      return (
        <p className="text-xs font-medium text-emerald-700">{t('planner.material.reservedOk')}</p>
      )
    }
    return (
      <p className="text-xs text-amber-800">{t('planner.material.checkTab')}</p>
    )
  }

  return (
    <div
      className={`rounded-sm border px-3 py-2 text-xs ${
        totalShort > 0
          ? 'border-red-200 bg-red-50/80 text-red-900'
          : totalReserved >= totalNeed
            ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
            : 'border-amber-200 bg-amber-50/50 text-amber-950'
      }`}
    >
      <p className="font-semibold">{t('planner.material.stockTitle')}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.itemId} className="flex flex-wrap justify-between gap-2">
            <span>{row.itemName}</span>
            <span className="font-mono">
              {tf('planner.material.stockLine', {
                need: formatQty(row.quantity),
                avail: formatQty(row.available),
                res: formatQty(row.reservedForOrder),
                unit: row.unit,
              })}
              {row.shortage > 0 && (
                <span className="ml-1 font-semibold text-red-700">
                  −{formatQty(row.shortage)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {totalShort > 0 && (
        <p className="mt-1.5 text-[11px]">{t('planner.material.reserveInTab')}</p>
      )}
    </div>
  )
}
