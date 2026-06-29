import { useMemo } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { TransportModeBadge } from '@/components/procurement/TransportModeIcon'
import { useI18n } from '@/context/I18nContext'
import {
  computeProcurementKpis,
  ordersByScope,
  supplierStats,
  transportStats,
} from '@/lib/procurement/analytics'
import type { PurchaseOrder } from '@/lib/procurement/types'
import type { ProcurementPageProps } from './procurementTypes'

type Props = Pick<ProcurementPageProps, 'counterparties'> & {
  orders: PurchaseOrder[]
}

export function ProcurementAnalyticsTab({ orders, counterparties }: Props) {
  const { t } = useI18n()
  const kpis = useMemo(() => computeProcurementKpis(orders), [orders])
  const suppliers = useMemo(() => supplierStats(orders), [orders])
  const transports = useMemo(() => transportStats(orders), [orders])
  const scope = useMemo(() => ordersByScope(orders), [orders])
  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label={t('procurement.kpi.active')} value={kpis.activeOrders} />
        <KpiCard label={t('procurement.kpi.inTransit')} value={kpis.inTransit} tone="warn" />
        <KpiCard
          label={t('procurement.kpi.overdue')}
          value={kpis.overdue}
          tone={kpis.overdue > 0 ? 'warn' : 'default'}
        />
        <KpiCard label={t('procurement.kpi.arrivingWeek')} value={kpis.arrivingThisWeek} />
        <KpiCard
          label={t('procurement.kpi.openValue')}
          value={kpis.totalOpenValue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-ink">{t('procurement.analytics.scope')}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">{t('procurement.scope.domestic')}</dt>
              <dd className="font-bold tabular-nums">{scope.domestic}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">{t('procurement.scope.international')}</dt>
              <dd className="font-bold tabular-nums">{scope.international}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-ink">{t('procurement.analytics.transport')}</h3>
          {transports.length === 0 ? (
            <p className="mt-3 text-sm text-stone-400">{t('procurement.analytics.noData')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {transports.map((row) => (
                <li key={row.mode} className="flex items-center justify-between text-sm">
                  <TransportModeBadge mode={row.mode} />
                  <span className="tabular-nums text-stone-600">
                    {row.orders} {t('procurement.analytics.orders')} · {row.legs}{' '}
                    {t('procurement.analytics.legs')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <div className="border-b border-grid px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{t('procurement.analytics.suppliers')}</h3>
        </div>
        {suppliers.length === 0 ? (
          <p className="p-6 text-sm text-stone-400">{t('procurement.analytics.noData')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-2 text-left">{t('procurement.col.supplier')}</th>
                <th className="px-3 py-2 text-right">{t('procurement.analytics.orders')}</th>
                <th className="px-3 py-2 text-right">{t('procurement.kpi.active')}</th>
                <th className="px-3 py-2 text-right">{t('procurement.kpi.overdue')}</th>
                <th className="px-3 py-2 text-right">{t('procurement.analytics.leadDays')}</th>
                <th className="px-3 py-2 text-right">{t('procurement.col.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.slice(0, 20).map((row) => (
                <tr key={row.counterpartyId} className="border-t border-grid/60">
                  <td className="px-4 py-2.5 font-medium">
                    {cpMap.get(row.counterpartyId)?.name ?? row.counterpartyId}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.orders}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.active}</td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums ${row.overdue > 0 ? 'font-bold text-red-700' : ''}`}
                  >
                    {row.overdue}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.avgLeadDays ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                    {row.totalValue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
