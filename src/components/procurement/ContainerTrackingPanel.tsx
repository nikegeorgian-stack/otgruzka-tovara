import { useEffect, useState } from 'react'
import { ContainerPathTimeline } from '@/components/procurement/ContainerPathTimeline'
import { ContainerStatusStepper } from '@/components/procurement/ContainerStatusStepper'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import {
  buildCarrierTrackingUrl,
  carrierLabel,
  SEA_CARRIERS,
} from '@/lib/procurement/tracking/carrierUrls'
import { fetchTrackingCapabilities } from '@/lib/procurement/tracking/client'
import { applyManualTrackingStatus } from '@/lib/procurement/tracking/manualUpdate'
import { guessReferenceType, looksLikeContainerNumber } from '@/lib/procurement/tracking/referenceType'
import { syncOrderFromCarrier } from '@/lib/procurement/tracking/syncOrder'
import type { ContainerTracking, PurchaseOrder, PurchaseOrderStatus } from '@/lib/procurement/types'
import type { TrackingCapabilities } from '@/lib/procurement/tracking/types'

type Props = {
  order: PurchaseOrder
  onChange: (order: PurchaseOrder) => void
  onPersist?: (order: PurchaseOrder) => void
}

const DEFAULT_TRACKING = (): ContainerTracking => ({
  enabled: false,
  carrier: 'msc',
  reference: '',
  referenceType: 'container',
})

