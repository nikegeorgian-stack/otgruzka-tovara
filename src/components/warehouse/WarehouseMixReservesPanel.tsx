import { useMemo } from 'react'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/context/I18nContext'
import { listActiveMixTaskReserves } from '@/lib/formulations/mixTaskReserve'
import type { FormulationMixTask } from '@/lib/formulations/types'
import { formatQty } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  mixTasks: FormulationMixTask[]
}

export function WarehouseMixReservesPanel({ warehouse, mixTasks }: Props) {
  const { t } = useI18n()
  const rows = useMemo(
    () => listActiveMixTaskReserves(warehouse, mixTasks),
    [warehouse, mixTasks],
  )

  if (rows.length === 0) return null

  return (
    <Card title={t('warehouse.mixReserve.title')} description={t('warehouse.mixReserve.hint')}>
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.taskId}
            className="rounded-sm border border-amber-200 bg-amber-50/40 px-3 py-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-mono text-xs text-stone-500">{row.taskNumber}</span>
                <span className="ml-2 text-sm font-medium text-ink">
                  {row.recipeCode} — {row.recipeName}
                </span>
              </div>
              <span className="text-xs text-stone-500">
                {row.plannedDate} · {formatQty(row.totalQty)} {t('warehouse.mixReserve.totalUnit')}
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-stone-700">
              {row.lines.map((line) => (
                <li key={line.itemId} className="flex justify-between gap-2">
                  <span className="truncate">{line.itemName}</span>
                  <span className="shrink-0 tabular-nums font-medium text-amber-900">
                    {formatQty(line.qty)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}
