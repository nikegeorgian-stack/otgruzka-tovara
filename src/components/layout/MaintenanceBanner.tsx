import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/context/I18nContext'
import { getCoachPortalRoot } from '@/lib/ui/chromeLayout'

export type MaintenanceWindow = {
  announcedAt: string
  untilAt: string
  byName?: string
  message?: string
}

type Props = {
  window: MaintenanceWindow | undefined
  /** Sysadmin: можно снять объявление. */
  canAnnounce?: boolean
  onClear?: () => void
}

function remainingMs(untilAt: string): number {
  const t = Date.parse(untilAt)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, t - Date.now())
}

/** Баннер планового обновления — видят все, пока untilAt не прошёл. */
export function MaintenanceBanner({
  window: maint,
  canAnnounce,
  onClear,
}: Props) {
  const { t, tf } = useI18n()
  const [tick, setTick] = useState(0)
  const active = Boolean(maint && remainingMs(maint.untilAt) > 0)

  useEffect(() => {
    if (!active) return
    const id = globalThis.setInterval(() => setTick((n) => n + 1), 1000)
    return () => globalThis.clearInterval(id)
  }, [active, maint?.untilAt])

  if (!active || !maint) return null

  const ms = remainingMs(maint.untilAt)
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  void tick

  const banner = (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[450] flex justify-center px-3 pt-2 print:hidden"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto max-w-xl rounded-lg border border-amber-400 bg-amber-50 px-4 py-2.5 shadow-lg">
        <p className="text-sm font-bold text-amber-950">
          {maint.message?.trim() || t('maintenance.bannerTitle')}
        </p>
        <p className="mt-0.5 text-xs text-amber-900/90">
          {tf('maintenance.bannerCountdown', {
            m: String(mins),
            s: String(secs).padStart(2, '0'),
          })}
        </p>
        {maint.byName ? (
          <p className="mt-0.5 text-[11px] text-amber-800/70">
            {t('maintenance.by')}: {maint.byName}
          </p>
        ) : null}
        {canAnnounce && onClear ? (
          <button
            type="button"
            className="mt-2 text-[11px] font-semibold text-amber-900 underline"
            onClick={onClear}
          >
            {t('maintenance.clear')}
          </button>
        ) : null}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return banner
  return createPortal(banner, getCoachPortalRoot())
}

/** Объявить окно на 5 минут от сейчас. */
export function buildFiveMinuteMaintenance(byName?: string): MaintenanceWindow {
  const announcedAt = new Date().toISOString()
  const untilAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  return {
    announcedAt,
    untilAt,
    byName,
  }
}
