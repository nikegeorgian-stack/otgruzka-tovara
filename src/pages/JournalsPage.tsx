import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import type { AppUser } from '@/lib/access/types'
import { resolveJournalCategories, type JournalScopeContext } from '@/lib/journals/access'
import {
  collectJournalEntries,
  countJournalEntriesByCategory,
  filterJournalEntries,
} from '@/lib/journals/collect'
import type { JournalCategory } from '@/lib/journals/types'
import type { AppStore } from '@/lib/types'
import { useI18n } from '@/context/I18nContext'

type Props = {
  store: AppStore
  currentUser?: AppUser | null
  scope?: JournalScopeContext
}

function formatAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

export function JournalsPage({ store, currentUser, scope = {} }: Props) {
  const { t, tf, locale } = useI18n()
  const ctx: JournalScopeContext = {
    roleId: currentUser?.roleId,
    ...scope,
  }

  const allowedCategories = useMemo(() => resolveJournalCategories(ctx), [ctx])

  const allEntries = useMemo(
    () => collectJournalEntries(store, allowedCategories),
    [store, allowedCategories],
  )

  const counts = useMemo(() => countJournalEntriesByCategory(allEntries), [allEntries])

  const [activeCategories, setActiveCategories] = useState<Set<JournalCategory>>(
    () => new Set(allowedCategories),
  )
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filtered = useMemo(
    () =>
      filterJournalEntries(allEntries, {
        categories: activeCategories,
        search,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    [allEntries, activeCategories, search, dateFrom, dateTo],
  )

  function toggleCategory(cat: JournalCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) {
        if (next.size === 1) return next
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }

  function selectAllCategories() {
    setActiveCategories(new Set(allowedCategories))
  }

  return (
    <PageLayout>
      <PageHeader
        badge={t('journals.badge')}
        title={t('journals.title')}
        subtitle={t('journals.subtitle')}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {allowedCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`text-left rounded-sm transition ${
              activeCategories.has(cat) ? 'ring-2 ring-teal-500/60' : 'opacity-60 hover:opacity-100'
            }`}
            onClick={() => toggleCategory(cat)}
          >
            <KpiCard label={t(`journals.category.${cat}`)} value={counts[cat] ?? 0} />
          </button>
        ))}
      </div>

      <Card className="mb-4" title={t('journals.filters')}>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t('journals.search')} className="min-w-[12rem] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('journals.searchPlaceholder')}
            />
          </FormField>
          <FormField label={t('journals.dateFrom')}>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </FormField>
          <FormField label={t('journals.dateTo')}>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </FormField>
          <button
            type="button"
            className="fc-btn fc-btn--ghost fc-btn--sm mb-0.5"
            onClick={selectAllCategories}
          >
            {t('journals.allCategories')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {allowedCategories.map((cat) => {
            const on = activeCategories.has(cat)
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                  on
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t(`journals.category.${cat}`)}
                <span className="ml-1 opacity-80">({counts[cat] ?? 0})</span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card
        title={t('journals.listTitle')}
        description={tf('journals.listHint', { count: String(filtered.length) })}
      >
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">{t('journals.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th className="w-36">{t('journals.colWhen')}</th>
                  <th className="w-40">{t('journals.colCategory')}</th>
                  <th className="w-48">{t('journals.colEvent')}</th>
                  <th>{t('journals.colDetail')}</th>
                  <th className="w-36">{t('journals.colActor')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap font-mono text-xs text-stone-500">
                      {formatAt(e.at, locale)}
                    </td>
                    <td>
                      <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-700">
                        {t(`journals.category.${e.category}`)}
                      </span>
                    </td>
                    <td className="font-medium">{e.title}</td>
                    <td className="text-stone-600">{e.detail}</td>
                    <td className="text-xs text-stone-500">{e.actor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <p className="mt-3 text-center text-xs text-stone-500">
                {tf('journals.truncated', { count: String(filtered.length) })}
              </p>
            )}
          </div>
        )}
      </Card>
    </PageLayout>
  )
}
