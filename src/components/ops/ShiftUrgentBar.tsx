import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import type { ShiftUrgentItem, ShiftUrgentTarget, ShiftUrgentTone } from '@/lib/ops/shiftUrgentInbox'

type Props = {
  items: ShiftUrgentItem[]
  /** Не показывать на экране директора — там уже полный пульс */
  hidden?: boolean
  onGo: (target: ShiftUrgentTarget) => void
}

function toneClass(tone: ShiftUrgentTone) {
  if (tone === 'critical') return 'border-red-300 bg-red-50 text-red-950'
  if (tone === 'warn') return 'border-amber-300 bg-amber-50 text-amber-950'
  return 'border-sky-200 bg-sky-50 text-sky-950'
}

function chipClass(tone: ShiftUrgentTone) {
  if (tone === 'critical') return 'bg-red-600 text-white hover:bg-red-700'
  if (tone === 'warn') return 'bg-amber-600 text-white hover:bg-amber-700'
  return 'bg-sky-700 text-white hover:bg-sky-800'
}

function strongestTone(items: ShiftUrgentItem[]): ShiftUrgentTone {
  if (items.some((i) => i.tone === 'critical')) return 'critical'
  if (items.some((i) => i.tone === 'warn')) return 'warn'
  return 'info'
}

/** Мягкая полоска «что срочно мне сейчас» — без блокировки работы. */
export function ShiftUrgentBar({ items, hidden, onGo }: Props) {
  const { t, tf } = useI18n()
  const [dismissed, setDismissed] = useState(false)
  const fingerprint = useMemo(
    () => items.map((i) => `${i.id}:${i.count}`).join('|'),
    [items],
  )

  useEffect(() => {
    setDismissed(false)
  }, [fingerprint])

  if (hidden || dismissed || items.length === 0) return null

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-sm ${toneClass(
        strongestTone(items),
      )}`}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('ops.urgent.title')}</p>
        <p className="text-xs opacity-80">{t('ops.urgent.hint')}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-sm px-2.5 py-1 text-xs font-medium transition ${chipClass(item.tone)}`}
            onClick={() => onGo(item.target)}
          >
            {item.labelParams ? tf(item.labelKey, item.labelParams) : t(item.labelKey)}
          </button>
        ))}
      </div>
      <Button type="button" size="xs" variant="ghost" onClick={() => setDismissed(true)}>
        {t('ops.urgent.dismiss')}
      </Button>
    </div>
  )
}
