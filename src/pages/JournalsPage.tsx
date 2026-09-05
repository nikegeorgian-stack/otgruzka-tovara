import { useEffect, useMemo, useState } from 'react'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import {
  JournalDocumentOverlay,
  journalOverlayTarget,
  type JournalOverlayTarget,
} from '@/components/journals/JournalDocumentOverlay'
import { JournalDocumentTrail } from '@/components/journals/JournalDocumentTrail'
import { JournalTimeline } from '@/components/journals/JournalTimeline'
import type { FinanceDocumentActions } from '@/components/finance/financeTypes'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import type { AppUser } from '@/lib/access/types'
import {
  prefersDocumentsJournalView,
  resolveJournalCategories,
  type JournalScopeContext,
} from '@/lib/journals/access'
import { timesheetAccess } from '@/lib/access/timesheetScope'
import {
  buildJournalIndex,
  journalDatePresetRange,
  queryJournalIndex,
  type JournalDatePreset,
  type JournalKindFilter,
  type JournalViewMode,
} from '@/lib/journals/journalIndex'
import {
  issueDraftFromReceipt,
  journalCommandsForEntry,
  loadingInputFromJournalSales,
  type JournalCommand,
} from '@/lib/journals/commands'
import { countGroup, groupCategoriesForAllowed } from '@/lib/journals/groups'
import type { JournalCategory, JournalLink } from '@/lib/journals/types'
import type { AppStore } from '@/lib/types'
import type { UnifiedJournalEntry } from '@/lib/journals/types'
import type { WarehousePrintMeta } from '@/lib/warehouse/printDocument'
import type { ComponentProps } from 'react'
import { useI18n } from '@/context/I18nContext'

type OverlayWarehouse = ComponentProps<typeof JournalDocumentOverlay>['warehouse']
type OverlayLoading = NonNullable<ComponentProps<typeof JournalDocumentOverlay>['loading']>

type Props = {
  store: AppStore
  currentUser?: AppUser | null
  scope?: JournalScopeContext
  activeMonth: string
  /** Переход в раздел, если окно поверх журнала недоступно */
  onOpenEntry?: (link: JournalLink, mode: 'view' | 'edit') => void
  brigades: string[]
  printMeta?: WarehousePrintMeta
  allowNegativeStock?: boolean
  financeDocumentActions?: FinanceDocumentActions
  warehouseDocActions: OverlayWarehouse
  loadingDocActions?: OverlayLoading
  onUpsertSalesOrder?: ComponentProps<typeof JournalDocumentOverlay>['onUpsertSalesOrder']
  onReceivePurchaseOrder?: (orderId: string) => { ok: true; documentId: string } | { ok: false; error: string }
  onCreateDisbursementFromAccrual?: (
    accrualId: string,
    opts: { date: string; method: 'cash' | 'bank' | 'card' },
  ) => string | null
}

function formatAt(iso: string, locale: Locale): { date: string; time: string } {
  try {
    const d = new Date(iso)
    const loc = intlLocale(locale)
    return {
      date: d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    }
  } catch {
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
  }
}

function resolveJournalStatusLabel(
  t: (key: string) => string,
  entry: UnifiedJournalEntry,
): string {
  const s = entry.docStatus
  if (!s) return '—'
  const candidates: string[] = []
  if (entry.docTypeKey?.startsWith('fin.accrual')) candidates.push(`fin.accrual.status.${s}`)
  if (entry.docTypeKey?.startsWith('fin.advDoc') || entry.docTypeKey?.startsWith('fin.payout')) {
    candidates.push(`fin.advDoc.status.${s}`)
  }
  if (entry.category === 'sales') candidates.push(`journals.sales.status.${s}`)
  candidates.push(
    `warehouse.doc.status.${s}`,
    `fin.advDoc.status.${s}`,
    `fin.accrual.status.${s}`,
    `journals.sales.status.${s}`,
  )
  for (const key of candidates) {
    const label = t(key)
    if (label !== key) return label
  }
  return s
}

