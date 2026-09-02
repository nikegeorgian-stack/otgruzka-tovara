import { addDaysIso } from '@/lib/dates'
import type { AppStore } from '@/lib/types'
import { getMeals } from './init'
import type {
  MealAcceptedDay,
  MealCatalogItem,
  MealMenuWeek,
  MealOption,
  MealOrder,
  MealPricing,
  MealSettings,
  MealsStore,
} from './types'

const TBILISI = 'Asia/Tbilisi'

export type TbilisiParts = {
  date: string
  hour: number
  minute: number
}

export function tbilisiParts(now = new Date()): TbilisiParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TBILISI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

export function mealPortions(order: Pick<MealOrder, 'lines'>): number {
  return order.lines.reduce((s, line) => s + Math.max(0, line.qty), 0)
}

export function mealCost(
  portions: number,
  pricing: MealPricing,
): { employeeGel: number; companyGel: number } {
  const n = Math.max(0, Math.floor(portions))
  if (n <= 0) return { employeeGel: 0, companyGel: 0 }
  const extra = n - 1
  return {
    employeeGel:
      pricing.firstPortionEmployeeGel + extra * pricing.extraPortionEmployeeGel,
    companyGel: pricing.firstPortionCompanyGel + extra * pricing.extraPortionCompanyGel,
  }
}

export function orderMealCost(order: Pick<MealOrder, 'lines'>, pricing: MealPricing) {
  let employeeGel = 0
  let companyGel = 0
  let legacyPortions = 0
  for (const line of order.lines) {
    const qty = Math.max(0, Math.floor(line.qty))
    if (line.employeeUnitGel != null || line.companyUnitGel != null || line.kind) {
      employeeGel += qty * Math.max(0, line.employeeUnitGel ?? 0)
      companyGel += qty * Math.max(0, line.companyUnitGel ?? 0)
    } else {
      legacyPortions += qty
    }
  }
  const legacy = mealCost(legacyPortions, pricing)
  return {
    employeeGel: Math.round((employeeGel + legacy.employeeGel) * 100) / 100,
    companyGel: Math.round((companyGel + legacy.companyGel) * 100) / 100,
  }
}

export function weekStartIso(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  const weekday = parsed.getUTCDay()
  const fromMonday = weekday === 0 ? 6 : weekday - 1
  return addDaysIso(date, -fromMonday)
}

export function findMealWeek(meals: MealsStore, date: string) {
  const id = weekStartIso(date)
  return meals.weeks.find((week) => week.id === id)
}

export function findPublishedMealWeek(meals: MealsStore, date: string) {
  const week = findMealWeek(meals, date)
  return week?.status === 'published' ? week : undefined
}

/** Дополнения конкретного дня; старые меню без дневного списка берут недельный. */
export function mealDayExtraIds(
  week: Pick<MealMenuWeek, 'days' | 'extraIds'> | undefined,
  date: string,
): string[] {
  if (!week) return []
  const day = week.days.find((row) => row.date === date)
  return day?.extraIds ?? week.extraIds
}

export function mealCatalogItemName(
  item: { nameRu: string; nameKa: string; nameEn: string },
  locale: string,
): string {
  if (locale === 'ka') return item.nameKa || item.nameRu
  if (locale === 'en') return item.nameEn || item.nameRu
  return item.nameRu
}

export function mealCompositionLabel(
  line: { nameRu: string; nameKa: string; nameEn: string; grams?: number },
  locale: string,
): string {
  const name = mealCatalogItemName(line, locale)
  return line.grams && line.grams > 0 ? `${name} — ${line.grams} г` : name
}

export function mealCompositionText(
  item: Pick<MealCatalogItem, 'composition'> | undefined,
  locale: string,
): string {
  const lines = item?.composition ?? []
  if (!lines.length) return ''
  return lines.map((line) => mealCompositionLabel(line, locale)).join(' · ')
}

export function mealOrderLineName(line: MealOrder['lines'][number], locale: string): string {
  if (locale === 'ka') return line.nameKa || line.nameRu || line.optionId
  if (locale === 'en') return line.nameEn || line.nameRu || line.optionId
  return line.nameRu || line.optionId
}

export function isMealDayAccepted(acceptedDays: MealAcceptedDay[], date: string): boolean {
  return acceptedDays.some((d) => d.date === date)
}

