import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { addDaysIso, formatShortDate } from '@/lib/dates'
import {
  cookAdvanceSummary,
  cookDayTotals,
  mealCatalogItemName,
  mealCompositionText,
  mealDayExtraIds,
  mealOrderLineName,
  orderMealCost,
  ordersForDate,
  tbilisiParts,
  weekStartIso,
} from '@/lib/meals/calc'
import { getMeals } from '@/lib/meals/init'
import type { MealCatalogItem, MealCompositionLine } from '@/lib/meals/types'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onAccept: (date: string) => void
  onUnaccept: (date: string) => void
  onUpsertCatalogItem: (item: MealCatalogItem) => void
  onSetWeekBase: (weekStart: string, date: string, baseItemId: string | null) => void
  onSetDayExtras: (weekStart: string, date: string, extraIds: string[]) => void
  onCopyPreviousWeek: (weekStart: string) => boolean
  onPublishWeek: (weekStart: string) => boolean
  onAddAdvance: (input: { amountGel: number; receivedAt: string; note?: string }) => string | null
}

const money = (value: number) => `${value.toFixed(2)} ₾`

type CompositionDraft = { name: string; grams: string }

const emptyCompositionLine = (): CompositionDraft => ({ name: '', grams: '' })

function toComposition(lines: CompositionDraft[]): MealCompositionLine[] {
  return lines.flatMap((line, index) => {
    const name = line.name.trim()
    if (!name) return []
    const grams = Number(line.grams)
    return [{
      id: `c${index}`,
      nameRu: name,
      nameKa: name,
      nameEn: name,
      ...(Number.isFinite(grams) && grams > 0 ? { grams: Math.round(grams) } : {}),
    }]
  })
}

