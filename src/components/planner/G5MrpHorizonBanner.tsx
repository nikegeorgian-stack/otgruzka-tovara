/**
 * PHASE G5.1 / G6 — MRP planning horizon chrome.
 * Capacity м²/shift deferred notice is hidden after G6 capacityPlanning is active.
 */
import { useI18n } from '@/context/I18nContext'
import { g6FlagsFromStore } from '@/lib/planner/g6Activation'
import { G5_CAPACITY_NOT_CALCULATED_NOTICE } from '@/lib/planner/g5ServerClient'
import type { AppStore } from '@/lib/types'

/** Always-visible capacity deferral until G6 is active; parent may hide until salesPlanning is active. */
export function G5MrpHorizonBanner({
  active = true,
  store,
}: {
  active?: boolean
  store?: AppStore | null
}) {
  const { t } = useI18n()
  if (!active) return null
  const g6Active = g6FlagsFromStore(store ?? null).capacityPlanningActive
  const caption = g6Active
    ? null
    : t('g5.mrp.capacityNotCalculated') || G5_CAPACITY_NOT_CALCULATED_NOTICE
  return (
    <div
      className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="status"
    >
      <div className="font-medium">{t('g5.mrp.horizonTitle')}</div>
      <div className="mt-0.5 opacity-90">{t('g5.mrp.horizonDetail')}</div>
      {caption ? <div className="mt-1 text-xs opacity-80">{caption}</div> : null}
      {g6Active ? (
        <div className="mt-1 text-xs opacity-80">{t('g6.capacity.horizonActive')}</div>
      ) : null}
    </div>
  )
}
