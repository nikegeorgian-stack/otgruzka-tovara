import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { addDaysIso, formatShortDate } from '@/lib/dates'
import {
  cookDayTotals,
  defaultMealOrderDate,
  mealOptionName,
  mealPortions,
  tbilisiParts,
} from '@/lib/meals/calc'
import { getMeals } from '@/lib/meals/init'
import { buildMealTelegramText } from '@/lib/meals/telegram'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onAccept: (date: string) => void
  onUnaccept: (date: string) => void
}

export function CookMealsPanel({ store, onAccept, onUnaccept }: Props) {
  const { t, locale, tf } = useI18n()
  const meals = getMeals(store)
  const [date, setDate] = useState(() => defaultMealOrderDate(meals.settings))
  const [from, setFrom] = useState(date.slice(0, 7) + '-01')
  const [to, setTo] = useState(date)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const day = cookDayTotals(meals, date)
  const tbDate = tbilisiParts().date
  const quickDays = [
    { iso: tbDate, label: t('meals.today') },
    { iso: addDaysIso(tbDate, 1), label: t('meals.tomorrow') },
  ]
  const optionsById = useMemo(
    () => new Map(meals.settings.options.map((o) => [o.id, o])),
    [meals.settings.options],
  )

  const report = useMemo(() => {
    const q = query.trim().toLowerCase()
    return meals.orders.filter((o) => {
      if (o.status === 'cancelled') return false
      if (o.date < from || o.date > to) return false
      if (q && !o.employeeName.toLowerCase().includes(q)) return false
      return mealPortions(o) > 0
    })
  }, [meals.orders, from, to, query])

  async function copySummary() {
    const text = buildMealTelegramText(meals, date, 'lunch', locale)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {quickDays.map((d) => {
            const active = d.iso === date
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => setDate(d.iso)}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition ${
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-stone-200 bg-white text-ink hover:bg-stone-50'
                }`}
              >
                <span className="block text-sm font-semibold">{d.label}</span>
                <span className="block text-xs text-stone-500">
                  {formatShortDate(d.iso, locale)}
                </span>
              </button>
            )
          })}
          <label className="flex min-h-11 flex-col justify-center rounded-xl border border-stone-200 bg-white px-3 py-1">
            <span className="text-[11px] text-stone-500">{t('meals.date')}</span>
            <input
              type="date"
              className="bg-transparent text-sm font-semibold text-ink outline-none"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              data-coach="meals:cookDate"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {day.accepted ? (
            <Button variant="ghost" className="min-h-11" onClick={() => onUnaccept(date)}>
              {t('meals.unacceptDay')}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="min-h-11"
              data-coach="meals:acceptDay"
              onClick={() => onAccept(date)}
              disabled={day.people === 0}
            >
              {t('meals.acceptDay')}
            </Button>
          )}
          <Button variant="secondary" className="min-h-11" onClick={() => void copySummary()}>
            {copied ? t('meals.copied') : t('meals.copyTelegram')}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('meals.kpi.people')} value={day.people} />
        <KpiCard label={t('meals.kpi.portions')} value={day.portions} />
        <KpiCard
          label={t('meals.kpi.status')}
          value={day.accepted ? t('meals.status.accepted') : t('meals.status.submitted')}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {meals.settings.options
          .filter((o) => o.active)
          .sort((a, b) => a.sort - b.sort)
          .map((option) => (
            <div
              key={option.id}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              <span>
                {option.emoji ? `${option.emoji} ` : ''}
                {mealOptionName(option, locale)}
              </span>
              <span className="font-semibold">{day.byOption.get(option.id) ?? 0}</span>
            </div>
          ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">{t('meals.col.name')}</th>
              <th className="px-3 py-2">{t('meals.col.dish')}</th>
              <th className="px-3 py-2">{t('meals.col.qty')}</th>
              <th className="px-3 py-2">{t('meals.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {day.orders.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-stone-500" colSpan={4}>
                  {t('meals.emptyDay')}
                </td>
              </tr>
            ) : (
              day.orders.map((order) => (
                <tr key={order.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-medium">{order.employeeName}</td>
                  <td className="px-3 py-2">
                    {order.lines
                      .map((line) => {
                        const option = optionsById.get(line.optionId)
                        const name = option ? mealOptionName(option, locale) : line.optionId
                        return `${name} × ${line.qty}`
                      })
                      .join(', ')}
                  </td>
                  <td className="px-3 py-2">{mealPortions(order)}</td>
                  <td className="px-3 py-2">{t(`meals.status.${order.status}`)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-3">
        <p className="mb-3 font-semibold text-ink">{t('meals.report')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('meals.searchName')}
          />
          <input
            type="date"
            className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <p className="mb-2 text-xs text-stone-500">{tf('meals.reportCount', { n: String(report.length) })}</p>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-2 py-1">{t('meals.date')}</th>
                <th className="px-2 py-1">{t('meals.col.name')}</th>
                <th className="px-2 py-1">{t('meals.col.qty')}</th>
                <th className="px-2 py-1">{t('meals.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {report.map((order) => (
                <tr key={order.id} className="border-t border-stone-100">
                  <td className="px-2 py-1">{formatShortDate(order.date, locale)}</td>
                  <td className="px-2 py-1">{order.employeeName}</td>
                  <td className="px-2 py-1">{mealPortions(order)}</td>
                  <td className="px-2 py-1">{t(`meals.status.${order.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
