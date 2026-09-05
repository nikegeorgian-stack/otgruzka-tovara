import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import {
  addDaysIso,
  formatMonthNameCapitalized,
  formatShortDate,
  parseIsoDate,
  shiftMonth,
  weekdayShort,
} from '@/lib/dates'
import {
  activeMealOptions,
  defaultMealOrderDate,
  findEmployeeMealOrder,
  isMealOrderLocked,
  mealOptionName,
  mealPortions,
  orderMealCost,
  tbilisiParts,
} from '@/lib/meals/calc'
import { getMeals } from '@/lib/meals/init'
import type { MealOption, MealOrder, MealOrderLine } from '@/lib/meals/types'
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

function linesToQty(order: MealOrder | undefined): Record<string, number> {
  const next: Record<string, number> = {}
  for (const line of order?.lines ?? []) next[line.optionId] = line.qty
  return next
}

function dayLabel(iso: string, locale: 'ru' | 'ka' | 'en'): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${weekdayShort(year, month, day, locale)} ${formatShortDate(iso, locale)}`
}

export function EmployeeMealsPanel({
  store,
  employeeId,
  employeeName,
  showPrices,
  onSave,
}: Props) {
  const { t, locale, tf } = useI18n()
  const meals = getMeals(store)
  const tb = tbilisiParts()
  const [date, setDate] = useState(() => defaultMealOrderDate(meals.settings))
  const [qty, setQty] = useState<Record<string, number>>(() =>
    linesToQty(findEmployeeMealOrder(meals.orders, employeeId, date)),
  )
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [month, setMonth] = useState(() => date.slice(0, 7))

  const options = useMemo(
    () => activeMealOptions(meals.settings.options),
    [meals.settings.options],
  )

  const existing = findEmployeeMealOrder(meals.orders, employeeId, date)
  const locked = isMealOrderLocked(meals.settings, meals.acceptedDays, date)
  const lines = options
    .map((o) => ({ optionId: o.id, qty: Math.max(0, Math.round(qty[o.id] ?? 0)) }))
    .filter((l) => l.qty > 0)
  const portions = mealPortions({ lines })
  const cost = orderMealCost({ lines }, meals.settings.pricing)
  const savedPortions = existing ? mealPortions(existing) : 0
  const dirty =
    portions !== savedPortions ||
    lines.some((l) => (existing?.lines.find((x) => x.optionId === l.optionId)?.qty ?? 0) !== l.qty)

  const tomorrow = addDaysIso(tb.date, 1)
  const afterTomorrow = addDaysIso(tb.date, 2)
  const quickDays: { iso: string; label: string }[] = [
    { iso: tomorrow, label: t('meals.day.tomorrow') },
    { iso: afterTomorrow, label: t('meals.day.after') },
  ]

  const monthOrders = useMemo(
    () =>
      meals.orders
        .filter(
          (o) =>
            o.employeeId === employeeId &&
            o.date.startsWith(month) &&
            o.status !== 'cancelled' &&
            mealPortions(o) > 0,
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [meals.orders, employeeId, month],
  )
  const monthAccepted = monthOrders.filter((o) => o.status === 'accepted')
  const monthPortions = monthAccepted.reduce((s, o) => s + mealPortions(o), 0)
  const monthPending = monthOrders
    .filter((o) => o.status !== 'accepted')
    .reduce((s, o) => s + mealPortions(o), 0)
  const monthPay =
    Math.round(
      monthAccepted.reduce(
        (s, o) => s + orderMealCost(o, meals.settings.pricing).employeeGel,
        0,
      ) * 100,
    ) / 100

  function loadDate(nextDate: string) {
    setDate(nextDate)
    setSavedAt(null)
    setMonth(nextDate.slice(0, 7))
    setQty(linesToQty(findEmployeeMealOrder(meals.orders, employeeId, nextDate)))
  }

  function bump(optionId: string, delta: number) {
    setQty((q) => ({
      ...q,
      [optionId]: Math.min(20, Math.max(0, (q[optionId] ?? 0) + delta)),
    }))
    setSavedAt(null)
  }

  function save(nextLines: MealOrderLine[]) {
    onSave({ employeeId, employeeName, date, lines: nextLines })
    setSavedAt(new Date().toISOString())
  }

  function dayPreview(iso: string): string {
    const order = findEmployeeMealOrder(meals.orders, employeeId, iso)
    if (!order || mealPortions(order) === 0) return t('meals.noOrderDay')
    return order.lines
      .filter((l) => l.qty > 0)
      .map((l) => {
        const option = options.find((o) => o.id === l.optionId)
        const name = option ? mealOptionName(option, locale) : l.optionId
        return `${name} × ${l.qty}`
      })
      .join(', ')
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
          {locked ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              {t('meals.closedBadge')}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              {tf('meals.openUntil', { hour: String(meals.settings.deadlineHourTbilisi) })}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {quickDays.map((d) => {
            const active = d.iso === date
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => loadDate(d.iso)}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition ${
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-stone-200 bg-white text-ink hover:bg-stone-50'
                }`}
              >
                <span className="block text-sm font-semibold">{d.label}</span>
                <span className="block text-xs text-stone-500">{dayLabel(d.iso, locale)}</span>
              </button>
            )
          })}
          <label className="flex min-h-11 flex-col justify-center rounded-xl border border-stone-200 bg-white px-3 py-1">
            <span className="text-[11px] text-stone-500">{t('meals.day.other')}</span>
            <input
              type="date"
              className="bg-transparent text-sm font-semibold text-ink outline-none"
              value={date}
              min={tomorrow}
              onChange={(e) => e.target.value && loadDate(e.target.value)}
              data-coach="meals:date"
            />
          </label>
        </div>
        {locked ? <p className="mt-3 text-sm text-amber-800">{t('meals.locked')}</p> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">{t('meals.dishes')}</h3>
        {options.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-500">
            {t('meals.noOptions')}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {options.map((option: MealOption) => {
              const value = qty[option.id] ?? 0
              return (
                <div
                  key={option.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition ${
                    value > 0
                      ? 'border-accent bg-accent-soft/40'
                      : 'border-stone-200 bg-white'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xl">
                      {option.emoji || '🍽'}
                    </span>
                    <p className="truncate text-base font-semibold text-ink">
                      {mealOptionName(option, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={locked || value === 0}
                      aria-label={`${t('meals.minus')}: ${mealOptionName(option, locale)}`}
                      onClick={() => bump(option.id, -1)}
                      className="h-11 w-11 rounded-full border border-stone-300 bg-white text-xl font-semibold text-ink disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-xl font-bold tabular-nums text-ink">
                      {value}
                    </span>
                    <button
                      type="button"
                      disabled={locked}
                      aria-label={`${t('meals.plus')}: ${mealOptionName(option, locale)}`}
                      onClick={() => bump(option.id, 1)}
                      className="h-11 w-11 rounded-full bg-accent text-xl font-semibold text-white disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {showPrices ? (
          <p className="text-xs text-stone-500">
            {tf('meals.priceNote', {
              first: String(meals.settings.pricing.firstPortionEmployeeGel),
              extra: String(meals.settings.pricing.extraPortionEmployeeGel),
            })}
          </p>
        ) : null}
      </section>

      <section className="sticky bottom-2 z-10 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-stone-500">
                {t('meals.summaryPortions')}
              </p>
              <p className="text-2xl font-bold tabular-nums text-ink">{portions}</p>
            </div>
            {showPrices ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-stone-500">
                  {t('meals.summaryPay')}
                </p>
                <p className="text-2xl font-bold tabular-nums text-ink">{cost.employeeGel} ₾</p>
              </div>
            ) : null}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {lines.length > 0 ? (
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={locked}
                onClick={() => {
                  setQty({})
                  save([])
                }}
              >
                {t('meals.cancelOrder')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="min-h-11 flex-1 text-base sm:flex-none"
              disabled={locked || !dirty}
              data-coach="meals:save"
              onClick={() => save(lines)}
            >
              {t('meals.save')}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs">
          {savedAt && !dirty ? (
            <span className="font-medium text-emerald-700">{t('meals.saved')}</span>
          ) : dirty ? (
            <span className="font-medium text-amber-700">{t('meals.unsaved')}</span>
          ) : (
            <span className="text-stone-500">
              {t('meals.status')}: {existing ? t(`meals.status.${existing.status}`) : t('meals.noOrderDay')}
            </span>
          )}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { iso: tb.date, label: t('meals.today') },
          { iso: tomorrow, label: t('meals.tomorrow') },
        ].map((d) => (
          <div key={d.iso} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide text-stone-500">
              {d.label} · {dayLabel(d.iso, locale)}
            </p>
            <p className="mt-1 text-sm font-medium text-ink">{dayPreview(d.iso)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{t('meals.monthSummary')}</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('meals.monthPrev')}
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="h-9 w-9 rounded-lg border border-stone-200 text-lg leading-none text-ink hover:bg-stone-50"
            >
              ‹
            </button>
            <span className="min-w-32 text-center text-sm font-semibold text-ink">
              {formatMonthNameCapitalized(month, locale)}
            </span>
            <button
              type="button"
              aria-label={t('meals.monthNext')}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="h-9 w-9 rounded-lg border border-stone-200 text-lg leading-none text-ink hover:bg-stone-50"
            >
              ›
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-stone-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-stone-500">
              {t('meals.monthPortions')}
            </p>
            <p className="text-xl font-bold tabular-nums text-ink">{monthPortions}</p>
          </div>
          <div className="rounded-lg bg-stone-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-stone-500">
              {t('meals.pendingPortions')}
            </p>
            <p className="text-xl font-bold tabular-nums text-ink">{monthPending}</p>
          </div>
          {showPrices ? (
            <div className="rounded-lg bg-stone-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-stone-500">
                {t('meals.monthDeduction')}
              </p>
              <p className="text-xl font-bold tabular-nums text-ink">{monthPay} ₾</p>
            </div>
          ) : null}
        </div>
        <div className="mt-3 max-h-56 overflow-auto">
          {monthOrders.length === 0 ? (
            <p className="text-sm text-stone-500">{t('meals.monthEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {monthOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-2 border-b border-stone-100 py-1.5 last:border-b-0"
                >
                  <span className="text-stone-600">{dayLabel(order.date, locale)}</span>
                  <span className="font-medium text-ink">
                    {mealPortions(order)} · {t(`meals.status.${order.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
