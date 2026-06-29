import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { computeProcurementStockRows } from '@/lib/procurement/stockOutlook'
import type { ProcurementPageProps } from './procurementTypes'

type Props = Pick<ProcurementPageProps, 'procurement' | 'warehouse'>

export function ProcurementStockTab({ procurement, warehouse }: Props) {
  const { t } = useI18n()
  const rows = useMemo(
    () => computeProcurementStockRows(procurement.orders, warehouse),
    [procurement.orders, warehouse],
  )

  if (!rows.length) {
    return (
      <div className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-16 text-center text-stone-500">
        {t('procurement.stockEmpty')}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
      <div className="border-b border-grid bg-stone-50 px-4 py-3">
        <p className="text-sm text-stone-600">{t('procurement.stockHint')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('procurement.stock.col.item')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.onOrder')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.pending')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.received')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.balance')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.available')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.stock.col.orders')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const low =
                row.warehouseAvailable !== undefined &&
                row.pendingQty > 0 &&
                (row.warehouseAvailable ?? 0) < row.pendingQty * 0.2
              return (
                <tr
                  key={row.key}
                  className={`border-t border-grid/60 hover:bg-stone-50/80 ${low ? 'bg-amber-50/50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.name}</p>
                    {row.supplierSku && (
                      <p className="font-mono text-[10px] text-stone-400">{row.supplierSku}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.onOrderQty} {row.unit}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-teal-800">
                    {row.pendingQty} {row.unit}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-stone-600">
                    {row.receivedQty} {row.unit}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.warehouseBalance !== undefined
                      ? `${row.warehouseBalance} ${row.unit}`
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.warehouseAvailable !== undefined
                      ? `${row.warehouseAvailable} ${row.unit}`
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-stone-500">
                    {row.orderCount}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
