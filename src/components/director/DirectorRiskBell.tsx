import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { AppStore } from '@/lib/types'
import {
  atRiskOrderIds,
  markRisksSeen,
  newRiskIds,
  writeDirectorNavHint,
} from '@/lib/sales/directorActions'

type Props = {
  store: AppStore
  enabled: boolean
  onOpenDirector: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DirectorRiskBell({ store, enabled, onOpenDirector }: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const riskIds = useMemo(() => {
    if (!enabled) return [] as string[]
    return atRiskOrderIds(
      store.sales.orders,
      store.production.planner.orders,
      store.production.requests,
      todayIso(),
    )
  }, [enabled, store.sales.orders, store.production.planner.orders, store.production.requests])

  const fresh = useMemo(() => newRiskIds(riskIds), [riskIds])
  const badge = fresh.length > 0 ? fresh.length : riskIds.length > 0 ? riskIds.length : 0
  const hasFresh = fresh.length > 0

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!enabled) return null

  function openRisks() {
    markRisksSeen(riskIds)
    writeDirectorNavHint({ riskOnly: true, tab: 'queue' })
    setOpen(false)
    onOpenDirector()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={[
          'relative rounded-md border px-2 py-1 text-[11px] font-semibold',
          hasFresh
            ? 'border-amber-400 bg-amber-50 text-amber-950'
            : 'border-stone-300/80 bg-white text-ink hover:bg-stone-50',
        ].join(' ')}
        aria-label={t('director.notify.aria')}
        title={t('director.notify.aria')}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>⚠</span>
        {badge > 0 && (
          <span
            className={[
              'ml-1 inline-flex min-w-[1.1rem] justify-center rounded-sm px-1 text-[10px] tabular-nums',
              hasFresh ? 'bg-red-600 text-white' : 'bg-stone-200 text-stone-700',
            ].join(' ')}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-stone-200 bg-white p-2 shadow-lg">
          <p className="text-xs font-semibold text-stone-800">{t('director.notify.title')}</p>
          {riskIds.length === 0 ? (
            <p className="mt-1 text-xs text-stone-500">{t('director.notify.empty')}</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-stone-600">
                {hasFresh
                  ? tf('director.notify.fresh', { count: fresh.length })
                  : tf('director.notify.total', { count: riskIds.length })}
              </p>
              <button
                type="button"
                className="mt-2 w-full rounded-md border border-teal-600 bg-teal-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700"
                onClick={openRisks}
              >
                {t('director.notify.open')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
