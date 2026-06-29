import { useMemo } from 'react'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { TransportModeBadge } from '@/components/procurement/TransportModeIcon'
import { useI18n } from '@/context/I18nContext'
import { orderProgressPercent, orderEtaDate, legDurationDays } from '@/lib/procurement/status'
import { buildCarrierTrackingUrl, carrierLabel } from '@/lib/procurement/tracking/carrierUrls'
import type { PurchaseOrder } from '@/lib/procurement/types'
import type { ProcurementPageProps } from './procurementTypes'

type Props = Pick<ProcurementPageProps, 'counterparties'> & {
  orders: PurchaseOrder[]
  onEdit: (order: PurchaseOrder) => void
}

export function ProcurementTrackingTab({ orders, counterparties, onEdit }: Props) {
  const { t } = useI18n()
  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  const active = orders
    .filter((o) => o.status !== 'received' && o.status !== 'cancelled')
    .sort((a, b) => (orderEtaDate(a) ?? '9999').localeCompare(orderEtaDate(b) ?? '9999'))

  if (!active.length) {
    return (
      <div className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-16 text-center text-stone-500">
        {t('procurement.trackingEmpty')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {active.map((o) => {
        const supplier = cpMap.get(o.counterpartyId)
        const progress = orderProgressPercent(o.status)
        const eta = orderEtaDate(o)
        const legs = [...o.legs].sort((a, b) => a.sequence - b.sequence)

        return (
          <article
            key={o.id}
            className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm"
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-grid bg-stone-50/80 px-4 py-3">
              <div>
                <button
                  type="button"
                  className="font-mono text-sm font-bold text-teal-800 hover:underline"
                  onClick={() => onEdit(o)}
                >
                  {o.orderNumber}
                </button>
                <p className="text-sm font-medium text-ink">{supplier?.name}</p>
                <p className="text-xs text-stone-500">
                  {t(`procurement.scope.${o.scope}`)} · {t(`procurement.category.${o.category}`)}
                </p>
              </div>
              <div className="text-right">
                <OrderStatusBadge status={o.status} />
                {o.containerTracking?.enabled && o.containerTracking.reference && (
                  <p className="mt-1 text-[10px] font-semibold text-teal-700">
                    {carrierLabel(o.containerTracking.carrier)} ·{' '}
                    <span className="font-mono">{o.containerTracking.reference}</span>
                    {o.containerTracking.lastLocation && (
                      <span className="mt-0.5 block font-normal text-stone-500">
                        {o.containerTracking.lastLocation}
                      </span>
                    )}
                  </p>
                )}
                {eta && (
                  <p className="mt-1 text-xs text-stone-600">
                    {t('procurement.col.eta')}: <strong className="tabular-nums">{eta}</strong>
                  </p>
                )}
              </div>
            </header>

            <div className="px-4 py-3">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-sm bg-stone-200">
                  <div
                    className="h-full rounded-sm bg-teal-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums text-stone-500">{progress}%</span>
              </div>

              {legs.length > 0 ? (
                <ol className="relative space-y-0 border-l-2 border-teal-200 pl-4">
                  {legs.map((leg, idx) => {
                    const dur = legDurationDays(leg)
                    const done = !!leg.actualArrivalDate
                    return (
                      <li key={leg.id} className="relative pb-4 last:pb-0">
                        <span
                          className={`absolute -left-[1.3rem] top-1 flex h-4 w-4 items-center justify-center rounded-sm text-[8px] ${
                            done ? 'bg-teal-600 text-white' : 'border-2 border-teal-400 bg-white'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="rounded-sm border border-grid/80 bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <TransportModeBadge mode={leg.transportMode} />
                            {leg.vesselOrTrain && (
                              <span className="text-xs font-medium text-stone-700">
                                {leg.vesselOrTrain}
                              </span>
                            )}
                            {leg.carrier && (
                              <span className="text-xs text-stone-500">{leg.carrier}</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-stone-800">
                            {leg.origin || '—'} → {leg.destination || '—'}
                          </p>
                          <dl className="mt-2 grid gap-1 text-[11px] text-stone-500 sm:grid-cols-2">
                            <div>
                              <dt className="inline">{t('procurement.col.plannedShipment')}: </dt>
                              <dd className="inline tabular-nums font-medium text-stone-700">
                                {leg.plannedDepartureDate ?? '—'}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline">{t('procurement.col.eta')}: </dt>
                              <dd className="inline tabular-nums font-medium text-stone-700">
                                {leg.etaDate ?? '—'}
                              </dd>
                            </div>
                            {(leg.trackingNumber || o.containerTracking?.reference) && (
                              <div className="sm:col-span-2">
                                <dt className="inline">{t('procurement.col.tracking')}: </dt>
                                <dd className="inline font-mono text-stone-700">
                                  {leg.trackingNumber ?? o.containerTracking?.reference}
                                  {o.containerTracking?.enabled && o.containerTracking.reference && (
                                    <a
                                      href={buildCarrierTrackingUrl(
                                        o.containerTracking.carrier,
                                        o.containerTracking.reference,
                                        o.containerTracking.referenceType,
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ml-2 text-teal-700 hover:underline"
                                    >
                                      ↗
                                    </a>
                                  )}
                                </dd>
                              </div>
                            )}
                            {dur !== undefined && (
                              <div>
                                <dt className="inline">{t('procurement.legDays')}: </dt>
                                <dd className="inline tabular-nums">{dur}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="text-sm text-stone-400">{t('procurement.noLegs')}</p>
              )}

              {o.milestones.length > 0 && (
                <div className="mt-4 border-t border-grid pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
                    {t('procurement.recentEvents')}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {[...o.milestones]
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .slice(0, 3)
                      .map((m) => (
                        <li key={m.id} className="text-xs text-stone-600">
                          <time className="font-mono text-stone-400">
                            {m.at.slice(0, 16).replace('T', ' ')}
                          </time>
                          {' — '}
                          {m.note ?? String(m.status)}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
