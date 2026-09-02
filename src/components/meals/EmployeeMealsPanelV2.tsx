import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { addDaysIso, formatShortDate } from '@/lib/dates'
import {
  defaultMealOrderDate,
  findEmployeeMealOrder,
  findPublishedMealWeek,
  isMealOrderLocked,
  mealCatalogItemName,
  mealCompositionLabel,
  mealDayExtraIds,
  mealOrderLineName,
  orderMealCost,
  tbilisiParts,
  weekStartIso,
} from '@/lib/meals/calc'
import { getMeals } from '@/lib/meals/init'
import type { MealOrderLine } from '@/lib/meals/types'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  employeeId: string
  employeeName: string
  showPrices: boolean
  onSave: (input: {
    employeeId: string
    employeeName: string
    date: string
    lines: MealOrderLine[]
  }) => void
}

const money = (value: number) => `${value.toFixed(2)} ₾`

export function EmployeeMealsPanelV2({
  store,
  employeeId,
  employeeName,
  showPrices,
  onSave,
}: Props) {
  const { t, locale, tf } = useI18n()
  const meals = getMeals(store)
  const today = tbilisiParts().date
  const [date, setDate] = useState(() => defaultMealOrderDate(meals.settings))
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const existing = findEmployeeMealOrder(meals.orders, employeeId, date)
  const [baseOn, setBaseOn] = useState(() =>
    Boolean(existing?.lines.some((line) => line.kind === 'base')),
  )
  const [extraQty, setExtraQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (existing?.lines ?? [])
        .filter((line) => line.kind === 'extra')
        .map((line) => [line.optionId, line.qty]),
    ),
  )
  const week = findPublishedMealWeek(meals, date)
  const day = week?.days.find((row) => row.date === date)
  const catalogById = useMemo(
    () => new Map(meals.catalog.map((item) => [item.id, item])),
    [meals.catalog],
  )
  const baseItem = day?.baseItemId ? catalogById.get(day.baseItemId) : undefined
  const extras = mealDayExtraIds(week, date)
    .map((id) => catalogById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.active && item.kind === 'extra'))
  const locked = isMealOrderLocked(meals.settings, meals.acceptedDays, date)
  const inputLines: MealOrderLine[] = [
    ...(baseOn && baseItem ? [{ optionId: baseItem.id, qty: 1 }] : []),
    ...extras
      .map((item) => ({ optionId: item.id, qty: Math.max(0, Math.round(extraQty[item.id] ?? 0)) }))
      .filter((line) => line.qty > 0),
  ]
  const previewLines: MealOrderLine[] = [
    ...(baseOn && baseItem
      ? [{
          optionId: baseItem.id,
          kind: 'base' as const,
          qty: 1,
          employeeUnitGel: meals.settings.pricing.firstPortionEmployeeGel,
          companyUnitGel: meals.settings.pricing.firstPortionCompanyGel,
        }]
      : []),
    ...extras.flatMap((item) => {
      const qty = Math.max(0, Math.round(extraQty[item.id] ?? 0))
      return qty
        ? [{
            optionId: item.id,
            kind: 'extra' as const,
            qty,
            employeeUnitGel: item.employeePriceGel,
            companyUnitGel: 0,
          }]
        : []
    }),
  ]
  const cost = orderMealCost({ lines: previewLines }, meals.settings.pricing)
  const existingShape = (existing?.lines ?? [])
    .map((line) => `${line.optionId}:${line.qty}`)
    .sort()
    .join('|')
  const nextShape = inputLines.map((line) => `${line.optionId}:${line.qty}`).sort().join('|')
  const dirty = existingShape !== nextShape
  const visibleWeekStart = weekStartIso(date)
  const monthOrders = meals.orders
    .filter(
      (order) =>
        order.employeeId === employeeId &&
        order.date.startsWith(date.slice(0, 7)) &&
        order.status !== 'cancelled',
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  function loadDate(nextDate: string) {
    const order = findEmployeeMealOrder(meals.orders, employeeId, nextDate)
    setDate(nextDate)
    setBaseOn(Boolean(order?.lines.some((line) => line.kind === 'base')))
    setExtraQty(
      Object.fromEntries(
        (order?.lines ?? [])
          .filter((line) => line.kind === 'extra')
          .map((line) => [line.optionId, line.qty]),
      ),
    )
    setSavedAt(null)
  }

  function bump(id: string, delta: number) {
    setExtraQty((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }))
    setSavedAt(null)
  }

  function save() {
    onSave({ employeeId, employeeName, date, lines: inputLines })
    setSavedAt(new Date().toISOString())
  }

  const disabledText =
    locale === 'ka'
      ? meals.settings.disabledTextKa
      : locale === 'en'
        ? meals.settings.disabledTextEn
        : meals.settings.disabledTextRu

  return (
    <div className="flex flex-col gap-4">
      {meals.settings.ordersDisabled ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {disabledText}
        </p>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{t('meals.chooseDay')}</h3>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              locked
                ? 'bg-amber-100 text-amber-900'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {locked
              ? t('meals.closedBadge')
              : tf('meals.openUntil', { hour: String(meals.settings.deadlineHourTbilisi) })}
          </span>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 7 }, (_, index) => addDaysIso(visibleWeekStart, index)).map((iso) => (
            <button
              key={iso}
              type="button"
              onClick={() => loadDate(iso)}
              className={`min-w-[7rem] rounded-lg border px-3 py-2 text-left transition-colors ${
                date === iso
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-stone-200 bg-white text-ink hover:bg-stone-50'
              }`}
            >
              <span className="block text-xs text-stone-500">
                {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
                  new Date(`${iso}T00:00:00Z`),
                )}
              </span>
              <span className="text-sm font-semibold">{formatShortDate(iso, locale)}</span>
            </button>
          ))}
          <label className="min-w-[9rem] rounded-lg border border-stone-200 px-3 py-1">
            <span className="block text-[11px] text-stone-500">{t('meals.day.other')}</span>
            <input
              type="date"
              min={addDaysIso(today, 1)}
              value={date}
              onChange={(event) => event.target.value && loadDate(event.target.value)}
              className="w-full bg-transparent text-sm font-semibold outline-none"
              data-coach="meals:date"
            />
          </label>
        </div>
      </section>

      {!week || !baseItem ? (
        <section className="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center">
          <h3 className="font-semibold text-ink">{t('meals.menu.notPublished')}</h3>
          <p className="mt-1 text-sm text-stone-500">{t('meals.menu.notPublishedHint')}</p>
        </section>
      ) : (
        <>
          <section
            className={`rounded-xl border p-4 transition-colors ${
              baseOn ? 'border-accent bg-accent-soft/40' : 'border-stone-200 bg-white'
            }`}
            data-coach="meals:order"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  {t('meals.menu.base')}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">
                  {mealCatalogItemName(baseItem, locale)}
                </h3>
                {baseItem.composition?.length ? (
                  <ul className="mt-2 space-y-0.5 text-sm text-stone-600">
                    {baseItem.composition.map((line) => (
                      <li key={line.id}>{mealCompositionLabel(line, locale)}</li>
                    ))}
                  </ul>
                ) : null}
                {showPrices ? (
                  <p className="mt-1 text-sm text-stone-600">
                    {t('meals.report.employee')}: {money(meals.settings.pricing.firstPortionEmployeeGel)}
                    {' · '}
                    {t('meals.report.company')}: {money(meals.settings.pricing.firstPortionCompanyGel)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setBaseOn((value) => !value)
                  setSavedAt(null)
                }}
                className={`min-h-11 rounded-lg px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                  baseOn
                    ? 'bg-accent text-white'
                    : 'border border-stone-300 bg-white text-ink hover:border-accent'
                }`}
              >
                {baseOn ? t('meals.menu.ordered') : t('meals.menu.order')}
              </button>
            </div>
          </section>

          <section>
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-ink">{t('meals.catalog.extras')}</h3>
              <p className="text-xs text-stone-500">{t('meals.menu.extrasHint')}</p>
            </div>
            {extras.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {extras.map((item) => {
                  const qty = extraQty[item.id] ?? 0
                  return (
                    <article
                      key={item.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                        qty ? 'border-accent bg-accent-soft/30' : 'border-stone-200 bg-white'
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-ink">{mealCatalogItemName(item, locale)}</p>
                        <p className="text-sm text-stone-500">{money(item.employeePriceGel)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={locked || qty <= 0}
                          onClick={() => bump(item.id, -1)}
                          className="h-11 w-11 rounded-full border border-stone-300 bg-white text-xl disabled:opacity-40"
                          aria-label={`${t('meals.minus')}: ${mealCatalogItemName(item, locale)}`}
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-xl font-bold tabular-nums">{qty}</span>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => bump(item.id, 1)}
                          className="h-11 w-11 rounded-full bg-accent text-xl font-semibold text-white disabled:opacity-40"
                          aria-label={`${t('meals.plus')}: ${mealCatalogItemName(item, locale)}`}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-500">
                {t('meals.menu.noExtras')}
              </p>
            )}
          </section>

          <section className="sticky bottom-14 z-10 rounded-xl border border-stone-300 bg-white/95 p-4 shadow-lg backdrop-blur lg:bottom-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-stone-500">{t('meals.total')}</p>
                <p className="text-xl font-bold text-ink">{money(cost.employeeGel)}</p>
                {showPrices && cost.companyGel > 0 ? (
                  <p className="text-xs text-stone-500">
                    {t('meals.report.company')}: {money(cost.companyGel)}
                  </p>
                ) : null}
              </div>
              <Button
                variant="primary"
                data-coach="meals:save"
                disabled={locked || !dirty}
                onClick={save}
              >
                {t('meals.saveOrder')}
              </Button>
            </div>
            {savedAt ? <p className="mt-2 text-xs text-emerald-700">{t('meals.saved')}</p> : null}
          </section>
        </>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold text-ink">{t('meals.history')}</h3>
        <div className="mt-3 space-y-2">
          {monthOrders.length ? monthOrders.map((order) => {
            const rowCost = orderMealCost(order, meals.settings.pricing)
            return (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2 text-sm">
                <div>
                  <span className="font-medium text-ink">{formatShortDate(order.date, locale)}</span>
                  <span className="ml-2 text-stone-500">
                    {order.lines.map((line) => `${mealOrderLineName(line, locale)} × ${line.qty}`).join(', ')}
                  </span>
                </div>
                <span className="font-semibold tabular-nums">{money(rowCost.employeeGel)}</span>
              </div>
            )
          }) : <p className="text-sm text-stone-500">{t('meals.historyEmpty')}</p>}
        </div>
      </section>
    </div>
  )
}
