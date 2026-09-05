import { mealOptionName, mealOrderLineName, mealPortions, ordersForDate } from './calc'
import type { MealOption, MealOrder, MealsStore } from './types'

export type MealTelegramKind = 'lunch' | 'extra'

function optionQtyLines(
  orders: MealOrder[],
  options: MealOption[],
  locale: string,
  kind: MealTelegramKind,
): string[] {
  const byOption = new Map<string, { qty: number; name: string }>()
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.kind && (kind === 'lunch' ? line.kind !== 'base' : line.kind !== 'extra')) continue
      const option = options.find((row) => row.id === line.optionId)
      const name = line.nameRu
        ? mealOrderLineName(line, locale)
        : option
          ? mealOptionName(option, locale)
          : line.optionId
      const current = byOption.get(line.optionId)
      byOption.set(line.optionId, { qty: (current?.qty ?? 0) + line.qty, name })
    }
  }
  return [...byOption.values()]
    .filter((row) => row.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => `${row.name}: ${row.qty}`)
}

export function buildMealTelegramText(
  store: MealsStore,
  date: string,
  kind: MealTelegramKind,
  locale = 'ru',
): string {
  const orders = ordersForDate(store.orders, date)
  const portions = orders.reduce((s, o) => s + mealPortions(o), 0)
  const title =
    kind === 'extra'
      ? locale === 'ka'
        ? 'დამატებითი პორციები'
        : locale === 'en'
          ? 'Extra portions'
          : 'Дополнительные порции'
      : locale === 'ka'
        ? 'სადილები'
        : locale === 'en'
          ? 'Lunches'
          : 'Обеды'
  const lines = optionQtyLines(orders, store.settings.options, locale, kind)
  const people =
    locale === 'ka' ? `ადამიანი: ${orders.length}` : locale === 'en' ? `People: ${orders.length}` : `Человек: ${orders.length}`
  const total =
    locale === 'ka' ? `პორცია: ${portions}` : locale === 'en' ? `Portions: ${portions}` : `Порций: ${portions}`
  return [`${title} · ${date}`, people, total, '', ...lines].join('\n').trim()
}