/** Заказ на дату D закрывается в deadlineHour Тбилиси дня D−1. */
export function isMealOrderLocked(
  settings: MealSettings,
  acceptedDays: MealAcceptedDay[],
  orderDate: string,
  now = new Date(),
): boolean {
  if (settings.ordersDisabled) return true
  if (isMealDayAccepted(acceptedDays, orderDate)) return true
  const tb = tbilisiParts(now)
  const deadlineDate = addDaysIso(orderDate, -1)
  if (tb.date > deadlineDate) return true
  if (tb.date === deadlineDate && tb.hour >= settings.deadlineHourTbilisi) return true
  return false
}

export function defaultMealOrderDate(settings: MealSettings, now = new Date()): string {
  const tb = tbilisiParts(now)
  const tomorrow = addDaysIso(tb.date, 1)
  if (tb.hour < settings.deadlineHourTbilisi) return tomorrow
  return addDaysIso(tb.date, 2)
}

export function activeMealOptions(options: MealOption[]): MealOption[] {
  return options.filter((o) => o.active).sort((a, b) => a.sort - b.sort || a.nameRu.localeCompare(b.nameRu))
}

export function mealOptionName(option: MealOption, locale: string): string {
  if (locale === 'ka') return option.nameKa || option.nameRu
  if (locale === 'en') return option.nameEn || option.nameRu
  return option.nameRu
}

export function findEmployeeMealOrder(
  orders: MealOrder[],
  employeeId: string,
  date: string,
): MealOrder | undefined {
  return orders.find(
    (o) =>
      o.employeeId === employeeId &&
      o.date === date &&
      o.status !== 'cancelled',
  )
}

export function ordersForDate(orders: MealOrder[], date: string): MealOrder[] {
  return orders.filter((o) => o.date === date && o.status !== 'cancelled' && mealPortions(o) > 0)
}

export function employeeAcceptedMealDeduction(
  store: Pick<AppStore, 'meals'>,
  employeeId: string,
  month: string,
  asOfDate?: string,
): number {
  const meals = getMeals(store)
  const accepted = new Set(
    meals.acceptedDays
      .filter((d) => d.date.startsWith(month) && (!asOfDate || d.date <= asOfDate))
      .map((d) => d.date),
  )
  if (accepted.size === 0) return 0
  let sum = 0
  for (const order of meals.orders) {
    if (order.employeeId !== employeeId) continue
    if (order.status !== 'accepted') continue
    if (!accepted.has(order.date)) continue
    if (asOfDate && order.date > asOfDate) continue
    sum += orderMealCost(order, meals.settings.pricing).employeeGel
  }
  return Math.round(sum * 100) / 100
}

export function cookDayTotals(store: MealsStore, date: string) {
  const list = ordersForDate(store.orders, date)
  const byOption = new Map<string, number>()
  for (const order of list) {
    for (const line of order.lines) {
      byOption.set(line.optionId, (byOption.get(line.optionId) ?? 0) + line.qty)
    }
  }
  return {
    orders: list,
    portions: list.reduce((s, o) => s + mealPortions(o), 0),
    people: list.length,
    byOption,
    accepted: isMealDayAccepted(store.acceptedDays, date),
    employeeGel:
      Math.round(
        list.reduce((sum, order) => sum + orderMealCost(order, store.settings.pricing).employeeGel, 0) *
          100,
      ) / 100,
    companyGel:
      Math.round(
        list.reduce((sum, order) => sum + orderMealCost(order, store.settings.pricing).companyGel, 0) *
          100,
      ) / 100,
  }
}

export function cookAdvanceSummary(store: MealsStore) {
  const acceptedDates = new Set(store.acceptedDays.map((day) => day.date))
  let spentGel = 0
  let reservedGel = 0
  for (const order of store.orders) {
    if (order.status === 'cancelled' || mealPortions(order) <= 0) continue
    const cost = orderMealCost(order, store.settings.pricing)
    const total = cost.employeeGel + cost.companyGel
    if (order.status === 'accepted' && acceptedDates.has(order.date)) spentGel += total
    else if (order.status === 'submitted') reservedGel += total
  }
  const receivedGel = store.advances.reduce((sum, row) => sum + Math.max(0, row.amountGel), 0)
  const rounded = (value: number) => Math.round(value * 100) / 100
  return {
    receivedGel: rounded(receivedGel),
    spentGel: rounded(spentGel),
    reservedGel: rounded(reservedGel),
    balanceGel: rounded(receivedGel - spentGel),
    availableAfterReserveGel: rounded(receivedGel - spentGel - reservedGel),
  }
}
