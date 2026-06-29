import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import {
  materialRoleLabelKey,
  orderNeedsMaterialPlanning,
  PLANNER_MATERIAL_STATUSES,
} from '@/lib/planner/materialNeeds'
import type { MaterialReserveResult } from '@/lib/planner/materialReserve'
import {
  aggregateItemDemand,
  materialAvailabilityForOrder,
  type MaterialAvailabilityRow,
} from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import { formatQty } from '@/lib/warehouse/stock'
import type { StockMovement, WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  orders: ProductionOrder[]
  warehouseItems: WarehouseItem[]
  warehouseMovements: StockMovement[]
  onReserveOrder: (orderId: string) => MaterialReserveResult
  onUnreserveOrder: (orderId: string) => boolean
  onSelectOrder?: (orderId: string) => void
}

function StatusBadge({
  shortage,
  reserved,
  need,
}: {
  shortage: number
  reserved: number
  need: number
}) {
  const { t } = useI18n()
  if (need <= 0) {
    return (
      <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
        {t('planner.material.noNeed')}
      </span>
    )
  }
  if (shortage > 0) {
    return (
      <span className="rounded-sm bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
        {t('planner.material.short')}
      </span>
    )
  }
  if (reserved >= need) {
    return (
      <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
        {t('planner.material.reservedOk')}
      </span>
    )
  }
  return (
    <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
      {t('planner.material.partial')}
    </span>
  )
}

function orderMaterialStatus(rows: MaterialAvailabilityRow[]) {
  const need = rows.reduce((s, r) => s + r.quantity, 0)
  const reserved = rows.reduce((s, r) => s + r.reservedForOrder, 0)
  const shortage = rows.reduce((s, r) => s + r.shortage, 0)
  return { need, reserved, shortage }
}

export function PlannerMaterialsPanel({
  orders,
  warehouseItems,
  warehouseMovements,
  onReserveOrder,
  onUnreserveOrder,
  onSelectOrder,
}: Props) {
  const { t, tf } = useI18n()
  const [filter, setFilter] = useState<'all' | 'shortage' | 'unreserved'>('all')
  const [notice, setNotice] = useState<string | null>(null)

  const warehouse = useMemo(
    () => ({ items: warehouseItems, movements: warehouseMovements }),
    [warehouseItems, warehouseMovements],
  )

  const relevantOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          PLANNER_MATERIAL_STATUSES.includes(o.status) && orderNeedsMaterialPlanning(o),
      ),
    [orders],
  )

  const summary = useMemo(
    () => aggregateItemDemand(relevantOrders, warehouse, warehouseItems),
    [relevantOrders, warehouse, warehouseItems],
  )

  const orderRows = useMemo(() => {
    return relevantOrders
      .map((order) => {
        const lines = materialAvailabilityForOrder(order, warehouse, warehouseItems)
        const status = orderMaterialStatus(lines)
        return { order, lines, status }
      })
      .filter(({ status, lines }) => {
        if (!lines.length) return false
        if (filter === 'shortage') return status.shortage > 0
        if (filter === 'unreserved') return status.reserved < status.need
        return true
      })
      .sort((a, b) => b.status.shortage - a.status.shortage || a.order.orderNumber.localeCompare(b.order.orderNumber, 'ru'))
  }, [relevantOrders, warehouse, warehouseItems, filter])

  function handleReserve(orderId: string) {
    const res = onReserveOrder(orderId)
    if (res.messageKey) {
      setNotice(
        res.ok
          ? t(res.messageKey)
          : tf(res.messageKey, res.messageVars ?? {}),
      )
    }
  }

  function handleUnreserve(orderId: string) {
    if (onUnreserveOrder(orderId)) {
      setNotice(t('planner.material.unreserved'))
    } else {
      setNotice(t('planner.material.noReserve'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-sky-200/80 bg-sky-50/40 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold">{t('planner.material.hintTitle')}</p>
        <p className="mt-1 text-xs text-sky-800/90">{t('planner.material.hintBody')}</p>
      </div>

      {notice && (
        <p className="rounded-sm border border-grid bg-white px-3 py-2 text-sm text-stone-700">
          {notice}
          <button
            type="button"
            className="ml-2 text-xs text-stone-400 hover:text-stone-600"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </p>
      )}

      {summary.length > 0 && (
        <section className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <h3 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {t('planner.material.summaryTitle')}
          </h3>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('planner.material.colItem')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colNeed')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colReserved')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colAvailable')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colShort')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr
                  key={row.itemId}
                  className={`border-t border-grid ${row.shortage > 0 ? 'bg-red-50/50' : ''}`}
                >
                  <td className="px-3 py-2 font-medium">{row.itemName}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {formatQty(row.totalNeed)} {row.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-amber-800">
                    {formatQty(row.totalReserved)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {formatQty(row.available)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                      row.shortage > 0 ? 'text-red-700' : 'text-stone-400'
                    }`}
                  >
                    {row.shortage > 0 ? formatQty(row.shortage) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-stone-400">
          {t('planner.material.filter')}:
        </span>
        {(
          [
            ['all', 'planner.material.filterAll'],
            ['shortage', 'planner.material.filterShort'],
            ['unreserved', 'planner.material.filterUnreserved'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
              filter === id
                ? 'border-accent bg-accent text-white'
                : 'border-grid bg-white text-stone-600 hover:bg-paper-dark'
            }`}
            onClick={() => setFilter(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {orderRows.length === 0 ? (
        <p className="rounded-sm border border-dashed border-grid bg-white p-8 text-center text-sm text-stone-500">
          {t('planner.material.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {orderRows.map(({ order, lines, status }) => (
            <section
              key={order.id}
              className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid bg-stone-50/80 px-4 py-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="text-left font-semibold text-ink hover:text-accent"
                    onClick={() => onSelectOrder?.(order.id)}
                  >
                    {order.orderNumber} · {order.productName}
                  </button>
                  <p className="text-xs text-stone-500">
                    {t(`planner.status.${order.status}`)} · {formatQty(order.totalQtyMp)} п.м
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge {...status} />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleReserve(order.id)}
                    disabled={!lines.some((l) => l.canReserve > 0)}
                  >
                    {t('planner.material.reserveBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleUnreserve(order.id)}
                    disabled={status.reserved <= 0}
                  >
                    {t('planner.material.unreserveBtn')}
                  </Button>
                </div>
              </div>
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-stone-400">
                  <tr>
                    <th className="px-3 py-1.5">{t('planner.material.colType')}</th>
                    <th className="px-3 py-1.5">{t('planner.material.colItem')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colNeed')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colReserved')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colAvailable')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={`${line.role}-${line.itemId}`}
                      className={`border-t border-grid/60 ${line.shortage > 0 ? 'bg-red-50/40' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-xs text-stone-500">
                        {t(materialRoleLabelKey(line.role))}
                      </td>
                      <td className="px-3 py-1.5">{line.itemName}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {formatQty(line.quantity)} {line.unit}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-amber-800">
                        {formatQty(line.reservedForOrder)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {formatQty(line.available)}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono text-xs ${
                          line.shortage > 0 ? 'font-semibold text-red-700' : 'text-stone-400'
                        }`}
                      >
                        {line.shortage > 0 ? formatQty(line.shortage) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
