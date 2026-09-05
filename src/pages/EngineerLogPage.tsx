import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { EngineerLogEntryDialog } from '@/components/engineerLog/EngineerLogEntryDialog'
import { EngineerLogKanban } from '@/components/engineerLog/EngineerLogKanban'
import { EngineerTeaReminder } from '@/components/engineerLog/EngineerTeaReminder'
import { VoiceDictationButton } from '@/components/engineerLog/VoiceDictationButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { KanbanViewToggle, type KanbanViewMode } from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import type { EngineerLogDraft } from '@/lib/engineerLog/init'
import { normalizeEngineerLogStore } from '@/lib/engineerLog/init'
import {
  draftFromTemplate,
  ENGINEER_LOG_TEMPLATES,
  type EngineerLogTemplateId,
} from '@/lib/engineerLog/templates'
import {
  ENGINEER_LOG_KINDS,
  type EngineerLogEntry,
  type EngineerLogEntryKind,
  type EngineerLogStore,
} from '@/lib/engineerLog/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftIso(iso: string, delta: number): string {
  const [y, m, day] = iso.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeOf(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleTimeString(intlLocale(locale), {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(11, 16)
  }
}

const KIND_DOT: Record<EngineerLogEntryKind, string> = {
  note: 'bg-stone-400',
  remark: 'bg-amber-500',
  task_done: 'bg-emerald-500',
  issue: 'bg-rose-500',
  inspection: 'bg-sky-500',
  idea: 'bg-violet-500',
  handoff: 'bg-orange-500',
}

type FilterMode = 'all' | 'pinned' | 'open' | EngineerLogEntryKind

type Props = {
  engineerLog: EngineerLogStore
  authorId?: string
  authorName?: string
  onUpsert: (draft: EngineerLogDraft) => string
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleChecklistItem: (entryId: string, itemId: string) => void
  onSetStatus: (id: string, status: EngineerLogEntry['status']) => void
}

export function EngineerLogPage({
  engineerLog,
  authorId,
  authorName,
  onUpsert,
  onRemove,
  onTogglePin,
  onToggleChecklistItem,
  onSetStatus,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [date, setDate] = useState(todayIso)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [editing, setEditing] = useState<EngineerLogDraft | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dayViewMode, setDayViewMode] = useState<KanbanViewMode>('list')

  const [quickKind, setQuickKind] = useState<EngineerLogEntryKind>('note')
  const [quickTitle, setQuickTitle] = useState('')
  const [quickArea, setQuickArea] = useState('')
  const quickTitleRef = useRef<HTMLInputElement>(null)

  const log = useMemo(() => normalizeEngineerLogStore(engineerLog), [engineerLog])

  const openIssueRows = useMemo(
    () =>
      log.entries
        .filter((e) => e.kind === 'issue' && e.status !== 'done')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [log.entries],
  )

  const dayEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return log.entries
      .filter((e) => e.date === date)
      .filter((e) => {
        if (filter === 'pinned') return e.pinned
        if (filter === 'open') return e.status === 'open' || (e.kind === 'issue' && e.status !== 'done')
        if (filter !== 'all') return e.kind === filter
        return true
      })
      .filter((e) => {
        if (!q) return true
        const hay = `${e.title} ${e.body} ${e.tags.join(' ')} ${e.area ?? ''} ${e.equipment ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.createdAt.localeCompare(a.createdAt)
      })
  }, [log.entries, date, filter, query])

  const pinnedCount = useMemo(() => log.entries.filter((e) => e.pinned).length, [log.entries])
  const todayCount = useMemo(
    () => log.entries.filter((e) => e.date === todayIso()).length,
    [log.entries],
  )
  const dayDoneChecklist = useMemo(() => {
    let done = 0
    let total = 0
    for (const e of dayEntries) {
      for (const c of e.checklist ?? []) {
        total += 1
        if (c.done) done += 1
      }
    }
    return { done, total }
  }, [dayEntries])

  const isToday = date === todayIso()

  function openFull(kind: EngineerLogEntryKind = 'note') {
    setEditing({
      kind,
      date,
      title: '',
      body: '',
      tags: [],
      authorId,
      authorName,
      status: kind === 'issue' ? 'open' : kind === 'task_done' ? 'done' : undefined,
      severity: kind === 'issue' ? 'watch' : undefined,
      pinned: false,
    })
  }

  function applyTemplate(id: EngineerLogTemplateId) {
    const tpl = ENGINEER_LOG_TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    const checklistTexts = tpl.checklistKeys?.map((k) => t(`engineerLog.tpl.${k}`))
    setEditing(
      draftFromTemplate(tpl, {
        date,
        title: t(`engineerLog.tpl.${tpl.titleKey}`),
        body: t(`engineerLog.tpl.${tpl.bodyKey}`),
        checklistTexts,
        authorId,
        authorName,
      }),
    )
  }

  function submitQuick() {
    const title = quickTitle.trim()
    if (!title) {
      quickTitleRef.current?.focus()
      return
    }
    onUpsert({
      kind: quickKind,
      date,
      title,
      body: '',
      tags: [],
      area: quickArea.trim() || undefined,
      authorId,
      authorName,
      status: quickKind === 'issue' ? 'open' : quickKind === 'task_done' ? 'done' : undefined,
      severity: quickKind === 'issue' ? 'watch' : undefined,
      pinned: false,
    })
    setQuickTitle('')
    setQuickArea('')
    quickTitleRef.current?.focus()
  }

  const appendQuickTitle = useCallback((text: string) => {
    setQuickTitle((prev) => {
      const t = text.trim()
      if (!t) return prev
      return prev.trim() ? `${prev.trim()} ${t}` : t
    })
  }, [])

  async function removeEntry(id: string) {
    const ok = await confirm({
      title: t('engineerLog.deleteTitle'),
      message: t('engineerLog.deleteMsg'),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (ok) onRemove(id)
  }

  function editEntry(e: EngineerLogEntry) {
    setEditing({
      id: e.id,
      kind: e.kind,
      date: e.date,
      title: e.title,
      body: e.body,
      tags: e.tags,
      severity: e.severity,
      status: e.status,
      area: e.area,
      equipment: e.equipment,
      checklist: e.checklist,
      pinned: e.pinned,
      authorId: e.authorId,
      authorName: e.authorName,
      createdAt: e.createdAt,
    })
  }

  const filterChips: { id: FilterMode; label: string }[] = [
    { id: 'all', label: t('engineerLog.filterAll') },
    { id: 'open', label: t('engineerLog.filterOpen') },
    { id: 'pinned', label: t('engineerLog.filterPinned') },
    { id: 'issue', label: t('engineerLog.kind.issue') },
    { id: 'inspection', label: t('engineerLog.kind.inspection') },
    { id: 'handoff', label: t('engineerLog.kind.handoff') },
    { id: 'remark', label: t('engineerLog.kind.remark') },
  ]

  return (
    <PageLayout>
      <PageHeader
        badge={t('engineerLog.badge')}
        title={t('engineerLog.title')}
        subtitle={t('engineerLog.subtitle')}
        density="compact"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="h-9 cursor-pointer rounded-sm border border-grid bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
              onClick={() => openFull('issue')}
              data-coach="engineer_log:newIssue"
            >
              + {t('engineerLog.kind.issue')}
            </button>
            <button
              type="button"
              className="h-9 cursor-pointer rounded-sm bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
              onClick={() => openFull('note')}
              data-coach="engineer_log:addFull"
            >
              {t('engineerLog.addFull')}
            </button>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-6xl">
        <EngineerTeaReminder />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 lg:gap-4">
        {/* KPI / фильтры статуса */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiBtn
            label={t('engineerLog.kpiDay')}
            value={String(dayEntries.length)}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          <KpiBtn
            label={t('engineerLog.kpiOpen')}
            value={String(openIssueRows.length)}
            tone={openIssueRows.length ? 'warn' : 'neutral'}
            active={filter === 'open'}
            onClick={() => setFilter('open')}
          />
          <KpiBtn
            label={t('engineerLog.kpiPinned')}
            value={String(pinnedCount)}
            active={filter === 'pinned'}
            onClick={() => setFilter('pinned')}
          />
          <KpiBtn
            label={t('engineerLog.kpiToday')}
            value={String(todayCount)}
            onClick={() => {
              setDate(todayIso())
              setFilter('all')
            }}
          />
        </div>

        {/* Открытые проблемы (все дни) */}
        {openIssueRows.length > 0 ? (
          <section className="overflow-hidden rounded-sm border border-rose-200 bg-rose-50/40">
            <div className="flex items-center justify-between gap-2 border-b border-rose-200/80 px-3 py-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-rose-900">
                {tf('engineerLog.openIssuesTitle', { n: openIssueRows.length })}
              </h2>
            </div>
            <ul className="divide-y divide-rose-100">
              {openIssueRows.slice(0, 8).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm sm:flex-nowrap">
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer font-mono text-[11px] font-semibold tabular-nums text-rose-800 underline-offset-2 hover:underline"
                    onClick={() => {
                      setDate(e.date)
                      setFilter('all')
                      setExpandedId(e.id)
                    }}
                  >
                    {e.date}
                  </button>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.title}</span>
                  {e.severity === 'critical' ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase text-rose-700">
                      {t('engineerLog.severity.critical')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                    onClick={() => onSetStatus(e.id, 'done')}
                  >
                    {t('engineerLog.markDone')}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer px-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink"
                    onClick={() => editEntry(e)}
                  >
                    {t('common.edit')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Панель дня + быстрый ввод */}
        <section className="rounded-sm border border-grid bg-surface">
          <div className="flex flex-col gap-2 border-b border-grid px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <NavBtn ariaLabel="prev" onClick={() => setDate((d) => shiftIso(d, -1))}>
                ‹
              </NavBtn>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayIso())}
                className="h-8 w-[9.75rem] cursor-pointer rounded-sm border border-grid bg-surface px-2 text-sm font-semibold tabular-nums outline-none focus:border-accent"
              />
              <NavBtn ariaLabel="next" onClick={() => setDate((d) => shiftIso(d, 1))}>
                ›
              </NavBtn>
              {!isToday ? (
                <button
                  type="button"
                  className="h-8 cursor-pointer rounded-sm border border-accent/35 bg-accent-soft px-2 text-[11px] font-bold text-accent hover:bg-accent hover:text-white"
                  onClick={() => setDate(todayIso())}
                >
                  {t('engineerLog.today')}
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-accent">{t('engineerLog.today')}</span>
              )}
              {dayDoneChecklist.total > 0 ? (
                <span className="ml-1 text-[11px] tabular-nums text-ink-muted">
                  {tf('engineerLog.checklistProgress', {
                    done: dayDoneChecklist.done,
                    total: dayDoneChecklist.total,
                  })}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="sr-only sm:not-sr-only">{t('engineerLog.templates')}</span>
                <select
                  className="h-8 max-w-[14rem] cursor-pointer rounded-sm border border-grid bg-surface px-2 text-xs font-medium text-ink outline-none focus:border-accent"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value as EngineerLogTemplateId | ''
                    e.target.value = ''
                    if (id) applyTemplate(id)
                  }}
                >
                  <option value="">{t('engineerLog.templatesSelect')}</option>
                  {ENGINEER_LOG_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {t(`engineerLog.tplBtn.${tpl.id}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Быстрая запись — Enter сохраняет; микрофон — диктовка */}
          <form
            className="grid gap-2 border-b border-grid bg-paper/40 px-3 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] lg:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_auto_auto] sm:px-4"
            onSubmit={(e) => {
              e.preventDefault()
              submitQuick()
            }}
          >
            <select
              value={quickKind}
              onChange={(e) => setQuickKind(e.target.value as EngineerLogEntryKind)}
              className="h-9 cursor-pointer rounded-sm border border-grid bg-surface px-2 text-xs font-semibold outline-none focus:border-accent"
              aria-label={t('engineerLog.field.kind')}
            >
              {ENGINEER_LOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`engineerLog.kind.${k}`)}
                </option>
              ))}
            </select>
            <input
              ref={quickTitleRef}
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder={t('engineerLog.quickAddPh')}
              className="h-9 min-w-0 rounded-sm border border-grid bg-surface px-3 text-sm outline-none focus:border-accent sm:col-span-1"
            />
            <input
              value={quickArea}
              onChange={(e) => setQuickArea(e.target.value)}
              placeholder={t('engineerLog.field.area')}
              className="h-9 min-w-0 rounded-sm border border-grid bg-surface px-2 text-sm outline-none focus:border-accent lg:block"
            />
            <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:contents">
              <VoiceDictationButton onText={appendQuickTitle} />
              <button
                type="submit"
                className="h-9 min-w-[5.5rem] flex-1 cursor-pointer rounded-sm bg-stone-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-stone-800 lg:flex-none"
              >
                {t('engineerLog.quickAdd')}
              </button>
            </div>
          </form>

          <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:px-4">
            <KanbanViewToggle
              mode={dayViewMode}
              onChange={setDayViewMode}
              dataCoachKanban="engineerLog:viewKanban"
              className="shrink-0"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('engineerLog.search')}
              className="h-8 min-w-0 flex-1 rounded-sm border border-grid bg-surface px-2.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filterChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  className={[
                    'h-8 shrink-0 cursor-pointer rounded-sm border px-2 text-[11px] font-semibold transition-colors',
                    filter === chip.id
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-grid bg-surface text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Записи дня: список или канбан по статусу */}
        {dayViewMode === 'kanban' ? (
          <section className="rounded-sm border border-grid bg-surface p-3">
            <EngineerLogKanban
              entries={dayEntries}
              onOpen={editEntry}
              onSetStatus={onSetStatus}
            />
          </section>
        ) : (
        <section className="overflow-hidden rounded-sm border border-grid bg-surface">
          {dayEntries.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-ink">{t('engineerLog.emptyTitle')}</p>
              <p className="mt-1 text-xs text-ink-muted">{t('engineerLog.emptyHint')}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="h-8 cursor-pointer rounded-sm bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover"
                  onClick={() => quickTitleRef.current?.focus()}
                >
                  {t('engineerLog.quickAdd')}
                </button>
                <button
                  type="button"
                  className="h-8 cursor-pointer rounded-sm border border-grid px-3 text-xs font-semibold hover:border-accent"
                  onClick={() => applyTemplate('morning_round')}
                >
                  {t('engineerLog.tplBtn.morning_round')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Узкий экран / APK — карточки */}
              <ul className="divide-y divide-grid md:hidden">
                {dayEntries.map((e) => {
                  const open = expandedId === e.id
                  const checkTotal = e.checklist?.length ?? 0
                  const checkDone = e.checklist?.filter((c) => c.done).length ?? 0
                  return (
                    <li
                      key={e.id}
                      className={[
                        'px-3 py-3',
                        e.kind === 'issue' && e.status !== 'done' ? 'bg-rose-50/40' : '',
                        e.pinned ? 'bg-accent-soft/25' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer text-left"
                          onClick={() => setExpandedId(open ? null : e.id)}
                        >
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                            <span className="font-mono tabular-nums">{timeOf(e.createdAt, locale)}</span>
                            <span className="inline-flex items-center gap-1 font-semibold text-ink">
                              <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[e.kind]}`} aria-hidden />
                              {t(`engineerLog.kind.${e.kind}`)}
                            </span>
                            {e.status ? <span>{t(`engineerLog.status.${e.status}`)}</span> : null}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-ink">
                            {e.pinned ? `[${t('engineerLog.pinned')}] ` : ''}
                            {e.title}
                            {checkTotal > 0 ? (
                              <span className="ml-1 font-normal text-ink-muted">
                                ({checkDone}/{checkTotal})
                              </span>
                            ) : null}
                          </p>
                          {[e.area, e.equipment].filter(Boolean).length > 0 ? (
                            <p className="mt-0.5 truncate text-xs text-ink-muted">
                              {[e.area, e.equipment].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.kind === 'issue' && e.status !== 'done' ? (
                          <RowAction tone="ok" onClick={() => onSetStatus(e.id, 'done')}>
                            {t('engineerLog.markDoneShort')}
                          </RowAction>
                        ) : null}
                        <RowAction onClick={() => onTogglePin(e.id)}>
                          {e.pinned ? t('engineerLog.unpin') : t('engineerLog.pin')}
                        </RowAction>
                        <RowAction onClick={() => editEntry(e)}>{t('common.edit')}</RowAction>
                        <RowAction tone="danger" onClick={() => void removeEntry(e.id)}>
                          {t('common.delete')}
                        </RowAction>
                      </div>
                      {open ? (
                        <div className="mt-3 border-t border-grid pt-3">
                          {e.body.trim() ? (
                            <p className="whitespace-pre-wrap text-sm text-ink">{e.body}</p>
                          ) : (
                            <p className="text-xs text-ink-muted">{t('engineerLog.noBody')}</p>
                          )}
                          {e.checklist && e.checklist.length > 0 ? (
                            <ul className="mt-2 space-y-1.5">
                              {e.checklist.map((c) => (
                                <li key={c.id}>
                                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={c.done}
                                      onChange={() => onToggleChecklistItem(e.id, c.id)}
                                      className="mt-0.5"
                                    />
                                    <span className={c.done ? 'text-stone-400 line-through' : ''}>{c.text}</span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>

              {/* Широкий экран — таблица */}
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-grid bg-paper text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                    <th className="w-14 px-3 py-2">{t('engineerLog.col.time')}</th>
                    <th className="w-28 px-2 py-2">{t('engineerLog.col.kind')}</th>
                    <th className="px-2 py-2">{t('engineerLog.col.title')}</th>
                    <th className="w-32 px-2 py-2">{t('engineerLog.col.area')}</th>
                    <th className="w-24 px-2 py-2">{t('engineerLog.col.status')}</th>
                    <th className="w-40 px-2 py-2 text-right">{t('engineerLog.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dayEntries.map((e) => {
                    const open = expandedId === e.id
                    const checkTotal = e.checklist?.length ?? 0
                    const checkDone = e.checklist?.filter((c) => c.done).length ?? 0
                    return (
                      <Fragment key={e.id}>
                        <tr
                          className={[
                            'border-b border-grid/70 align-top transition-colors',
                            e.kind === 'issue' && e.status !== 'done' ? 'bg-rose-50/30' : 'hover:bg-paper/80',
                            e.pinned ? 'bg-accent-soft/30' : '',
                          ].join(' ')}
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-ink-muted">
                            {timeOf(e.createdAt, locale)}
                          </td>
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                              <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[e.kind]}`} aria-hidden />
                              {t(`engineerLog.kind.${e.kind}`)}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="cursor-pointer text-left font-medium text-ink hover:text-accent"
                              onClick={() => setExpandedId(open ? null : e.id)}
                            >
                              {e.pinned ? (
                                <span className="mr-1 text-[10px] font-bold text-accent">[{t('engineerLog.pinned')}]</span>
                              ) : null}
                              {e.title}
                              {checkTotal > 0 ? (
                                <span className="ml-1.5 font-normal tabular-nums text-ink-muted">
                                  ({checkDone}/{checkTotal})
                                </span>
                              ) : null}
                            </button>
                            {e.severity === 'critical' ? (
                              <span className="ml-1.5 text-[10px] font-bold uppercase text-rose-700">
                                {t('engineerLog.severity.critical')}
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[8rem] truncate px-2 py-2 text-xs text-ink-muted">
                            {[e.area, e.equipment].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-muted">
                            {e.status ? t(`engineerLog.status.${e.status}`) : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap justify-end gap-0.5">
                              {e.kind === 'issue' && e.status !== 'done' ? (
                                <RowAction tone="ok" onClick={() => onSetStatus(e.id, 'done')}>
                                  {t('engineerLog.markDoneShort')}
                                </RowAction>
                              ) : null}
                              <RowAction onClick={() => onTogglePin(e.id)}>
                                {e.pinned ? t('engineerLog.unpin') : t('engineerLog.pin')}
                              </RowAction>
                              <RowAction onClick={() => editEntry(e)}>{t('common.edit')}</RowAction>
                              <RowAction tone="danger" onClick={() => void removeEntry(e.id)}>
                                {t('common.delete')}
                              </RowAction>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-grid bg-paper/50">
                            <td colSpan={6} className="px-3 py-3 sm:px-4">
                              {e.body.trim() ? (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                  {e.body}
                                </p>
                              ) : (
                                <p className="text-xs text-ink-muted">{t('engineerLog.noBody')}</p>
                              )}
                              {e.tags.length > 0 ? (
                                <p className="mt-2 text-[11px] text-ink-muted">
                                  {e.tags.map((tag) => `#${tag}`).join('  ')}
                                </p>
                              ) : null}
                              {e.checklist && e.checklist.length > 0 ? (
                                <ul className="mt-3 space-y-1.5 border-t border-grid pt-3">
                                  {e.checklist.map((c) => (
                                    <li key={c.id}>
                                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={c.done}
                                          onChange={() => onToggleChecklistItem(e.id, c.id)}
                                          className="mt-0.5"
                                        />
                                        <span className={c.done ? 'text-stone-400 line-through' : ''}>
                                          {c.text}
                                        </span>
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              <p className="mt-2 text-[10px] text-stone-400">
                                {new Date(e.createdAt).toLocaleString()}
                                {e.authorName ? ` · ${e.authorName}` : ''}
                              </p>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
        )}
      </div>

      {editing ? (
        <EngineerLogEntryDialog
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            onUpsert({
              ...next,
              authorId: next.authorId ?? authorId,
              authorName: next.authorName ?? authorName,
            })
            setEditing(null)
          }}
        />
      ) : null}
    </PageLayout>
  )
}

function KpiBtn({
  label,
  value,
  onClick,
  active,
  tone = 'neutral',
}: {
  label: string
  value: string
  onClick?: () => void
  active?: boolean
  tone?: 'neutral' | 'warn'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'cursor-pointer rounded-sm border px-3 py-2 text-left transition-colors',
        active ? 'border-accent bg-accent-soft' : 'border-grid bg-surface hover:border-stone-400',
        tone === 'warn' && !active ? 'border-amber-200 bg-amber-50/50' : '',
      ].join(' ')}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-ink">{value}</div>
    </button>
  )
}

function NavBtn({
  children,
  onClick,
  ariaLabel,
}: {
  children: ReactNode
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-grid bg-surface text-ink hover:border-accent hover:text-accent"
    >
      {children}
    </button>
  )
}

function RowAction({
  children,
  onClick,
  tone = 'neutral',
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'neutral' | 'ok' | 'danger'
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-emerald-800 hover:bg-emerald-50'
      : tone === 'danger'
        ? 'text-rose-700 hover:bg-rose-50'
        : 'text-ink-muted hover:bg-paper hover:text-ink'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-sm px-1.5 py-1 text-[11px] font-semibold ${toneCls}`}
    >
      {children}
    </button>
  )
}
