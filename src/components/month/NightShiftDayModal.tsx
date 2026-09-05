import { useEffect, useMemo, useState } from 'react'
import { collatorLocale } from '@/i18n/localeFormat'
import { AppDialog } from '@/components/ui/AppDialog'
import { BrigadeFillModal } from '@/components/month/BrigadeFillModal'
import { EmployeeAvatar } from '@/components/ui/EmployeeAvatar'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { dayDateKey, daysInMonth, parseMonthKey } from '@/lib/dates'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import {
  brigadesForNightGroup,
  candidateEmployeeIdsForBrigade,
  candidateEmployeeIdsForNightGroup,
} from '@/lib/nightShift/brigades'
import { nightShiftOnDate } from '@/lib/nightShift/init'
import {
  NIGHT_SHIFT_GROUP_IDS,
  type NightShiftGroupId,
} from '@/lib/nightShift/types'
import { getFactMark } from '@/lib/stats'
import { isWorkCode } from '@/lib/factExtra'
import type { AppStore } from '@/lib/types'

type PickMode = 'groups' | 'brigades'

type PersonRow = { id: string; brigade: string; onPlan: boolean }

type FillTarget = {
  brigade: string
  scopeTitle: string
  scopeEmployeeIds: string[]
  initialIds: string[]
}

type Props = {
  store: AppStore
  month: string
  /** День месяца 1–31 при открытии */
  initialDay?: number
  readOnly?: boolean
  onClose: () => void
  onSaveAndPost: (input: {
    id?: string
    date: string
    groups: NightShiftGroupId[]
    brigades?: string[]
    employeeIds: string[]
    note?: string
    reasons?: Record<string, string>
  }) => boolean
  onVoid: (documentId: string) => boolean
}

function personOnPlan(
  sheet: AppStore['months'][string] | undefined,
  employeeId: string,
  dateKey: string,
): boolean {
  if (!sheet) return false
  const row = sheet.rows.find((r) => r.employeeId === employeeId)
  if (!row) return false
  const plan = sheet.plan[row.id]?.[dateKey] ?? ''
  const fact = getFactMark(sheet, row.id, dateKey)
  return isWorkCode(plan) || isWorkCode(fact)
}

function sortPeople(
  rows: PersonRow[],
  store: AppStore,
  employeeNameLines: ReturnType<typeof useI18n>['employeeNameLines'],
): PersonRow[] {
  return [...rows].sort((a, b) => {
    if (a.onPlan !== b.onPlan) return a.onPlan ? -1 : 1
    const ea = store.employees.find((e) => e.id === a.id)
    const eb = store.employees.find((e) => e.id === b.id)
    if (!ea || !eb) return 0
    return employeeNameLines(ea).primary.localeCompare(
      employeeNameLines(eb).primary,
      'ru',
    )
  })
}

