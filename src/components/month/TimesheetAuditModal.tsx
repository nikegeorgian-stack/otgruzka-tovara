import { useMemo, useState } from 'react'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import { AUDIT_ACTION_LABEL } from '@/lib/journals/classifyAudit'
import { monthProblems } from '@/lib/problems'
import {
  buildTimesheetDayDigest,
  filterTimesheetAudit,
  isRiskyAudit,
} from '@/lib/timesheetDayDigest'
import type { AppStore, MonthSheet } from '@/lib/types'

type Props = {
  store: AppStore
  sheet?: MonthSheet
  month: string
  /** Если задано — только эти бригады (область мастера). */
  brigadeScope?: string[] | 'all'
  onClose: () => void
}

function formatWhen(iso: string, locale: Locale): { date: string; time: string } {
  try {
    const d = new Date(iso)
    const loc = intlLocale(locale)
    return {
      date: d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }
  } catch {
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
  }
}

type ScopeFilter = 'all' | 'today' | 'risky'

export function TimesheetAuditModal({
  store,
  sheet,
  month,
  brigadeScope = 'all',
  onClose,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<ScopeFilter>('today')
  const [copied, setCopied] = useState(false)

  const entries = useMemo(
    () =>
      filterTimesheetAudit({
        store,
        month,
        brigadeScope,
        todayOnly: scope === 'today',
        riskyOnly: scope === 'risky',
        query: q,
      }),
    [store, month, brigadeScope, scope, q],
  )

  const problems = useMemo(
    () => (sheet ? monthProblems(store, sheet) : []),
    [store, sheet],
  )

  async function copyDigest() {
    if (!sheet) return
    const text = buildTimesheetDayDigest({
      store,
      sheet,
      month,
      brigadeScope,
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select via prompt
      window.prompt(t('month.audit.copyManual'), text)
    }
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('month.audit.title')}
      subtitle={t('month.audit.subtitle')}
      size="lg"
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        {problems.length > 0 ? (
          <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="mb-1 font-semibold">{t('month.audit.problemsTitle')}</div>
            <ul className="list-inside list-disc space-y-0.5">
              {problems.map((p) => (
                <li key={p.id}>
                  {p.count != null ? tf(p.messageKey, { count: p.count }) : t(p.messageKey)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-emerald-700">{t('month.audit.noProblems')}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['today', 'month.audit.filterToday'],
              ['risky', 'month.audit.filterRisky'],
              ['all', 'month.audit.filterAll'],
            ] as const
          ).map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
                scope === id
                  ? 'border-stone-800 bg-stone-800 text-white'
                  : 'border-grid bg-white text-stone-700 hover:bg-stone-50'
              }`}
              onClick={() => setScope(id)}
            >
              {t(key)}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto rounded-sm border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100"
            onClick={() => void copyDigest()}
            disabled={!sheet}
            title={t('month.audit.copyDigestHint')}
          >
            {copied ? t('month.audit.copied') : t('month.audit.copyDigest')}
          </button>
        </div>

        <input
          type="search"
          className="rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('month.audit.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="text-[11px] text-stone-500">
          {tf('month.audit.count', { count: entries.length })}
        </p>
        <div className="max-h-[55vh] overflow-auto rounded-sm border border-grid">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-stone-100 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="border-b border-grid px-2 py-2">{t('journals.colWhen')}</th>
                <th className="border-b border-grid px-2 py-2">{t('journals.colTime')}</th>
                <th className="border-b border-grid px-2 py-2">{t('journals.colEvent')}</th>
                <th className="border-b border-grid px-2 py-2">{t('journals.colDetail')}</th>
                <th className="border-b border-grid px-2 py-2">{t('journals.colActor')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-stone-400">
                    {t('month.audit.empty')}
                  </td>
                </tr>
              ) : (
                entries.map((e) => {
                  const when = formatWhen(e.at, locale)
                  const risky = isRiskyAudit(e)
                  return (
                    <tr
                      key={e.id}
                      className={
                        risky
                          ? 'bg-rose-50/80'
                          : 'odd:bg-white even:bg-stone-50/80'
                      }
                    >
                      <td className="border-b border-grid/60 px-2 py-1.5 whitespace-nowrap">
                        {when.date}
                      </td>
                      <td className="border-b border-grid/60 px-2 py-1.5 whitespace-nowrap font-mono text-[11px]">
                        {when.time}
                      </td>
                      <td className="border-b border-grid/60 px-2 py-1.5">
                        {AUDIT_ACTION_LABEL[e.action] ?? e.action}
                      </td>
                      <td className="border-b border-grid/60 px-2 py-1.5 text-stone-700">
                        {e.detail}
                      </td>
                      <td className="border-b border-grid/60 px-2 py-1.5 font-medium text-stone-800">
                        {e.byName ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppDialog>
  )
}
