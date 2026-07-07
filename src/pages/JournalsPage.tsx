import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import type { AppUser } from '@/lib/access/types'
import { resolveJournalCategories, type JournalScopeContext } from '@/lib/journals/access'
import {
  collectJournalEntries,
  countJournalEntriesByCategory,
  filterJournalEntries,
} from '@/lib/journals/collect'
import type { JournalCategory, JournalLink } from '@/lib/journals/types'
import type { AppStore } from '@/lib/types'
import { useI18n } from '@/context/I18nContext'

type Props = {
  store: AppStore
  currentUser?: AppUser | null
  scope?: JournalScopeContext
  onOpenEntry?: (link: JournalLink, mode: 'view' | 'edit') => void
}

function formatAt(iso: string, locale: string): { date: string; time: string } {
  try {
    const d = new Date(iso)
    const loc = locale === 'ka' ? 'ka-GE' : 'ru-RU'
    return {
      date: d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    }
  } catch {
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
  }
}

export function JournalsPage({ store, currentUser, scope = {}, onOpenEntry }: Props) {
  const { t, tf, locale } = useI18n()
  const ctx: JournalScopeContext = {
    roleId: currentUser?.roleId,
    ...scope,
  }

  const allowedCategories = useMemo(() => resolveJournalCategories(ctx), [
    ctx.roleId,
    ctx.webHrMode,
    ctx.webFinanceMode,
    ctx.webWarehouseMode,
    ctx.webTechnologistMode,
    ctx.webProcurementMode,
    ctx.webWorkshopMasterMode,
    ctx.webHrInspectorMode,
  ])

  const allEntries = useMemo(
    () => collectJournalEntries(store, allowedCategories),
    [
      allowedCategories,
      store.auditLog,
      store.employees,
      store.settings.locale,
      store.sales,
      store.production,
      store.warehouse,
      store.formulations,
      store.technologistQc,
      store.procurement,
      store.workwear,
      store.itOffice,
    ],
  )

  const counts = useMemo(() => countJournalEntriesByCategory(allEntries), [allEntries])

  const [activeCategories, setActiveCategories] = useState<Set<JournalCategory>>(
    () => new Set(allowedCategories),
  )
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const asOf = useAsOfSnapshot()
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
    asOfIso,
  } = asOf

  const filtered = useMemo(
    () =>
      filterJournalEntries(allEntries, {
        categories: activeCategories,
        search,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        docStatus: statusFilter || undefined,
        asOfIso: asOfIso ?? undefined,
      }),
    [allEntries, activeCategories, search, dateFrom, dateTo, statusFilter, asOfIso],
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

  function openEntry(link: JournalLink | undefined, mode: 'view' | 'edit' = 'view') {
    if (!link || !onOpenEntry) return
    onOpenEntry(link, mode)
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

      <AsOfSnapshotBar
        className="mb-4"
        enabled={asOfEnabled}
        onEnabledChange={setAsOfEnabled}
        date={asOfDate}
        onDateChange={setAsOfDate}
        time={asOfTime}
        onTimeChange={setAsOfTime}
        hintKey="asOf.hintJournals"
      />

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
          <FormField label={t('journals.colStatus')}>
            <Input
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              placeholder={t('journals.statusPlaceholder')}
            />
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
                  <th className="w-28">{t('journals.colDocDate')}</th>
                  <th className="w-16">{t('journals.colTime')}</th>
                  <th className="w-36">{t('journals.colCategory')}</th>
                  <th className="w-32">{t('journals.colDocType')}</th>
                  <th className="w-28">{t('journals.colNumber')}</th>
                  <th className="w-36">{t('journals.colActor')}</th>
                  <th className="w-24">{t('journals.colStatus')}</th>
                  <th>{t('journals.colDetail')}</th>
                  <th className="w-28">{t('journals.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((e) => {
                  const when = formatAt(e.at, locale)
                  return (
                    <tr
                      key={e.id}
                      className={e.link ? 'cursor-pointer hover:bg-teal-50/50' : undefined}
                      onDoubleClick={() => openEntry(e.link, e.mode ?? 'view')}
                    >
                      <td className="whitespace-nowrap font-mono text-xs text-stone-600">
                        {e.docDate ?? when.date}
                      </td>
                      <td className="whitespace-nowrap font-mono text-xs text-stone-500">
                        {when.time}
                      </td>
                      <td>
                        <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-700">
                          {t(`journals.category.${e.category}`)}
                        </span>
                      </td>
                      <td className="text-xs font-medium text-stone-700">
                        {e.docTypeKey ? t(e.docTypeKey as 'nav.month') : e.title}
                      </td>
                      <td className="font-mono text-xs text-teal-800">
                        {e.docNumber ?? e.title}
                      </td>
                      <td className="text-xs text-stone-600">{e.actor ?? '—'}</td>
                      <td className="text-xs text-stone-500">{e.docStatus ?? '—'}</td>
                      <td className="max-w-md text-stone-600">
                        <span className="line-clamp-2">{e.detail}</span>
                      </td>
                      <td>
                        {e.link && onOpenEntry ? (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium hover:bg-stone-50"
                              onClick={() => openEntry(e.link, 'view')}
                            >
                              {t('journals.open')}
                            </button>
                            {e.mode === 'edit' && (
                              <button
                                type="button"
                                className="rounded-sm bg-teal-700 px-2 py-1 text-[11px] font-semibold text-white"
                                onClick={() => openEntry(e.link, 'edit')}
                              >
                                {t('common.edit')}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-stone-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
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
