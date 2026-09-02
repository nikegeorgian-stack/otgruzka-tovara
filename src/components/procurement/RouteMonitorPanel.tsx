import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { routePointLabel } from '@/lib/procurement/catalog'
import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  RoutePoint,
  ShipmentMilestone,
} from '@/lib/procurement/types'
import { ContainerPathTimeline } from './ContainerPathTimeline'
import { TransportModeBadge } from './TransportModeIcon'

type Props = {
  order: PurchaseOrder
  routePoints: RoutePoint[]
  onChange: (next: PurchaseOrder) => void
}

function progressPercent(order: PurchaseOrder): number {
  const legs = order.legs
  if (!legs.length) {
    const done = ['arrived', 'partial', 'received'].includes(order.status)
    return done ? 100 : order.status === 'draft' || order.status === 'ordered' ? 5 : 35
  }
  let done = 0
  for (const leg of legs) {
    if (leg.actualArrivalDate) done += 1
    else if (leg.actualDepartureDate) done += 0.5
  }
  return Math.min(100, Math.round((done / legs.length) * 100))
}

export function RouteMonitorPanel({ order, routePoints, onChange }: Props) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<PurchaseOrderStatus>(order.status)
  const pct = useMemo(() => progressPercent(order), [order])
  const pointById = useMemo(
    () => new Map(routePoints.map((p) => [p.id, p])),
    [routePoints],
  )

  function addManualEvent() {
    const text = note.trim()
    if (!text) return
    const milestone: ShipmentMilestone = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      status,
      location: location.trim() || undefined,
      note: text,
      source: 'manual',
    }
    onChange({
      ...order,
      status,
      milestones: [...order.milestones, milestone],
      updatedAt: new Date().toISOString(),
    })
    setNote('')
    setLocation('')
  }

  return (
    <div className="space-y-4 rounded-sm border border-teal-200 bg-gradient-to-b from-teal-50/80 to-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-teal-900">{t('procurement.routeMonitor.title')}</h3>
          <p className="text-xs text-teal-800/80">{t('procurement.routeMonitor.hint')}</p>
        </div>
        <span className="font-mono text-xs font-semibold text-teal-800">{pct}%</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-teal-100">
        <div
          className="h-full rounded-full bg-teal-600 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {order.legs.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {order.legs.map((leg, idx) => {
            const origin =
              (leg.originPointId && pointById.get(leg.originPointId)) ||
              null
            const dest =
              (leg.destinationPointId && pointById.get(leg.destinationPointId)) ||
              null
            const arrived = Boolean(leg.actualArrivalDate)
            const departed = Boolean(leg.actualDepartureDate)
            return (
              <li
                key={leg.id}
                className={`flex min-w-[10rem] flex-1 items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-all duration-500 ${
                  arrived
                    ? 'border-emerald-300 bg-emerald-50'
                    : departed
                      ? 'animate-pulse border-amber-300 bg-amber-50'
                      : 'border-grid bg-white'
                }`}
              >
                <span className="font-mono text-[10px] text-stone-400">{idx + 1}</span>
                <TransportModeBadge mode={leg.transportMode} />
                <span className="truncate text-stone-700">
                  {origin ? routePointLabel(origin) : leg.origin || '—'}
                  {' → '}
                  {dest ? routePointLabel(dest) : leg.destination || '—'}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-stone-500">
          {t('procurement.col.status')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
          >
            {(
              [
                'ordered',
                'production',
                'shipped',
                'in_transit',
                'customs',
                'arrived',
                'partial',
                'received',
              ] as PurchaseOrderStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {t(`procurement.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-stone-500">
          {t('procurement.tracking.manualLocation')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={location}
            placeholder={t('procurement.tracking.manualLocationPlaceholder')}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className="sm:col-span-2 text-xs font-semibold text-stone-500">
          {t('procurement.routeMonitor.event')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={note}
            placeholder={t('procurement.routeMonitor.eventPlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addManualEvent()
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        onClick={addManualEvent}
      >
        + {t('procurement.routeMonitor.addEvent')}
      </button>

      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
          {t('procurement.tracking.pathTitle')}
        </h4>
        <ContainerPathTimeline milestones={order.milestones} />
      </div>
    </div>
  )
}
