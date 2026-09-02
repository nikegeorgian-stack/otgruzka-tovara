import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import type { UnifiedJournalEntry } from '@/lib/journals/types'

type Props = {
  entries: UnifiedJournalEntry[]
  onOpen?: (entry: UnifiedJournalEntry) => void
}

function formatDay(iso: string, locale: Locale): string {
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(intlLocale(locale), {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleTimeString(intlLocale(locale), {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(11, 16)
  }
}

export function JournalTimeline({ entries, onOpen }: Props) {
  const { t, locale } = useI18n()

  const groups = useMemo(() => {
    const map = new Map<string, UnifiedJournalEntry[]>()
    for (const e of entries) {
      const day = (e.docDate ?? e.at).slice(0, 10)
      const list = map.get(day)
      if (list) list.push(e)
      else map.set(day, [e])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries])

  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-stone-500">{t('journals.empty')}</p>
  }

  return (
    <div className="journal-timeline space-y-6">
      {groups.map(([day, items]) => (
        <section key={day} className="journal-timeline__day">
          <h3 className="journal-timeline__day-label">{formatDay(day, locale)}</h3>
          <ol className="journal-timeline__list">
            {items.map((e) => (
              <li key={e.id} className="journal-timeline__item">
                <div className="journal-timeline__rail" aria-hidden />
                <button
                  type="button"
                  className={`journal-timeline__card ${e.link ? 'journal-timeline__card--link' : ''}`}
                  onClick={() => onOpen?.(e)}
                  disabled={!e.link || !onOpen}
                >
                  <div className="journal-timeline__meta">
                    <time className="font-mono text-xs text-stone-500">
                      {formatTime(e.at, locale)}
                    </time>
                    <span className="journal-timeline__cat">
                      {t(`journals.category.${e.category}`)}
                    </span>
                    {e.docNumber ? (
                      <span className="font-mono text-xs font-semibold text-teal-800">
                        {e.docNumber}
                      </span>
                    ) : null}
                  </div>
                  <p className="journal-timeline__title">{e.title}</p>
                  <p className="journal-timeline__detail">{e.detail}</p>
                  <div className="journal-timeline__footer">
                    {e.actor ? (
                      <span className="text-xs text-stone-500">{e.actor}</span>
                    ) : null}
                    {e.docStatus ? (
                      <span className="journal-timeline__status">{e.docStatus}</span>
                    ) : null}
                    {e.link && onOpen ? (
                      <span className="text-xs font-semibold text-teal-700">
                        {t('journals.open')} →
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