const DATE_PRESETS: { id: JournalDatePreset; labelKey: string }[] = [
  { id: 'all', labelKey: 'journals.preset.all' },
  { id: 'today', labelKey: 'journals.preset.today' },
  { id: '7d', labelKey: 'journals.preset.7d' },
  { id: '30d', labelKey: 'journals.preset.30d' },
  { id: 'month', labelKey: 'journals.preset.month' },
  { id: 'year', labelKey: 'journals.preset.year' },
]

const KIND_FILTERS: { id: JournalKindFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'journals.kind.all' },
  { id: 'document', labelKey: 'journals.kind.document' },
  { id: 'event', labelKey: 'journals.kind.event' },
  { id: 'linked', labelKey: 'journals.kind.linked' },
]

const VIEW_MODES: { id: JournalViewMode; labelKey: string }[] = [
  { id: 'timeline', labelKey: 'journals.view.timeline' },
  { id: 'table', labelKey: 'journals.view.table' },
  { id: 'documents', labelKey: 'journals.view.documents' },
]

export function JournalsPage({
  store,
  currentUser,
  scope = {},
  activeMonth,
  onOpenEntry,
  brigades,
  printMeta,
  allowNegativeStock,
  financeDocumentActions,
  warehouseDocActions,
  loadingDocActions,
  onUpsertSalesOrder,
  onReceivePurchaseOrder,
  onCreateDisbursementFromAccrual,
}: Props) {
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

  const index = useMemo(() => {
    const ts = currentUser ? timesheetAccess(store, currentUser) : null
    const viewerBrigades =
      ts && ts.viewBrigades !== 'all' ? ts.viewBrigades : null
    return buildJournalIndex(store, allowedCategories, {
      viewerUserId: currentUser?.id,
      viewerRoleId: currentUser?.roleId,
      viewerBrigades,
    })
  }, [
      allowedCategories,
      currentUser?.id,
      currentUser?.roleId,
      store,
      store.auditLog,
      store.timesheetEntries,
      store.employees,
      store.warehouse,
      store.sales,
      store.production,
      store.procurement,
      store.formulations,
      store.technologistQc,
      store.workwear,
      store.itOffice,
      store.counterparties,
      store.access,
    ])

  const filterGroups = useMemo(
    () => groupCategoriesForAllowed(allowedCategories),
    [allowedCategories],
  )

  const [activeCategories, setActiveCategories] = useState<Set<JournalCategory>>(
    () => new Set(allowedCategories),
  )
  const [search, setSearch] = useState('')
  const [datePreset, setDatePreset] = useState<JournalDatePreset>(() =>
    prefersDocumentsJournalView(allowedCategories) ? 'month' : '30d',
  )
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<JournalKindFilter>('all')
  const [viewMode, setViewMode] = useState<JournalViewMode>(() =>
    prefersDocumentsJournalView(allowedCategories) ? 'documents' : 'timeline',
  )
  const [selectedEntry, setSelectedEntry] = useState<UnifiedJournalEntry | null>(null)
  const [overlay, setOverlay] = useState<JournalOverlayTarget | null>(null)

  useEffect(() => {
    if (activeCategories.size !== 1) return
    const only = [...activeCategories][0]
    if (
      only === 'warehouse_documents' ||
      only === 'warehouse_loading' ||
      only === 'finance' ||
      only === 'sales'
    ) {
      setViewMode('documents')
    }
  }, [activeCategories])

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

  const presetRange = useMemo(
    () => journalDatePresetRange(datePreset),
    [datePreset],
  )

  const filtered = useMemo(
    () =>
      queryJournalIndex(index, {
        categories: activeCategories,
        search,
        dateFrom: dateFrom || presetRange.dateFrom,
        dateTo: dateTo || presetRange.dateTo,
        docStatus: statusFilter || undefined,
        actor: actorFilter || undefined,
        kindFilter,
        asOfIso: asOfIso ?? undefined,
        viewMode,
        limit: 500,
      }),
    [
      index,
      activeCategories,
      search,
      dateFrom,
      dateTo,
      presetRange,
      statusFilter,
      actorFilter,
      kindFilter,
      asOfIso,
      viewMode,
    ],
  )

  function toggleCategory(cat: JournalCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) {
        if (next.size === 1) return prev
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }

  function toggleGroup(categories: JournalCategory[]) {
    setActiveCategories(new Set(categories))
  }

  function isGroupActive(categories: JournalCategory[]): boolean {
    return categories.length > 0 && categories.every((c) => activeCategories.has(c))
  }

  const selectedCommands = useMemo(
    () => (selectedEntry ? journalCommandsForEntry(store, selectedEntry) : []),
    [selectedEntry, store],
  )

  function runBasedOn(
    entry: UnifiedJournalEntry,
    basedOn: NonNullable<Extract<JournalCommand, { id: 'basedOn' }>['basedOn']>,
  ) {
    if (!entry.link) return
    if (basedOn === 'receipt_from_po' && entry.link.kind === 'procurement_order') {
      const result = onReceivePurchaseOrder?.(entry.link.orderId)
      if (result?.ok) {
        setOverlay({ kind: 'warehouse_document', documentId: result.documentId, mode: 'edit' })
      }
      return
    }
    if (basedOn === 'issue_from_receipt' && entry.link.kind === 'warehouse_document') {
      const { documentId } = entry.link
      const doc = store.warehouse.documents.find((d) => d.id === documentId)
      if (!doc) return
      const draft = issueDraftFromReceipt(store.warehouse, doc, t('journals.basedOn.issueFromReceiptShort'))
      if (!draft) return
      const saveDraft = warehouseDocActions.onSaveDocumentDraft
      if (!saveDraft) return
      void Promise.resolve(saveDraft(draft)).then((result) => {
        if (result.ok) {
          setOverlay({ kind: 'warehouse_document', documentId: result.documentId, mode: 'edit' })
        }
      })
      return
    }
    if (basedOn === 'loading_from_sales' && entry.link.kind === 'sales_order') {
      const input = loadingInputFromJournalSales(store, entry.link.orderId)
      if (!input || !loadingDocActions?.onUpsertLoadingShipment) return
      const id = loadingDocActions.onUpsertLoadingShipment(input)
      setOverlay({ kind: 'warehouse_loading', shipmentId: id })
      return
    }
    if (basedOn === 'advance_from_accrual' && entry.link.kind === 'finance_accrual_document') {
      const id = onCreateDisbursementFromAccrual?.(entry.link.documentId, {
        date: new Date().toISOString().slice(0, 10),
        method: 'bank',
      })
      if (id) {
        setOverlay({
          kind: 'finance_advance_document',
          documentId: id,
          month: entry.link.month,
        })
      }
    }
  }

  function runCommand(cmd: JournalCommand, entry: UnifiedJournalEntry) {
    if (cmd.id === 'open') {
      openEntry(entry, 'view')
      return
    }
    if (cmd.id === 'openEdit') {
      openEntry(entry, 'edit')
      return
    }
    if (cmd.id === 'openSection') {
      if (entry.link) onOpenEntry?.(entry.link, 'view')
      return
    }
    if (cmd.id === 'basedOn' && cmd.basedOn) {
      runBasedOn(entry, cmd.basedOn)
    }
  }

  function openEntry(entry: UnifiedJournalEntry, mode: 'view' | 'edit' = 'view') {
    if (!entry.link) return
    const overlayTarget = journalOverlayTarget(entry.link)
    if (overlayTarget) {
      if (overlayTarget.kind === 'warehouse_document') {
        setOverlay({
          ...overlayTarget,
          mode: mode ?? entry.mode ?? 'view',
        })
      } else {
        setOverlay(overlayTarget)
      }
      return
    }
    onOpenEntry?.(entry.link, mode)
  }

  return (
    <PageLayout>
      <PageHeader
        badge={t('journals.badge')}
        title={t('journals.title')}
        subtitle={t('journals.subtitle')}
        meta={
          <div className="journal-view-tabs">
            {VIEW_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`journal-view-tab ${viewMode === m.id ? 'journal-view-tab--on' : ''}`}
                onClick={() => setViewMode(m.id)}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" data-coach="journals:categories">
        {filterGroups.map((g) => {
          const on = isGroupActive(g.categories)
          const n = countGroup(index.counts, g.categories)
          return (
            <button
              key={g.id}
              type="button"
              className={`rounded-sm border px-3 py-2 text-left text-sm transition ${
                on
                  ? 'border-teal-600 bg-teal-50 text-teal-900 ring-2 ring-teal-500/40'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
              }`}
              onClick={() => toggleGroup(g.categories)}
            >
              <span className="font-semibold">{t(g.labelKey)}</span>
              <span className="ml-2 text-xs opacity-80">{n}</span>
            </button>
          )
        })}
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

      <div data-coach="journals:filters">
      <Card className="mb-4" title={t('journals.filters')}>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t('journals.search')} className="min-w-[12rem] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('journals.searchPlaceholder')}
            />
          </FormField>
          <FormField label={t('journals.colActor')}>
            <select
              className="w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
            >
              <option value="">{t('journals.allActors')}</option>
              {index.facets.actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('journals.colStatus')}>
            <select
              className="w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t('journals.allStatuses')}</option>
              {index.facets.docStatuses.map((s) => (
                <option key={s} value={s}>
                  {resolveJournalStatusLabel(t, { docStatus: s } as UnifiedJournalEntry) !== s
                    ? resolveJournalStatusLabel(t, { docStatus: s } as UnifiedJournalEntry)
                    : s}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`rounded-sm px-2.5 py-1 text-xs font-semibold ${
                kindFilter === k.id
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
              onClick={() => setKindFilter(k.id)}
            >
              {t(k.labelKey)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded-sm px-2.5 py-1 text-xs font-semibold ${
                datePreset === p.id
                  ? 'bg-teal-700 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
              onClick={() => setDatePreset(p.id)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <FormField label={t('journals.dateFrom')}>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </FormField>
          <FormField label={t('journals.dateTo')}>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </FormField>
          <button
            type="button"
            className="fc-btn fc-btn--ghost fc-btn--sm mb-0.5"
            onClick={() => setActiveCategories(new Set(allowedCategories))}
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
                <span className="ml-1 opacity-80">({index.counts[cat] ?? 0})</span>
              </button>
            )
          })}
        </div>
      </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_min(20rem,30%)]">
        <Card
          title={t('journals.listTitle')}
          description={tf('journals.listHint', { count: String(filtered.length) })}
        >
          {viewMode === 'timeline' ? (
            <JournalTimeline
              entries={filtered}
              onOpen={(e) => {
                setSelectedEntry(e)
                openEntry(e, e.mode ?? 'view')
              }}
            />
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-500">{t('journals.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="fc-table w-full text-sm">
                <thead>
                  <tr>
                    {viewMode === 'documents' ? (
                      <>
                        <th className="w-28">{t('journals.colNumber')}</th>
                        <th className="w-28">{t('journals.colDocDate')}</th>
                        <th className="w-36">{t('journals.colDocType')}</th>
                        <th className="w-28">{t('journals.colStatus')}</th>
                        <th className="w-44">{t('journals.colCounterparty')}</th>
                        <th className="w-36">{t('journals.colActor')}</th>
                        <th className="w-28">{t('journals.colActions')}</th>
                      </>
                    ) : (
                      <>
                        <th className="w-28">{t('journals.colDocDate')}</th>
                        <th className="w-16">{t('journals.colTime')}</th>
                        <th className="w-36">{t('journals.colCategory')}</th>
                        <th className="w-28">{t('journals.colNumber')}</th>
                        <th className="w-36">{t('journals.colActor')}</th>
                        <th>{t('journals.colDetail')}</th>
                        <th className="w-28">{t('journals.colActions')}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const when = formatAt(e.at, locale)
                    const statusLabel = resolveJournalStatusLabel(t, e)
                    const typeLabel = e.docTypeKey ? t(e.docTypeKey) : t(`journals.category.${e.category}`)
                    const cmds = journalCommandsForEntry(store, e)
                    const primaryCmd = cmds[0]
                    return (
                      <tr
                        key={e.id}
                        className={`${e.link ? 'cursor-pointer hover:bg-teal-50/50' : ''} ${selectedEntry?.id === e.id ? 'bg-teal-50/80' : ''}`}
                        onClick={() => {
                          setSelectedEntry(e)
                          if (viewMode === 'documents') openEntry(e, e.mode ?? 'view')
                        }}
                        onDoubleClick={() => {
                          if (viewMode !== 'documents') openEntry(e, e.mode ?? 'view')
                        }}
                      >
                        {viewMode === 'documents' ? (
                          <>
                            <td className="font-mono text-xs text-teal-800">{e.docNumber ?? e.title}</td>
                            <td className="whitespace-nowrap font-mono text-xs text-stone-600">
                              {e.docDate ?? when.date}
                            </td>
                            <td className="text-xs text-stone-700">{typeLabel}</td>
                            <td className="text-xs text-stone-600">{statusLabel}</td>
                            <td className="text-xs text-stone-600">{e.counterpartyName ?? '—'}</td>
                            <td className="text-xs text-stone-600">{e.actor ?? '—'}</td>
                            <td>
                              {primaryCmd ? (
                                <button
                                  type="button"
                                  className="rounded-sm bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    setSelectedEntry(e)
                                    runCommand(primaryCmd, e)
                                  }}
                                >
                                  {t(primaryCmd.labelKey)}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </>
                        ) : (
                          <>
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
                            <td className="font-mono text-xs text-teal-800">{e.docNumber ?? '—'}</td>
                            <td className="text-xs text-stone-600">{e.actor ?? '—'}</td>
                            <td className="max-w-md text-stone-600">
                              <span className="line-clamp-2">{e.detail}</span>
                            </td>
                            <td>
                              {primaryCmd ? (
                                <button
                                  type="button"
                                  className="rounded-sm bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    setSelectedEntry(e)
                                    runCommand(primaryCmd, e)
                                  }}
                                >
                                  {t(primaryCmd.labelKey)}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length >= 500 && (
            <p className="mt-3 text-center text-xs text-stone-500">
              {tf('journals.truncated', { count: String(index.entries.length) })}
            </p>
          )}
        </Card>

        <Card title={t('journals.trail.panelTitle')} description={t('journals.trail.panelHint')}>
          {selectedEntry ? (
            <>
              <p className="text-sm font-semibold text-ink">{selectedEntry.title}</p>
              <p className="mt-1 text-xs text-stone-600">{selectedEntry.detail}</p>
              {selectedCommands.length > 0 ? (
                <div
                  className="mt-3 flex flex-col gap-1.5"
                  data-coach="journals:commands"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                    {t('journals.cmd.title')}
                  </p>
                  {selectedCommands.map((cmd) => (
                    <button
                      key={`${cmd.id}-${cmd.id === 'basedOn' ? cmd.basedOn : ''}`}
                      type="button"
                      className={`rounded-sm px-3 py-1.5 text-left text-xs font-semibold ${
                        cmd.id === 'basedOn'
                          ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                          : 'bg-teal-700 text-white hover:bg-teal-800'
                      }`}
                      onClick={() => runCommand(cmd, selectedEntry)}
                    >
                      {t(cmd.labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
              <JournalDocumentTrail store={store} entry={selectedEntry} />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-stone-400">{t('journals.trail.select')}</p>
          )}
        </Card>
      </div>

      {overlay && (
        <JournalDocumentOverlay
          store={store}
          target={overlay}
          onClose={() => setOverlay(null)}
          brigades={brigades}
          productionRequests={store.production?.requests}
          printMeta={printMeta}
          allowNegativeStock={allowNegativeStock}
          keeperId={currentUser?.id}
          keeperName={currentUser?.displayName}
          warehouse={warehouseDocActions}
          loading={loadingDocActions}
          financeDocumentActions={financeDocumentActions}
          onUpsertSalesOrder={onUpsertSalesOrder}
          activeMonth={activeMonth}
        />
      )}
    </PageLayout>
  )
}
