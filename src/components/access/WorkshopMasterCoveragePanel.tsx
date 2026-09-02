import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import {
  isCoverageActiveOn,
  localTodayIsoDate,
  resolveAbsentMasterBrigades,
} from '@/lib/access/workshopMasterCoverage'
import type { AppUser, WorkshopMasterCoverage } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'

type UpsertInput = {
  id?: string
  coverUserId: string
  absentUserId: string
  brigades?: string[]
  fromDate: string
  toDate: string
  note?: string
  post?: boolean
}

type Props = {
  store: AppStore
  onUpsert: (input: UpsertInput) => void
  onPost: (coverageId: string) => void
  onEnd: (coverageId: string) => void
}

function userLabel(u: AppUser): string {
  return `${u.displayName} (${u.login})`
}

export function WorkshopMasterCoveragePanel({ store, onUpsert, onPost, onEnd }: Props) {
  const { t, tf } = useI18n()
  const { confirm, alert } = useConfirm()
  const today = localTodayIsoDate()

  const masters = useMemo(
    () =>
      store.access.users
        .filter((u) => u.roleId === 'workshop_master' && u.active)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru')),
    [store.access.users],
  )

  const [absentUserId, setAbsentUserId] = useState('')
  const [coverUserId, setCoverUserId] = useState('')
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [note, setNote] = useState('')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const absentUser = masters.find((u) => u.id === absentUserId)

  function loadBrigadesForAbsent(userId: string) {
    const u = masters.find((m) => m.id === userId)
    if (!u) {
      setSelectedBrigades(new Set())
      return
    }
    setSelectedBrigades(new Set(resolveAbsentMasterBrigades(store, u)))
  }

  function toggleBrigade(name: string) {
    setSelectedBrigades((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function coverageErrorMessage(code: string): string {
    const map: Record<string, string> = {
      coverage_users_required: t('coverage.errUsers'),
      coverage_same_user: t('coverage.errSameUser'),
      coverage_dates_invalid: t('coverage.errDates'),
      coverage_dates_order: t('coverage.errDatesOrder'),
      coverage_cover_invalid: t('coverage.errCover'),
      coverage_absent_invalid: t('coverage.errAbsent'),
      coverage_brigades_empty: t('coverage.errBrigades'),
      coverage_invalid: t('coverage.errGeneric'),
      coverage_not_found: t('coverage.errNotFound'),
      coverage_ended_locked: t('coverage.errEndedLocked'),
    }
    return map[code] ?? t('coverage.errGeneric')
  }

  function resetForm() {
    setNote('')
    setAbsentUserId('')
    setCoverUserId('')
    setSelectedBrigades(new Set())
    setFromDate(today)
    setToDate(today)
  }

  function save(post: boolean) {
    setError(null)
    setNotice(null)
    try {
      onUpsert({
        coverUserId,
        absentUserId,
        fromDate,
        toDate,
        note: note.trim() || undefined,
        brigades: [...selectedBrigades],
        post,
      })
      setNotice(post ? t('coverage.savedPosted') : t('coverage.savedDraft'))
      resetForm()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'coverage_invalid'
      setError(coverageErrorMessage(msg))
    }
  }

  async function handlePost(c: WorkshopMasterCoverage) {
    setError(null)
    try {
      onPost(c.id)
      setNotice(tf('coverage.postedOk', { number: c.number }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'coverage_invalid'
      await alert({ message: coverageErrorMessage(msg) })
    }
  }

  async function handleEnd(c: WorkshopMasterCoverage) {
    const isDraft = c.status === 'draft'
    const ok = await confirm({
      title: isDraft ? t('coverage.deleteDraftTitle') : t('coverage.endTitle'),
      message: isDraft ? t('coverage.deleteDraftConfirm') : t('coverage.endConfirm'),
      danger: true,
    })
    if (!ok) return
    try {
      onEnd(c.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'coverage_invalid'
      await alert({ message: coverageErrorMessage(msg) })
    }
  }

  const coverages = useMemo(() => {
    const list = [...(store.access.workshopMasterCoverages ?? [])]
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [store.access.workshopMasterCoverages])

  const drafts = coverages.filter((c) => c.status === 'draft')
  const active = coverages.filter((c) => isCoverageActiveOn(c, today))
  const other = coverages.filter(
    (c) => c.status !== 'draft' && !isCoverageActiveOn(c, today),
  ).slice(0, 20)

  function nameById(id: string): string {
    return store.access.users.find((u) => u.id === id)?.displayName ?? id.slice(0, 8)
  }

  return (
    <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
        {t('coverage.title')}
      </h3>
      <p className="mt-1 text-sm text-stone-500">{t('coverage.hint')}</p>

      {masters.length < 2 ? (
        <p className="mt-3 text-sm text-amber-800">{t('coverage.needTwoMasters')}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-stone-400">
              {t('coverage.absent')}
            </span>
            <select
              className="w-full rounded-sm border border-grid px-2 py-2"
              value={absentUserId}
              onChange={(e) => {
                const id = e.target.value
                setAbsentUserId(id)
                loadBrigadesForAbsent(id)
                if (id && id === coverUserId) setCoverUserId('')
              }}
            >
              <option value="">{t('coverage.pick')}</option>
              {masters.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-stone-400">
              {t('coverage.cover')}
            </span>
            <select
              className="w-full rounded-sm border border-grid px-2 py-2"
              value={coverUserId}
              onChange={(e) => setCoverUserId(e.target.value)}
            >
              <option value="">{t('coverage.pick')}</option>
              {masters
                .filter((u) => u.id !== absentUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-stone-400">
              {t('coverage.from')}
            </span>
            <input
              type="date"
              className="w-full rounded-sm border border-grid px-2 py-2"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-stone-400">
              {t('coverage.to')}
            </span>
            <input
              type="date"
              className="w-full rounded-sm border border-grid px-2 py-2"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase text-stone-400">
              {t('coverage.note')}
            </span>
            <input
              className="w-full rounded-sm border border-grid px-2 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('coverage.notePh')}
            />
          </label>
        </div>
      )}

      {absentUser ? (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase text-stone-400">
            {t('coverage.brigades')}
          </p>
          <ul className="max-h-40 space-y-1 overflow-auto rounded-sm border border-grid p-2">
            {store.brigades.map((b) => (
              <li key={b}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={selectedBrigades.has(b)}
                    onChange={() => toggleBrigade(b)}
                  />
                  <span className="text-sm">{b}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3">
          <FormNotice type="success" message={notice} onDismiss={() => setNotice(null)} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={masters.length < 2 || !absentUserId || !coverUserId}
          onClick={() => save(false)}
        >
          {t('coverage.saveDraft')}
        </Button>
        <Button
          type="button"
          disabled={masters.length < 2 || !absentUserId || !coverUserId}
          onClick={() => save(true)}
        >
          {t('coverage.savePost')}
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <CoverageList
          title={t('coverage.draftList')}
          empty={t('coverage.draftEmpty')}
          items={drafts}
          nameById={nameById}
          onPost={(c) => void handlePost(c)}
          postLabel={t('coverage.post')}
          onEnd={(c) => void handleEnd(c)}
          endLabel={t('coverage.deleteDraft')}
          statusLabel={() => t('coverage.statusDraft')}
        />
        <CoverageList
          title={t('coverage.activeList')}
          empty={t('coverage.activeEmpty')}
          items={active}
          nameById={nameById}
          onEnd={(c) => void handleEnd(c)}
          endLabel={t('coverage.end')}
          statusLabel={(c) => tf('coverage.statusActive', { to: c.toDate })}
        />
        <CoverageList
          title={t('coverage.recentList')}
          empty={t('coverage.recentEmpty')}
          items={other}
          nameById={nameById}
          statusLabel={(c) =>
            c.status === 'ended' || c.endedAt
              ? t('coverage.statusEnded')
              : tf('coverage.statusPast', { to: c.toDate })
          }
        />
      </div>
    </section>
  )
}

function CoverageList({
  title,
  empty,
  items,
  nameById,
  onPost,
  postLabel,
  onEnd,
  endLabel,
  statusLabel,
}: {
  title: string
  empty: string
  items: WorkshopMasterCoverage[]
  nameById: (id: string) => string
  onPost?: (c: WorkshopMasterCoverage) => void
  postLabel?: string
  onEnd?: (c: WorkshopMasterCoverage) => void
  endLabel?: string
  statusLabel: (c: WorkshopMasterCoverage) => string
}) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-stone-400">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-grid rounded-sm border border-grid">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  <span className="mr-2 font-mono text-xs text-accent">{c.number}</span>
                  {nameById(c.coverUserId)} ← {nameById(c.absentUserId)}
                </p>
                <p className="text-xs text-stone-500">
                  {c.fromDate} … {c.toDate} · {statusLabel(c)}
                </p>
                <p className="text-xs text-stone-600">{c.brigades.join(' · ')}</p>
                {c.note ? <p className="text-xs text-stone-400">{c.note}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {onPost && postLabel ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent hover:underline"
                    onClick={() => onPost(c)}
                  >
                    {postLabel}
                  </button>
                ) : null}
                {onEnd && endLabel ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-600 hover:underline"
                    onClick={() => onEnd(c)}
                  >
                    {endLabel}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