export function CookMealsPanelV2({
  store,
  onAccept,
  onUnaccept,
  onUpsertCatalogItem,
  onSetWeekBase,
  onSetDayExtras,
  onCopyPreviousWeek,
  onPublishWeek,
  onAddAdvance,
}: Props) {
  const { t, locale, tf } = useI18n()
  const meals = getMeals(store)
  const today = tbilisiParts().date
  const [weekStart, setWeekStart] = useState(() => weekStartIso(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [baseName, setBaseName] = useState('')
  const [baseLines, setBaseLines] = useState<CompositionDraft[]>([emptyCompositionLine()])
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null)
  const [extraName, setExtraName] = useState('')
  const [extraPrice, setExtraPrice] = useState('')
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceDate, setAdvanceDate] = useState(today)
  const [advanceNote, setAdvanceNote] = useState('')
  const [message, setMessage] = useState('')

  const week = meals.weeks.find((row) => row.id === weekStart)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDaysIso(weekStart, index)
    return week?.days.find((day) => day.date === date) ?? { date }
  })
  const catalogById = useMemo(
    () => new Map(meals.catalog.map((item) => [item.id, item])),
    [meals.catalog],
  )
  const baseItems = meals.catalog
    .filter((item) => item.active && item.kind === 'base')
    .sort((a, b) => a.sort - b.sort)
  const extraItems = meals.catalog
    .filter((item) => item.active && item.kind === 'extra')
    .sort((a, b) => a.sort - b.sort)
  const readOnly = week?.status === 'published'
  const selectedDayBaseId = days.find((day) => day.date === selectedDate)?.baseItemId
  const selectedDayBase = selectedDayBaseId ? catalogById.get(selectedDayBaseId) : undefined
  const selectedDay = cookDayTotals(meals, selectedDate)
  const selectedOrders = ordersForDate(meals.orders, selectedDate)
  const advance = cookAdvanceSummary(meals)
  const weekOrders = meals.orders
    .filter(
      (order) =>
        order.date >= weekStart &&
        order.date <= addDaysIso(weekStart, 6) &&
        order.status !== 'cancelled',
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName))
  const weekTotals = weekOrders.reduce(
    (sum, order) => {
      const cost = orderMealCost(order, meals.settings.pricing)
      return {
        employee: sum.employee + cost.employeeGel,
        company: sum.company + cost.companyGel,
      }
    },
    { employee: 0, company: 0 },
  )

  function addCatalog(kind: 'base' | 'extra') {
    if (kind === 'base') {
      const name = baseName.trim()
      if (!name) return
      const existing = editingBaseId ? catalogById.get(editingBaseId) : undefined
      onUpsertCatalogItem({
        id: existing?.id ?? `base-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'base',
        nameRu: name,
        nameKa: name,
        nameEn: name,
        employeePriceGel: 0,
        composition: toComposition(baseLines),
        active: true,
        sort: existing?.sort ?? meals.catalog.length,
      })
      setBaseName('')
      setBaseLines([emptyCompositionLine()])
      setEditingBaseId(null)
      return
    }
    const name = extraName.trim()
    const price = Number(extraPrice)
    if (!name || !Number.isFinite(price) || price < 0) return
    onUpsertCatalogItem({
      id: `extra-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'extra',
      nameRu: name,
      nameKa: name,
      nameEn: name,
      employeePriceGel: price,
      active: true,
      sort: meals.catalog.length,
    })
    setExtraName('')
    setExtraPrice('')
  }

  function startEditBase(item: MealCatalogItem) {
    setEditingBaseId(item.id)
    setBaseName(mealCatalogItemName(item, locale))
    setBaseLines(
      item.composition?.length
        ? item.composition.map((line) => ({
            name: mealCatalogItemName(line, locale),
            grams: line.grams ? String(line.grams) : '',
          }))
        : [emptyCompositionLine()],
    )
  }

  function extrasOfDay(date: string) {
    return mealDayExtraIds(week, date)
  }

  function isChecked(item: MealCatalogItem, date: string) {
    if (item.kind === 'base') {
      return days.find((day) => day.date === date)?.baseItemId === item.id
    }
    return extrasOfDay(date).includes(item.id)
  }

  function toggleDay(item: MealCatalogItem, date: string, on: boolean) {
    if (readOnly) return
    if (item.kind === 'base') {
      onSetWeekBase(weekStart, date, on ? item.id : null)
    } else {
      const current = extrasOfDay(date)
      onSetDayExtras(
        weekStart,
        date,
        on ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
      )
    }
    setSelectedDate(date)
  }

  /** Одной кнопкой поставить блюдо на все 7 дней или снять со всех. */
  function toggleWholeWeek(item: MealCatalogItem) {
    if (readOnly) return
    const on = !days.every((day) => isChecked(item, day.date))
    for (const day of days) {
      if (item.kind === 'base') {
        if (on) onSetWeekBase(weekStart, day.date, item.id)
        else if (day.baseItemId === item.id) onSetWeekBase(weekStart, day.date, null)
      } else {
        const current = extrasOfDay(day.date)
        onSetDayExtras(
          weekStart,
          day.date,
          on ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
        )
      }
    }
  }

  function hideItem(item: MealCatalogItem) {
    onUpsertCatalogItem({ ...item, active: false })
  }

  function publish() {
    const ok = onPublishWeek(weekStart)
    setMessage(ok ? t('meals.week.publishedMessage') : t('meals.week.publishError'))
  }

  function addAdvance() {
    const amountGel = Number(advanceAmount)
    if (!Number.isFinite(amountGel) || amountGel <= 0) return
    const id = onAddAdvance({
      amountGel,
      receivedAt: `${advanceDate}T12:00:00+04:00`,
      note: advanceNote,
    })
    if (!id) return
    setAdvanceAmount('')
    setAdvanceNote('')
    setMessage(t('meals.advance.saved'))
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-stone-200 bg-white p-4" data-coach="meals:week">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
              {t('meals.week.title')}
            </p>
            <p className="mt-1 text-lg font-semibold text-ink">
              {formatShortDate(weekStart, locale)} — {formatShortDate(addDaysIso(weekStart, 6), locale)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setWeekStart(addDaysIso(weekStart, -7))}>
              ← {t('meals.week.previous')}
            </Button>
            <Button variant="ghost" onClick={() => setWeekStart(weekStartIso(today))}>
              {t('meals.week.current')}
            </Button>
            <Button variant="ghost" onClick={() => setWeekStart(addDaysIso(weekStart, 7))}>
              {t('meals.week.next')} →
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              week?.status === 'published'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {week?.status === 'published'
              ? t('meals.week.published')
              : t('meals.week.draft')}
          </span>
          <Button
            variant="secondary"
            data-coach="meals:repeatWeek"
            disabled={week?.status === 'published'}
            onClick={() => {
              const ok = onCopyPreviousWeek(weekStart)
              setMessage(ok ? t('meals.week.copied') : t('meals.week.noPrevious'))
            }}
          >
            {t('meals.week.repeat')}
          </Button>
          <Button
            variant="primary"
            data-coach="meals:publishWeek"
            disabled={week?.status === 'published' || days.some((day) => !day.baseItemId)}
            onClick={publish}
          >
            {t('meals.week.publish')}
          </Button>
          {message ? <span className="text-sm text-stone-600">{message}</span> : null}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4" data-coach="meals:weekBoard">
        <div>
          <h3 className="font-semibold text-ink">{t('meals.week.menuTitle')}</h3>
          <p className="text-sm text-stone-500">
            {readOnly ? t('meals.week.readOnlyHint') : t('meals.week.matrixHint')}
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                <th className="sticky left-0 z-10 bg-stone-50 px-3 py-2 text-left">
                  {t('meals.week.dish')}
                </th>
                {days.map((day) => (
                  <th key={day.date} className="px-2 py-1 text-center font-medium">
                    <button
                      type="button"
                      onClick={() => setSelectedDate(day.date)}
                      className={`w-full rounded-md px-2 py-1 transition-colors ${
                        selectedDate === day.date
                          ? 'bg-accent-soft text-accent'
                          : 'text-stone-600 hover:bg-stone-100'
                      }`}
                    >
                      <span className="block">
                        {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
                          new Date(`${day.date}T00:00:00Z`),
                        )}
                      </span>
                      <span className="block text-[11px] normal-case tabular-nums">
                        {formatShortDate(day.date, locale)}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2 text-center">{t('meals.week.allWeek')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={days.length + 2}
                  className="bg-stone-100/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600"
                >
                  {t('meals.catalog.base')}
                </td>
              </tr>
              {baseItems.length ? (
                baseItems.map((item) => (
                  <tr key={item.id} className="border-t border-stone-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-medium text-ink hover:text-accent"
                        onClick={() => startEditBase(item)}
                        title={t('meals.catalog.editComposition')}
                      >
                        {mealCatalogItemName(item, locale)}
                      </button>
                      {item.composition?.length ? (
                        <p className="mt-0.5 max-w-[14rem] text-xs leading-snug text-stone-500">
                          {mealCompositionText(item, locale)}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => hideItem(item)}
                        className="ml-0 mt-1 text-xs text-stone-400 hover:text-red-600"
                        title={t('meals.catalog.hide')}
                      >
                        ✕
                      </button>
                    </td>
                    {days.map((day) => (
                      <td
                        key={day.date}
                        className={`px-2 py-2 text-center ${
                          selectedDate === day.date ? 'bg-accent-soft/30' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5 cursor-pointer rounded accent-[color:var(--color-accent)] disabled:cursor-not-allowed"
                          checked={isChecked(item, day.date)}
                          disabled={readOnly}
                          onChange={(event) => toggleDay(item, day.date, event.target.checked)}
                          aria-label={`${mealCatalogItemName(item, locale)} — ${formatShortDate(day.date, locale)}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <Button variant="ghost" disabled={readOnly} onClick={() => toggleWholeWeek(item)}>
                        {t('meals.week.allWeekShort')}
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={days.length + 2} className="px-3 py-3 text-stone-500">
                    {t('meals.catalog.emptyBase')}
                  </td>
                </tr>
              )}
              <tr>
                <td
                  colSpan={days.length + 2}
                  className="bg-stone-100/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600"
                >
                  {t('meals.catalog.extras')}
                </td>
              </tr>
              {extraItems.length ? (
                extraItems.map((item) => (
                  <tr key={item.id} className="border-t border-stone-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <span className="font-medium text-ink">{mealCatalogItemName(item, locale)}</span>
                      <span className="ml-2 text-stone-500 tabular-nums">
                        {money(item.employeePriceGel)}
                      </span>
                      <button
                        type="button"
                        onClick={() => hideItem(item)}
                        className="ml-2 text-xs text-stone-400 hover:text-red-600"
                        title={t('meals.catalog.hide')}
                      >
                        ✕
                      </button>
                    </td>
                    {days.map((day) => (
                      <td
                        key={day.date}
                        className={`px-2 py-2 text-center ${
                          selectedDate === day.date ? 'bg-accent-soft/30' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5 cursor-pointer rounded accent-[color:var(--color-accent)] disabled:cursor-not-allowed"
                          checked={isChecked(item, day.date)}
                          disabled={readOnly}
                          onChange={(event) => toggleDay(item, day.date, event.target.checked)}
                          aria-label={`${mealCatalogItemName(item, locale)} — ${formatShortDate(day.date, locale)}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <Button variant="ghost" disabled={readOnly} onClick={() => toggleWholeWeek(item)}>
                        {t('meals.week.allWeekShort')}
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={days.length + 2} className="px-3 py-3 text-stone-500">
                    {t('meals.catalog.emptyExtras')}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200 text-xs text-stone-600">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">
                  {t('meals.kpi.people')}
                </td>
                {days.map((day) => (
                  <td key={day.date} className="px-2 py-2 text-center tabular-nums">
                    {cookDayTotals(meals, day.date).people || '—'}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-4 grid gap-3 border-t border-stone-100 pt-4 lg:grid-cols-2">
          <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3">
            <p className="text-sm font-semibold text-ink">
              {editingBaseId ? t('meals.catalog.editBase') : t('meals.catalog.newBaseTitle')}
            </p>
            <p className="mt-0.5 text-xs text-stone-500">{t('meals.catalog.compositionHint')}</p>
            <div className="mt-2">
              <Input
                value={baseName}
                onChange={(event) => setBaseName(event.target.value)}
                placeholder={t('meals.catalog.newBase')}
              />
            </div>
            <div className="mt-2 space-y-2">
              {baseLines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
                  <Input
                    value={line.name}
                    onChange={(event) =>
                      setBaseLines((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, name: event.target.value } : row,
                        ),
                      )
                    }
                    placeholder={t('meals.catalog.dishName')}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={10}
                    value={line.grams}
                    onChange={(event) =>
                      setBaseLines((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, grams: event.target.value } : row,
                        ),
                      )
                    }
                    placeholder={t('meals.catalog.grams')}
                  />
                  <Button
                    variant="ghost"
                    disabled={baseLines.length <= 1}
                    onClick={() =>
                      setBaseLines((current) => current.filter((_, rowIndex) => rowIndex !== index))
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() => setBaseLines((current) => [...current, emptyCompositionLine()])}
              >
                {t('meals.catalog.addLine')}
              </Button>
              <Button variant="secondary" disabled={!baseName.trim()} onClick={() => addCatalog('base')}>
                {editingBaseId ? t('meals.catalog.saveBase') : t('meals.catalog.add')}
              </Button>
              {editingBaseId ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingBaseId(null)
                    setBaseName('')
                    setBaseLines([emptyCompositionLine()])
                  }}
                >
                  {t('meals.catalog.cancelEdit')}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input
              value={extraName}
              onChange={(event) => setExtraName(event.target.value)}
              placeholder={t('meals.catalog.newExtra')}
            />
            <Input
              type="number"
              min={0}
              step="0.5"
              value={extraPrice}
              onChange={(event) => setExtraPrice(event.target.value)}
              placeholder={t('meals.catalog.price')}
            />
            <Button
              variant="secondary"
              disabled={!extraName.trim() || !extraPrice}
              onClick={() => addCatalog('extra')}
            >
              {t('meals.catalog.add')}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ink">{t('meals.day.details')}</h3>
            <p className="text-sm text-stone-500">
              {formatShortDate(selectedDate, locale)}
              {selectedDayBase ? ` · ${mealCatalogItemName(selectedDayBase, locale)}` : ''}
            </p>
            {selectedDayBase?.composition?.length ? (
              <p className="mt-1 text-xs text-stone-500">
                {mealCompositionText(selectedDayBase, locale)}
              </p>
            ) : null}
          </div>
          {selectedDay.accepted ? (
            <Button variant="ghost" onClick={() => onUnaccept(selectedDate)}>
              {t('meals.unacceptDay')}
            </Button>
          ) : (
            <Button
              variant="primary"
              data-coach="meals:acceptDay"
              disabled={selectedDay.people === 0}
              onClick={() => onAccept(selectedDate)}
            >
              {t('meals.acceptDay')}
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label={t('meals.kpi.people')} value={selectedDay.people} />
          <KpiCard label={t('meals.kpi.portions')} value={selectedDay.portions} />
          <KpiCard label={t('meals.report.employee')} value={money(selectedDay.employeeGel)} />
          <KpiCard label={t('meals.report.company')} value={money(selectedDay.companyGel)} />
          <KpiCard
            label={t('meals.report.total')}
            value={money(selectedDay.employeeGel + selectedDay.companyGel)}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('meals.col.name')}</th>
                <th className="px-3 py-2">{t('meals.col.dish')}</th>
                <th className="px-3 py-2">{t('meals.report.employee')}</th>
                <th className="px-3 py-2">{t('meals.report.company')}</th>
                <th className="px-3 py-2">{t('meals.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {selectedOrders.length ? selectedOrders.map((order) => {
                const cost = orderMealCost(order, meals.settings.pricing)
                return (
                  <tr key={order.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-medium">{order.employeeName}</td>
                    <td className="px-3 py-2">
                      {order.lines.map((line) => `${mealOrderLineName(line, locale)} × ${line.qty}`).join(', ')}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(cost.employeeGel)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(cost.companyGel)}</td>
                    <td className="px-3 py-2">{t(`meals.status.${order.status}`)}</td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={5} className="px-3 py-5 text-stone-500">{t('meals.emptyDay')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4" data-coach="meals:advance">
        <h3 className="font-semibold text-ink">{t('meals.advance.title')}</h3>
        <p className="mt-1 text-sm text-stone-500">{t('meals.advance.hint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label={t('meals.advance.received')} value={money(advance.receivedGel)} />
          <KpiCard label={t('meals.advance.spent')} value={money(advance.spentGel)} />
          <KpiCard label={t('meals.advance.reserved')} value={money(advance.reservedGel)} />
          <KpiCard label={t('meals.advance.balance')} value={money(advance.balanceGel)} />
          <KpiCard
            label={t('meals.advance.available')}
            value={money(advance.availableAfterReserveGel)}
          />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[9rem_11rem_1fr_auto]">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={advanceAmount}
            onChange={(event) => setAdvanceAmount(event.target.value)}
            placeholder={t('meals.advance.amount')}
          />
          <Input type="date" value={advanceDate} onChange={(event) => setAdvanceDate(event.target.value)} />
          <Input
            value={advanceNote}
            onChange={(event) => setAdvanceNote(event.target.value)}
            placeholder={t('meals.advance.note')}
          />
          <Button
            variant="secondary"
            data-coach="meals:addAdvance"
            disabled={!advanceAmount}
            onClick={addAdvance}
          >
            {t('meals.advance.add')}
          </Button>
        </div>
        {meals.advances.length ? (
          <div className="mt-4 max-h-48 overflow-auto">
            {[...meals.advances]
              .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
              .map((row) => (
                <div key={row.id} className="flex items-center justify-between border-t border-stone-100 py-2 text-sm">
                  <span>{formatShortDate(row.receivedAt.slice(0, 10), locale)} · {row.note || t('meals.advance.noNote')}</span>
                  <strong className="tabular-nums text-ink">{money(row.amountGel)}</strong>
                </div>
              ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ink">{t('meals.report.week')}</h3>
            <p className="text-sm text-stone-500">
              {tf('meals.reportCount', { n: String(weekOrders.length) })}
            </p>
          </div>
          <p className="text-sm font-semibold text-ink">
            {t('meals.report.total')}: {money(weekTotals.employee + weekTotals.company)}
          </p>
        </div>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-2 py-2">{t('meals.date')}</th>
                <th className="px-2 py-2">{t('meals.col.name')}</th>
                <th className="px-2 py-2">{t('meals.col.dish')}</th>
                <th className="px-2 py-2">{t('meals.report.employee')}</th>
                <th className="px-2 py-2">{t('meals.report.company')}</th>
              </tr>
            </thead>
            <tbody>
              {weekOrders.map((order) => {
                const cost = orderMealCost(order, meals.settings.pricing)
                return (
                  <tr key={order.id} className="border-t border-stone-100">
                    <td className="px-2 py-2">{formatShortDate(order.date, locale)}</td>
                    <td className="px-2 py-2 font-medium">{order.employeeName}</td>
                    <td className="px-2 py-2">{order.lines.map((line) => `${mealOrderLineName(line, locale)} × ${line.qty}`).join(', ')}</td>
                    <td className="px-2 py-2 tabular-nums">{money(cost.employeeGel)}</td>
                    <td className="px-2 py-2 tabular-nums">{money(cost.companyGel)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