export function NightShiftDayModal({
  store,
  month,
  initialDay,
  readOnly = false,
  onClose,
  onSaveAndPost,
  onVoid,
}: Props) {
  const { t, tf, employeeNameLines, locale } = useI18n()
  const { confirm } = useConfirm()
  const { year, month: mo } = parseMonthKey(month)
  const totalDays = daysInMonth(year, mo)

  const todayDay = useMemo(() => {
    const now = new Date()
    if (now.getFullYear() === year && now.getMonth() + 1 === mo) return now.getDate()
    return 1
  }, [year, mo])

  const [day, setDay] = useState(() =>
    Math.min(Math.max(1, initialDay ?? todayDay), totalDays),
  )
  const dateKey = dayDateKey(year, mo, day)
  const existing = nightShiftOnDate(store.nightShifts, dateKey)

  const [pickMode, setPickMode] = useState<PickMode>(() =>
    existing?.brigades?.length ? 'brigades' : 'groups',
  )
  const [groups, setGroups] = useState<Set<NightShiftGroupId>>(
    () => new Set(existing?.groups?.length ? existing.groups : ['line1', 'line2', 'pack', 'mixer']),
  )
  const [brigadesSel, setBrigadesSel] = useState<Set<string>>(
    () => new Set(existing?.brigades ?? []),
  )
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (existing?.employeeIds?.length) return new Set(existing.employeeIds)
    const seed = new Set<string>()
    const defaultGroups: NightShiftGroupId[] = ['line1', 'line2', 'pack', 'mixer']
    const sheet0 = store.months[month]
    for (const g of defaultGroups) {
      for (const id of candidateEmployeeIdsForNightGroup(store, g, month)) {
        if (personOnPlan(sheet0, id, dateKey)) seed.add(id)
      }
    }
    return seed
  })
  const [note, setNote] = useState(existing?.note ?? '')
  const [reasons, setReasons] = useState<Record<string, string>>(
    () => ({ ...(existing?.reasons ?? {}) }),
  )
  const [error, setError] = useState<string | null>(null)
  const [fillTarget, setFillTarget] = useState<FillTarget | null>(null)

  useEffect(() => {
    const doc = nightShiftOnDate(store.nightShifts, dateKey)
    const nextMode: PickMode = doc?.brigades?.length ? 'brigades' : 'groups'
    setPickMode(nextMode)
    const nextGroups = new Set(
      doc?.groups?.length ? doc.groups : (['line1', 'line2', 'pack', 'mixer'] as NightShiftGroupId[]),
    )
    setGroups(nextGroups)
    setBrigadesSel(new Set(doc?.brigades ?? []))
    if (doc?.employeeIds?.length) {
      setSelected(new Set(doc.employeeIds))
    } else {
      const seed = new Set<string>()
      const sheet0 = store.months[month]
      for (const g of nextGroups) {
        for (const id of candidateEmployeeIdsForNightGroup(store, g, month)) {
          if (personOnPlan(sheet0, id, dateKey) || g === 'mechanics') seed.add(id)
        }
      }
      setSelected(seed)
    }
    setNote(doc?.note ?? '')
    setReasons({ ...(doc?.reasons ?? {}) })
    setError(null)
  }, [dateKey, store.nightShifts, month, store])

  const sheet = store.months[month]

  const availableBrigades = useMemo(() => {
    const set = new Set<string>(store.brigades)
    if (sheet) {
      for (const row of sheet.rows) {
        if (row.brigade) set.add(row.brigade)
      }
    }
    return [...set].sort((a, b) =>
      brigadeLabel(a, store.brigadeNamesKa, locale).localeCompare(
        brigadeLabel(b, store.brigadeNamesKa, locale),
        collatorLocale(locale),
      ),
    )
  }, [store.brigades, store.brigadeNamesKa, sheet, locale])

  const candidatesByGroup = useMemo(() => {
    const map = new Map<NightShiftGroupId, PersonRow[]>()
    for (const g of NIGHT_SHIFT_GROUP_IDS) {
      if (!groups.has(g)) continue
      const ids = candidateEmployeeIdsForNightGroup(store, g, month)
      const rows = ids
        .map((id) => {
          const emp = store.employees.find((e) => e.id === id)
          if (!emp || !employeeActiveInMonth(emp, month)) return null
          const brigade =
            emp.brigade ||
            brigadesForNightGroup(g, store.brigades)[0] ||
            ''
          return { id, brigade, onPlan: personOnPlan(sheet, id, dateKey) }
        })
        .filter((x): x is PersonRow => !!x)
      map.set(g, sortPeople(rows, store, employeeNameLines))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, store.employees, store.brigades, month, dateKey, sheet])

  const candidatesByBrigade = useMemo(() => {
    const map = new Map<string, PersonRow[]>()
    for (const b of brigadesSel) {
      const ids = candidateEmployeeIdsForBrigade(store, b, month)
      const rows = ids
        .map((id) => {
          const emp = store.employees.find((e) => e.id === id)
          if (!emp || !employeeActiveInMonth(emp, month)) return null
          return { id, brigade: b, onPlan: personOnPlan(sheet, id, dateKey) }
        })
        .filter((x): x is PersonRow => !!x)
      map.set(b, sortPeople(rows, store, employeeNameLines))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brigadesSel, store.employees, month, dateKey, sheet])

  function switchPickMode(mode: PickMode) {
    if (mode === pickMode || readOnly) return
    setPickMode(mode)
    setError(null)
    if (mode === 'brigades') {
      setGroups(new Set())
    } else {
      setBrigadesSel(new Set())
      setGroups(new Set(['line1', 'line2', 'pack', 'mixer']))
    }
  }

  function toggleGroup(g: NightShiftGroupId) {
    setGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) {
        next.delete(g)
        const drop = new Set(candidateEmployeeIdsForNightGroup(store, g, month))
        setSelected((sel) => new Set([...sel].filter((id) => !drop.has(id))))
      } else {
        next.add(g)
        const add = candidateEmployeeIdsForNightGroup(store, g, month)
        setSelected((sel) => {
          const n = new Set(sel)
          for (const id of add) {
            if (personOnPlan(sheet, id, dateKey) || g === 'mechanics') n.add(id)
          }
          return n
        })
      }
      return next
    })
  }

  function toggleBrigade(brigade: string) {
    setBrigadesSel((prev) => {
      const next = new Set(prev)
      if (next.has(brigade)) {
        next.delete(brigade)
        const drop = new Set(candidateEmployeeIdsForBrigade(store, brigade, month))
        setSelected((sel) => new Set([...sel].filter((id) => !drop.has(id))))
      } else {
        next.add(brigade)
        const add = candidateEmployeeIdsForBrigade(store, brigade, month)
        setSelected((sel) => {
          const n = new Set(sel)
          for (const id of add) {
            if (personOnPlan(sheet, id, dateKey)) n.add(id)
          }
          return n
        })
      }
      return next
    })
  }

  function selectAllInList(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function applyFillSelection(scopeIds: string[], nextIds: string[]) {
    const scope = new Set(scopeIds)
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => !scope.has(id)))
      for (const id of nextIds) next.add(id)
      return next
    })
  }

  function openFillForPeople(
    title: string,
    people: PersonRow[],
    brigadeHint: string,
  ) {
    if (readOnly || !sheet) return
    const scopeIds = people.map((p) => p.id)
    // Если кандидатов ещё нет — даём выбрать из всех (как в плане).
    const scopeEmployeeIds =
      scopeIds.length > 0
        ? scopeIds
        : candidateEmployeeIdsForBrigade(store, brigadeHint, month)
    const initialIds = [...selected].filter((id) =>
      scopeEmployeeIds.length ? scopeEmployeeIds.includes(id) : true,
    )
    setFillTarget({
      brigade: brigadeHint || people[0]?.brigade || '',
      scopeTitle: title,
      scopeEmployeeIds:
        scopeEmployeeIds.length > 0
          ? scopeEmployeeIds
          : store.employees
              .filter((e) => employeeActiveInMonth(e, month))
              .map((e) => e.id),
      initialIds,
    })
  }

  function openFillForGroup(g: NightShiftGroupId, people: PersonRow[]) {
    const hint =
      brigadesForNightGroup(g, store.brigades)[0] ||
      people[0]?.brigade ||
      ''
    openFillForPeople(t(`nightShift.group.${g}`), people, hint)
  }

  function openFillForBrigade(brigade: string, people: PersonRow[]) {
    openFillForPeople(
      brigadeLabel(brigade, store.brigadeNamesKa, locale),
      people,
      brigade,
    )
  }

  function allCandidatePeople(): PersonRow[] {
    const map = pickMode === 'groups' ? candidatesByGroup : candidatesByBrigade
    const seen = new Set<string>()
    const out: PersonRow[] = []
    for (const people of map.values()) {
      for (const p of people) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
      }
    }
    return out
  }

  function openComposeAll() {
    const people = allCandidatePeople()
    openFillForPeople(
      t('nightShift.composeTitle'),
      people,
      people[0]?.brigade || '',
    )
  }

  function setPersonReason(id: string, value: string) {
    setReasons((prev) => ({ ...prev, [id]: value }))
  }

  async function handlePost() {
    if (readOnly) return
    if (selected.size === 0) {
      setError(t('nightShift.needPeople'))
      return
    }
    if (pickMode === 'groups' && groups.size === 0) {
      setError(t('nightShift.needGroups'))
      return
    }
    if (pickMode === 'brigades' && brigadesSel.size === 0) {
      setError(t('nightShift.needBrigades'))
      return
    }
    const postedReasons: Record<string, string> = {}
    for (const id of selected) {
      const text = reasons[id]?.trim()
      if (text) postedReasons[id] = text
    }
    const ok = onSaveAndPost({
      id: existing?.id,
      date: dateKey,
      groups: pickMode === 'groups' ? [...groups] : [],
      brigades: pickMode === 'brigades' ? [...brigadesSel] : undefined,
      employeeIds: [...selected],
      note: note.trim() || undefined,
      reasons: Object.keys(postedReasons).length ? postedReasons : undefined,
    })
    if (!ok) {
      setError(t('nightShift.postFailed'))
      return
    }
    onClose()
  }

  async function handleVoid() {
    if (!existing || existing.status !== 'posted' || readOnly) return
    if (
      !(await confirm({
        message: tf('nightShift.voidConfirm', { number: existing.number }),
        danger: true,
      }))
    ) {
      return
    }
    if (!onVoid(existing.id)) {
      setError(t('nightShift.voidFailed'))
      return
    }
    onClose()
  }

  const dateLabel = `${String(day).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${year}`
  const posted = existing?.status === 'posted'
  const firstReasonId = allCandidatePeople().find((p) => selected.has(p.id))?.id

  function renderPeopleList(
    key: string,
    title: string,
    people: PersonRow[],
    onFill: () => void,
  ) {
    return (
      <div key={key} className="rounded-sm border border-grid bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid px-2.5 py-1.5">
          <span className="text-xs font-semibold text-ink">{title}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {!readOnly && sheet ? (
              <button
                type="button"
                className="rounded-sm border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-900 hover:bg-violet-100"
                title={t('nightShift.fillHint')}
                onClick={onFill}
              >
                {t('nightShift.fill')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={readOnly || !people.length}
              className="text-[10px] text-violet-800 hover:underline disabled:opacity-40"
              onClick={() => selectAllInList(people.map((p) => p.id), true)}
            >
              {t('nightShift.selectAll')}
            </button>
            <span className="text-[10px] text-stone-300">·</span>
            <button
              type="button"
              disabled={readOnly || !people.length}
              className="text-[10px] text-stone-500 hover:underline disabled:opacity-40"
              onClick={() => selectAllInList(people.map((p) => p.id), false)}
            >
              {t('nightShift.selectNone')}
            </button>
          </div>
        </div>
        {people.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] text-stone-400">{t('nightShift.noCandidates')}</p>
        ) : (
          <ul className="divide-y divide-grid">
            {people.map((p) => {
              const emp = store.employees.find((e) => e.id === p.id)
              if (!emp) return null
              const on = selected.has(p.id)
              return (
                <li
                  key={p.id}
                  className={on ? 'bg-violet-50/50' : undefined}
                >
                  <div className="flex items-start gap-2 px-2.5 py-2">
                    <input
                      type="checkbox"
                      className="mt-1.5 h-4 w-4 shrink-0 rounded border-grid text-violet-700 focus:ring-violet-300"
                      checked={on}
                      disabled={readOnly}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(p.id)) next.delete(p.id)
                          else next.add(p.id)
                          return next
                        })
                      }}
                    />
                    <EmployeeAvatar employee={emp} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-sm font-medium text-ink">
                          {employeeNameLines(emp).primary}
                        </span>
                        {pickMode === 'groups' ? (
                          <span className="shrink-0 text-[10px] text-stone-500">
                            {brigadeLabel(p.brigade, store.brigadeNamesKa, locale)}
                          </span>
                        ) : null}
                        {p.onPlan ? (
                          <span className="shrink-0 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">
                            {t('nightShift.onDay')}
                          </span>
                        ) : null}
                      </div>
                      {on ? (
                        <label className="mt-1.5 block">
                          <span className="sr-only">{t('nightShift.reason')}</span>
                          <input
                            type="text"
                            data-coach={p.id === firstReasonId ? 'nightShift:reason' : undefined}
                            value={reasons[p.id] ?? ''}
                            disabled={readOnly}
                            onChange={(e) => setPersonReason(p.id, e.target.value)}
                            className="w-full rounded-sm border border-violet-200 bg-white px-2 py-1 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                            placeholder={t('nightShift.reasonPlaceholder')}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  return (
    <>
    <AppDialog
      open
      onClose={onClose}
      title={t('nightShift.title')}
      size="xl"
      ephemeral
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
        <p className="text-xs text-stone-600">{t('nightShift.hint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-stone-600">{t('nightShift.day')}</label>
          <input
            type="number"
            min={1}
            max={totalDays}
            value={day}
            disabled={readOnly}
            onChange={(e) => setDay(Math.min(totalDays, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded-sm border border-grid px-2 py-1 text-sm"
          />
          <span className="text-sm font-medium text-ink">{dateLabel}</span>
          {existing ? (
            <span
              className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold ${
                posted
                  ? 'bg-violet-100 text-violet-900'
                  : existing.status === 'void'
                    ? 'bg-stone-100 text-stone-500'
                    : 'bg-amber-50 text-amber-900'
              }`}
            >
              {existing.number} · {t(`nightShift.status.${existing.status}`)}
            </span>
          ) : null}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-stone-700">{t('nightShift.pickMode')}</p>
          <div className="inline-flex rounded-sm border border-grid p-0.5">
            {(['groups', 'brigades'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={readOnly}
                onClick={() => switchPickMode(mode)}
                className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                  pickMode === mode
                    ? 'bg-violet-600 text-white'
                    : 'text-stone-600 hover:bg-paper-dark'
                }`}
              >
                {t(`nightShift.pickMode.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        {pickMode === 'groups' ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-stone-700">{t('nightShift.groups')}</p>
            <div className="flex flex-wrap gap-2">
              {NIGHT_SHIFT_GROUP_IDS.map((g) => (
                <button
                  key={g}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggleGroup(g)}
                  className={`rounded-sm border px-2.5 py-1.5 text-xs font-medium ${
                    groups.has(g)
                      ? 'border-violet-400 bg-violet-50 text-violet-950'
                      : 'border-grid text-stone-600 hover:bg-paper-dark'
                  }`}
                >
                  {t(`nightShift.group.${g}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-stone-700">{t('nightShift.brigades')}</p>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {availableBrigades.map((b) => (
                <button
                  key={b}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggleBrigade(b)}
                  className={`rounded-sm border px-2.5 py-1.5 text-xs font-medium ${
                    brigadesSel.has(b)
                      ? 'border-violet-400 bg-violet-50 text-violet-950'
                      : 'border-grid text-stone-600 hover:bg-paper-dark'
                  }`}
                >
                  {brigadeLabel(b, store.brigadeNamesKa, locale)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-stone-700">{t('nightShift.peopleTitle')}</p>
            {!readOnly && sheet ? (
              <button
                type="button"
                data-coach="nightShift:compose"
                className="rounded-sm border border-violet-500 bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700"
                title={t('nightShift.fillHint')}
                onClick={openComposeAll}
              >
                {t('nightShift.fill')}
              </button>
            ) : null}
          </div>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-sm border border-grid bg-paper-dark/30 p-2">
          {pickMode === 'groups'
            ? [...candidatesByGroup.entries()].map(([g, people]) =>
                renderPeopleList(g, t(`nightShift.group.${g}`), people, () =>
                  openFillForGroup(g, people),
                ),
              )
            : [...candidatesByBrigade.entries()].map(([b, people]) =>
                renderPeopleList(
                  b,
                  brigadeLabel(b, store.brigadeNamesKa, locale),
                  people,
                  () => openFillForBrigade(b, people),
                ),
              )}
          {pickMode === 'groups' && groups.size === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-stone-400">
              {t('nightShift.pickGroupsFirst')}
            </p>
          ) : null}
          {pickMode === 'brigades' && brigadesSel.size === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-stone-400">
              {t('nightShift.pickBrigadesFirst')}
            </p>
          ) : null}
          </div>
        </div>

        <label className="block text-xs text-stone-600">
          {t('nightShift.note')}
          <input
            type="text"
            value={note}
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
            placeholder={t('nightShift.notePlaceholder')}
          />
        </label>

        {error ? <p className="text-xs text-red-700">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-3">
          <p className="text-xs text-stone-500">
            {tf('nightShift.selectedCount', { n: selected.size })}
          </p>
          <div className="flex flex-wrap gap-2">
            {posted && !readOnly ? (
              <button
                type="button"
                className="rounded-sm border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
                onClick={() => void handleVoid()}
              >
                {t('nightShift.void')}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-1.5 text-xs font-medium hover:bg-paper-dark"
              onClick={onClose}
            >
              {t('common.close')}
            </button>
            {!readOnly ? (
              <button
                type="button"
                data-coach="nightShift:post"
                className="rounded-sm border border-violet-500 bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                onClick={() => void handlePost()}
              >
                {posted ? t('nightShift.repost') : t('nightShift.post')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </AppDialog>
    {fillTarget && sheet ? (
      <BrigadeFillModal
        store={store}
        sheet={sheet}
        brigade={fillTarget.brigade}
        mode="pick"
        scopeTitle={fillTarget.scopeTitle}
        scopeEmployeeIds={fillTarget.scopeEmployeeIds}
        initialIds={fillTarget.initialIds}
        onSave={(ids) => {
          applyFillSelection(fillTarget.scopeEmployeeIds, ids)
          setFillTarget(null)
        }}
        pickCoach
        onUpsertEmployee={() => {}}
        onClose={() => setFillTarget(null)}
      />
    ) : null}
    </>
  )
}
