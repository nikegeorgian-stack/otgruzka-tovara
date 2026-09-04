/**
 * PHASE G5.1 — MRP planning horizon chrome.
 * Capacity м²/shift is explicitly deferred to G6.
 */
import { useI18n } from '@/context/I18nContext'
import { G5_CAPACITY_NOT_CALCULATED_NOTICE } from '@/lib/planner/g5ServerClient'

/** Always-visible capacity deferral; parent may hide until salesPlanning is active. */
export function G5MrpHorizonBanner({ active = true }: { active?: boolean }) {
  const { t } = useI18n()
  if (!active) return null
  const caption = t('g5.mrp.capacityNotCalculated') || G5_CAPACITY_NOT_CALCULATED_NOTICE
  return (
    <div
      className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="status"
    >
      <div className="font-medium">{t('g5.mrp.horizonTitle')}</div>
      <div className="mt-0.5 opacity-90">{t('g5.mrp.horizonDetail')}</div>
      <div className="mt-1 text-xs opacity-80">{caption}</div>
    </div>
  )
}