export function ContainerTrackingPanel({ order, onChange, onPersist }: Props) {
  const { t } = useI18n()
  const tracking = order.containerTracking ?? DEFAULT_TRACKING()
  const [caps, setCaps] = useState<TrackingCapabilities | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualLocation, setManualLocation] = useState(tracking.lastLocation ?? '')

  useEffect(() => {
    fetchTrackingCapabilities()
      .then(setCaps)
      .catch(() => setCaps(null))
  }, [])

  const carrierMeta = caps?.carriers[tracking.carrier]
  const canAutoFetch = carrierMeta?.configured ?? false
  const usesPublicPortal = carrierMeta?.publicPortal && !carrierMeta?.apiConfigured

  function patchTracking(patch: Partial<ContainerTracking>) {
    onChange({
      ...order,
      containerTracking: { ...tracking, ...patch },
    })
  }

  async function runTrackingSync(persist = false) {
    if (!tracking.reference.trim()) {
      setNotice(t('procurement.tracking.errReference'))
      return
    }
    setSyncing(true)
    setNotice(null)
    try {
      const result = await syncOrderFromCarrier(order)
      if (!result) return

      const { order: updated, response } = result
      onChange(updated)

      if (!response.ok) {
        if (response.message === 'portal_not_available') {
          setNotice(t('procurement.tracking.portalManual'))
        } else if (String(response.error ?? '').includes('msc_no_events')) {
          setNotice(t('procurement.tracking.wrongRefType'))
        } else {
          setNotice(response.error ?? t('procurement.tracking.syncFailed'))
        }
      } else if (!response.events.length) {
        setNotice(t('procurement.tracking.noEvents'))
      } else {
        const msg =
          response.source === 'portal'
            ? t('procurement.tracking.syncOkPortal')
            : t('procurement.tracking.syncOk')
        setNotice(`success:${msg}`)
        if (persist) onPersist?.(updated)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'tracking_route_missing' || msg === 'tracking_server_unreachable') {
        setNotice(t('procurement.tracking.serverRestart'))
      } else {
        setNotice(t('procurement.tracking.syncFailed'))
      }
    } finally {
      setSyncing(false)
    }
  }

  function applyManual(status: PurchaseOrderStatus) {
    const updated = applyManualTrackingStatus(order, status, {
      location: manualLocation.trim() || undefined,
    })
    onChange(updated)
    setNotice(`success:${t('procurement.tracking.manualApplied')}`)
    onPersist?.(updated)
  }

  const trackingUrl = buildCarrierTrackingUrl(
    tracking.carrier,
    tracking.reference,
    tracking.referenceType,
  )

  return (
    <div className="rounded-sm border border-teal-200 bg-teal-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-teal-900">
            {t('procurement.tracking.title')}
          </h4>
          <p className="mt-0.5 text-xs text-teal-800/80">{t('procurement.tracking.subtitleShort')}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-teal-300 bg-white px-3 py-2 text-sm font-semibold text-teal-900">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-teal-400"
            checked={tracking.enabled}
            onChange={(e) => patchTracking({ enabled: e.target.checked })}
          />
          {t('procurement.tracking.autoSync12h')}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-stone-600">
          {t('procurement.tracking.carrier')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={tracking.carrier}
            onChange={(e) =>
              patchTracking({ carrier: e.target.value as ContainerTracking['carrier'] })
            }
          >
            {SEA_CARRIERS.map((c) => (
              <option key={c} value={c}>
                {carrierLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold text-stone-600">
          {t('procurement.tracking.referenceType')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={tracking.referenceType}
            onChange={(e) =>
              patchTracking({
                referenceType: e.target.value as ContainerTracking['referenceType'],
              })
            }
          >
            <option value="container">{t('procurement.tracking.refContainer')}</option>
            <option value="bl">{t('procurement.tracking.refBl')}</option>
            <option value="booking">{t('procurement.tracking.refBooking')}</option>
          </select>
        </label>

        <label className="sm:col-span-2 text-xs font-semibold text-stone-600">
          {t('procurement.tracking.reference')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 font-mono text-sm"
            placeholder="MSKU1234567"
            value={tracking.reference}
            onChange={(e) => {
              const reference = e.target.value.toUpperCase()
              const patch: Partial<ContainerTracking> = { reference }
              if (looksLikeContainerNumber(reference)) {
                patch.referenceType = 'container'
              }
              patchTracking(patch)
            }}
          />
          {looksLikeContainerNumber(tracking.reference) &&
            tracking.referenceType !== 'container' && (
              <p className="mt-1 text-xs text-amber-700">
                {t('procurement.tracking.useContainerType')}
              </p>
            )}
          {tracking.reference.trim() &&
            tracking.referenceType !== guessReferenceType(tracking.reference) &&
            !looksLikeContainerNumber(tracking.reference) && (
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-teal-700 hover:underline"
                onClick={() =>
                  patchTracking({ referenceType: guessReferenceType(tracking.reference) })
                }
              >
                {t('procurement.tracking.suggestRefType')}:{' '}
                {t(`procurement.tracking.ref${guessReferenceType(tracking.reference) === 'container' ? 'Container' : guessReferenceType(tracking.reference) === 'bl' ? 'Bl' : 'Booking'}`)}
              </button>
            )}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={syncing || !tracking.reference.trim()}
          onClick={() => runTrackingSync(true)}
        >
          {syncing ? t('procurement.tracking.syncing') : t('procurement.tracking.syncNow')}
        </button>
        {tracking.reference.trim() && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-grid bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-stone-50"
          >
            {t('procurement.tracking.openPortal')} ↗
          </a>
        )}
        {tracking.lastSyncedAt && (
          <span className="text-xs text-stone-500">
            {t('procurement.tracking.lastSync')}:{' '}
            {new Date(tracking.lastSyncedAt).toLocaleString('ru-RU')}
          </span>
        )}
      </div>

      {usesPublicPortal && (
        <p className="mt-2 text-xs text-teal-800">{t('procurement.tracking.mscPortalHint')}</p>
      )}

      {!canAutoFetch && tracking.carrier !== 'msc' && (
        <p className="mt-2 text-xs text-stone-600">{t('procurement.tracking.portalManual')}</p>
      )}

      <div className="mt-4 rounded-sm border border-grid bg-white p-3">
        <label className="block text-xs font-semibold text-stone-600">
          {t('procurement.tracking.manualLocation')}
          <input
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={t('procurement.tracking.manualLocationPlaceholder')}
            value={manualLocation}
            onChange={(e) => setManualLocation(e.target.value)}
          />
        </label>
        <div className="mt-3">
          <ContainerStatusStepper current={order.status} onSelect={applyManual} />
        </div>
      </div>

      {tracking.lastLocation && (
        <p className="mt-3 text-sm text-stone-700">
          <span className="font-semibold">{t('procurement.tracking.currentLocation')}:</span>{' '}
          {tracking.lastLocation}
          {tracking.lastEventLabel ? ` — ${tracking.lastEventLabel}` : ''}
        </p>
      )}

      {notice && (
        <div className="mt-3">
          <FormNotice
            type={
              notice.startsWith('success:')
                ? 'success'
                : notice.toLowerCase().includes('failed') ||
                    notice.toLowerCase().includes('ошиб')
                  ? 'error'
                  : 'info'
            }
            message={notice.replace(/^success:/, '')}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}

      <div className="mt-4 border-t border-teal-200/80 pt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
          {t('procurement.tracking.pathTitle')}
        </p>
        <ContainerPathTimeline milestones={order.milestones} />
      </div>
    </div>
  )
}
