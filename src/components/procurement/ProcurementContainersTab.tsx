import { useMemo } from 'react'
import { ContainerPathTimeline } from '@/components/procurement/ContainerPathTimeline'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { useI18n } from '@/context/I18nContext'
import { buildCarrierTrackingUrl, carrierLabel } from '@/lib/procurement/tracking/carrierUrls'
import { orderEtaDate } from '@/lib/procurement/status'
import type { PurchaseOrder } from '@/lib/procurement/types'
import type { ProcurementPageProps } from './procurementTypes'

type Props = Pick<ProcurementPageProps, 'counterparties'> & {
  orders: PurchaseOrder[]
  onEdit: (order: PurchaseOrder) => void
}

export function ProcurementContainersTab({ orders, counterparties, onEdit }: Props) {
  const { t } = useI18n()
  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  const containers = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.scope === 'international' &&
            o.status !== 'received' &&
            o.status !== 'cancelled' &&
            (o.containerTracking?.enabled ||
              o.legs.some((l) => l.transportMode === 'sea' || l.transportMode === 'mixed')),
        )
        .sort((a, b) => (orderEtaDate(a) ?? '9999').localeCompare(orderEtaDate(b) ?? '9999')),
    [orders],
  )

  if (!containers.length) {
    return (
      <div className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-16 text-center text-stone-500">
        {t('procurement.containersEmpty')}
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {containers.map((o) => {
        const supplier = cpMap.get(o.counterpartyId)
        const tr = o.containerTracking
        const ref = tr?.reference?.trim()
        const eta = orderEtaDate(o)

        return (
          <article
            key={o.id}
            className="flex flex-col overflow-hidden rounded-sm border border-teal-200/80 bg-white shadow-sm"
          >
            <header className="border-b border-grid bg-teal-50 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <button
                    type="button"
                    className="font-mono text-sm font-bold text-teal-800 hover:underline"
                    onClick={() => onEdit(o)}
                  >
                    {o.orderNumber}
                  </button>
                  <p className="text-sm font-medium text-ink">{supplier?.name ?? '—'}</p>
                </div>
                <OrderStatusBadge status={o.status} />
              </div>
              {ref && tr?.enabled && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-sm bg-teal-700 px-2 py-0.5 font-mono text-xs font-bold text-white">
                    {ref}
                  </span>
                  <span className="text-xs text-stone-600">{carrierLabel(tr.carrier)}</span>
                  <a
                    href={buildCarrierTrackingUrl(tr.carrier, ref, tr.referenceType)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    {t('procurement.tracking.openPortal')} ↗
                  </a>
                </div>
              )}
              {tr?.lastLocation && (
                <p className="mt-1 text-xs text-stone-600">
                  {t('procurement.tracking.currentLocation')}:{' '}
                  <strong>{tr.lastLocation}</strong>
                  {tr.lastEventLabel ? ` — ${tr.lastEventLabel}` : ''}
                </p>
              )}
              {eta && (
                <p className="mt-1 text-xs text-stone-500">
                  {t('procurement.col.eta')}: <span className="tabular-nums font-semibold">{eta}</span>
                </p>
              )}
            </header>
            <div className="flex-1 p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {t('procurement.tracking.pathTitle')}
              </p>
              <ContainerPathTimeline milestones={o.milestones} />
              {!ref && (
                <p className="mt-3 text-xs text-amber-700">{t('procurement.containersNoRef')}</p>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
