import { useMemo, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import {
  computeAllBalances,
  computeReorderRows,
  expiringBatches,
  formatQty,
  itemStockValueSmart,
  turnoverForPeriod,
  valueByCategory,
} from '@/lib/warehouse/stock'
import {
  exportWarehouseReorderExcel,
  exportWarehouseTurnoverExcel,
} from '@/lib/warehouse/importExport'
import type { WarehousePageProps } from './warehouseTypes'

type Props = WarehousePageProps & {
  warehouseId: string
  fromDate: string
  toDate: string
}

export function WarehouseAnalyticsTab({ warehouse, warehouseId, fromDate, toDate }: Props) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<'reorder' | 'turnover' | null>(null)

  const balances = useMemo(
    () => computeAllBalances(warehouse, warehouseId || undefined),
    [warehouse, warehouseId],
  )
  const turnover = useMemo(
    () => turnoverForPeriod(warehouse, fromDate, toDate, warehouseId || undefined),
    [warehouse, fromDate, toDate, warehouseId],
  )
  const activeItems = useMemo(() => warehouse.items.filter((i) => i.active), [warehouse.items])
  const reorder = useMemo(
    () =>
      computeReorderRows(
        warehouseId ? activeItems.filter((i) => i.warehouseId === warehouseId) : activeItems,
        balances,
      ),
    [activeItems, balances, warehouseId],
  )
  const byCategory = useMemo(
    () => valueByCategory(warehouse, balances, warehouseId || undefined),
    [warehouse, balances, warehouseId],
  )
  const itemMap = useMemo(() => new Map(warehouse.items.map((i) => [i.id, i])), [warehouse.items])

  const totalValue = useMemo(() => {
    let sum = 0
    for (const item of warehouse.items) {
      if (warehouseId && item.warehouseId !== warehouseId) continue
      sum += itemStockValueSmart(
        item,
        balances.get(item.id)?.balance ?? 0,
        warehouse.movements,
        warehouseId,
      )
    }
    return sum
  }, [warehouse.items, warehouse.movements, balances, warehouseId])

  const expiring = useMemo(
    () => expiringBatches(warehouse.movements, warehouse.items, 30),
    [warehouse.movements, warehouse.items],
  )

  const periodReceipt = turnover.reduce((s, r) => s + r.receipt, 0)
  const periodIssue = turnover.reduce((s, r) => s + r.issue, 0)
  const maxCatValue = byCategory[0]?.value ?? 0
  const top = turnover.slice(0, 15)

  async function handleExportReorder() {
    setBusy('reorder')
    try {
      await exportWarehouseReorderExcel(warehouse, reorder)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportTurnover() {
    setBusy('turnover')
    try {
      await exportWarehouseTurnoverExcel(warehouse, turnover, { from: fromDate, to: toDate })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('warehouse.analytics.stockValue')}
          value={totalValue ? `${formatQty(Math.round(totalValue))} ₾` : '—'}
        />
        <KpiCard label={t('warehouse.analytics.positions')} value={activeItems.length} />
        <KpiCard
          label={t('warehouse.analytics.reorder')}
          value={reorder.length}
          tone={reorder.length ? 'warn' : 'ok'}
        />
        <KpiCard
          label={`${t('warehouse.analytics.issued')} · ${t('warehouse.analytics.received')}`}
          value={`${formatQty(periodIssue)} / ${formatQty(periodReceipt)}`}
          hint={`${fromDate} — ${toDate}`}
        />
      </div>

      {/* К пополнению — самый важный actionable-блок для кладовщика */}
      <section className="rounded-sm border border-grid bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid px-4 py-3">
          <div>
            <h3 className="font-bold text-ink">{t('warehouse.analytics.reorder')}</h3>
            <p className="text-xs text-stone-500">{t('warehouse.analytics.reorderHint')}</p>
          </div>
          <button
            type="button"
            className="btn-add-outline px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!reorder.length || busy !== null}
            onClick={() => void handleExportReorder()}
          >
            {busy === 'reorder' ? '…' : t('warehouse.analytics.exportReorder')}
          </button>
        </div>
        {reorder.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-emerald-700">
            {t('warehouse.analytics.reorderEmpty')}
          </p>
        ) : (
          <div className="max-h-[22rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2">{t('warehouse.col.name')}</th>
                  <th className="px-3 py-2 text-right">{t('warehouse.analytics.available')}</th>
                  <th className="px-3 py-2 text-right">{t('warehouse.analytics.min')}</th>
                  <th className="px-3 py-2 text-right">{t('warehouse.analytics.suggested')}</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map((r) => (
                  <tr key={r.item.id} className="border-t border-grid/60">
                    <td className="px-4 py-2 truncate max-w-[18rem]" title={r.item.name}>
                      {r.item.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-700">
                      {formatQty(r.available)} {r.item.unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                      {formatQty(r.minStock)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-700">
                      +{formatQty(r.suggested)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {expiring.length > 0 && (
        <section className="rounded-sm border border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden">
          <div className="border-b border-amber-200 px-4 py-3">
            <h3 className="font-bold text-ink">{t('warehouse.analytics.expiring')}</h3>
            <p className="text-xs text-stone-500">{t('warehouse.analytics.expiringHint')}</p>
          </div>
          <div className="max-h-[18rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-amber-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2">{t('warehouse.col.name')}</th>
                  <th className="px-3 py-2">{t('warehouse.analytics.batch')}</th>
                  <th className="px-3 py-2">{t('warehouse.analytics.expiryDate')}</th>
                  <th className="px-3 py-2 text-right">{t('warehouse.analytics.daysLeft')}</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((r, idx) => (
                  <tr key={`${r.itemId}-${r.expiryDate}-${idx}`} className="border-t border-amber-200/60">
                    <td className="px-4 py-2 truncate max-w-[16rem]" title={r.name}>
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-stone-500">{r.batchNo ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.expiryDate}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-bold ${
                        r.daysLeft < 0 ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {r.daysLeft < 0 ? t('warehouse.analytics.expired') : r.daysLeft}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Стоимость по категориям с горизонтальными барами */}
        <section className="rounded-sm border border-grid bg-white shadow-sm overflow-hidden">
          <div className="border-b border-grid px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('warehouse.analytics.byCategory')}
          </div>
          {byCategory.length === 0 ? (
            <p className="p-4 text-sm text-stone-400">—</p>
          ) : (
            <ul className="divide-y divide-grid/60">
              {byCategory.map((row) => (
                <li key={row.categoryId} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate" title={row.name}>
                      {row.name}
                      <span className="ml-1 text-xs text-stone-400">({row.positions})</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {formatQty(Math.round(row.value))} ₾
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-stone-100">
                    <div
                      className="h-full rounded-sm bg-blue-600"
                      style={{ width: `${maxCatValue ? (row.value / maxCatValue) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Топ оборота за период */}
        <section className="rounded-sm border border-grid bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-grid px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('warehouse.analytics.topIssue')}
            </span>
            <button
              type="button"
              className="btn-add-outline px-3 py-1 text-xs disabled:opacity-50"
              disabled={!turnover.length || busy !== null}
              onClick={() => void handleExportTurnover()}
            >
              {busy === 'turnover' ? '…' : t('warehouse.analytics.exportTurnover')}
            </button>
          </div>
          {top.length === 0 ? (
            <p className="p-4 text-sm text-stone-400">{t('warehouse.noMovements')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {top.map((row) => {
                  const item = itemMap.get(row.itemId)
                  return (
                    <tr key={row.itemId} className="border-t border-grid/60">
                      <td className="px-4 py-2 truncate max-w-[14rem]" title={item?.name}>
                        {item?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">
                        {formatQty(row.issue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatQty(row.receipt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
