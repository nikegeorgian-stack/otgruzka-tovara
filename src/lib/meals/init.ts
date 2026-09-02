import type {
  MealAcceptedDay,
  MealAdvanceReceipt,
  MealCatalogItem,
  MealCatalogKind,
  MealCompositionLine,
  MealMenuWeek,
  MealOption,
  MealOrder,
  MealOrderLine,
  MealOrderStatus,
  MealPricing,
  MealSettings,
  MealTelegramSettings,
  MealsStore,
} from './types'
import type { AppStore } from '@/lib/types'
import { addDaysIso } from '@/lib/dates'

const STATUSES = new Set<MealOrderStatus>(['draft', 'submitted', 'accepted', 'cancelled'])

export const DEFAULT_MEAL_PRICING: MealPricing = {
  firstPortionEmployeeGel: 5,
  extraPortionEmployeeGel: 10,
  firstPortionCompanyGel: 5,
  extraPortionCompanyGel: 0,
}

export const DEFAULT_MEAL_OPTIONS: MealOption[] = [
  {
    id: 'meat',
    nameRu: 'Мясной',
    nameKa: 'ხორციანი',
    nameEn: 'Meat',
    emoji: '🍖',
    active: true,
    sort: 0,
  },
  {
    id: 'vegan',
    nameRu: 'Вегетарианский',
    nameKa: 'ვეგეტარიანული',
    nameEn: 'Vegetarian',
    emoji: '🥗',
    active: true,
    sort: 1,
  },
]

export function createDefaultMealSettings(): MealSettings {
  return {
  ordersDisabled: false,
  disabledTextRu: 'Заказы обедов временно закрыты.',
  disabledTextKa: 'სადილის შეკვეთები დროებით დახურულია.',
  disabledTextEn: 'Lunch orders are temporarily closed.',
  deadlineHourTbilisi: 18,
  pricing: { ...DEFAULT_MEAL_PRICING },
  options: DEFAULT_MEAL_OPTIONS.map((o) => ({ ...o })),
  telegram: { enabled: true, lunchEnabled: true, extraEnabled: true },
  }
}

export function createDefaultMealsStore(): MealsStore {
  return {
    settings: createDefaultMealSettings(),
    catalog: [],
    weeks: [],
    advances: [],
    orders: [],
    acceptedDays: [],
  }
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizePricing(raw: unknown): MealPricing {
  const r = (raw ?? {}) as Partial<MealPricing>
  return {
    firstPortionEmployeeGel: Math.max(0, num(r.firstPortionEmployeeGel, 5)),
    extraPortionEmployeeGel: Math.max(0, num(r.extraPortionEmployeeGel, 10)),
    firstPortionCompanyGel: Math.max(0, num(r.firstPortionCompanyGel, 5)),
    extraPortionCompanyGel: Math.max(0, num(r.extraPortionCompanyGel, 0)),
  }
}

function normalizeTelegram(raw: unknown): MealTelegramSettings {
  const r = (raw ?? {}) as Partial<MealTelegramSettings>
  return {
    enabled: r.enabled !== false,
    lunchEnabled: r.lunchEnabled !== false,
    extraEnabled: r.extraEnabled !== false,
  }
}

function normalizeOption(raw: unknown, index: number): MealOption | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealOption>
  const id = str(r.id).trim()
  const nameRu = str(r.nameRu).trim()
  if (!id || !nameRu) return null
  return {
    id,
    nameRu,
    nameKa: str(r.nameKa, nameRu).trim() || nameRu,
    nameEn: str(r.nameEn, nameRu).trim() || nameRu,
    emoji: str(r.emoji).trim() || undefined,
    active: r.active !== false,
    sort: num(r.sort, index),
  }
}

function normalizeSettings(raw: unknown): MealSettings {
  const base = createDefaultMealSettings()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<MealSettings>
  const options = Array.isArray(r.options)
    ? r.options
        .map((o, i) => normalizeOption(o, i))
        .filter((o): o is MealOption => o !== null)
    : []
  const deadline = Math.round(num(r.deadlineHourTbilisi, 18))
  return {
    ordersDisabled: r.ordersDisabled === true,
    disabledTextRu: str(r.disabledTextRu, base.disabledTextRu),
    disabledTextKa: str(r.disabledTextKa, base.disabledTextKa),
    disabledTextEn: str(r.disabledTextEn, base.disabledTextEn),
    deadlineHourTbilisi: Math.min(23, Math.max(0, deadline)),
    pricing: normalizePricing(r.pricing),
    options: options.length ? options : base.options.map((o) => ({ ...o })),
    telegram: normalizeTelegram(r.telegram),
  }
}

function normalizeLine(raw: unknown): MealOrderLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealOrderLine>
  const optionId = str(r.optionId).trim()
  const qty = Math.round(num(r.qty, 0))
  if (!optionId || qty <= 0) return null
  const kind: MealCatalogKind | undefined =
    r.kind === 'base' || r.kind === 'extra' ? r.kind : undefined
  return {
    optionId,
    qty,
    kind,
    nameRu: str(r.nameRu).trim() || undefined,
    nameKa: str(r.nameKa).trim() || undefined,
    nameEn: str(r.nameEn).trim() || undefined,
    employeeUnitGel:
      r.employeeUnitGel == null ? undefined : Math.max(0, num(r.employeeUnitGel, 0)),
    companyUnitGel:
      r.companyUnitGel == null ? undefined : Math.max(0, num(r.companyUnitGel, 0)),
  }
}

function normalizeOrder(raw: unknown): MealOrder | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealOrder>
  const employeeId = str(r.employeeId).trim()
  const date = str(r.date).trim()
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const status = STATUSES.has(r.status as MealOrderStatus)
    ? (r.status as MealOrderStatus)
    : 'submitted'
  const lines = Array.isArray(r.lines)
    ? r.lines.map(normalizeLine).filter((l): l is MealOrderLine => l !== null)
    : []
  const now = new Date().toISOString()
  return {
    id: str(r.id).trim() || crypto.randomUUID(),
    employeeId,
    employeeName: str(r.employeeName).trim() || employeeId,
    date,
    lines,
    status,
    createdAt: str(r.createdAt, now),
    updatedAt: str(r.updatedAt, now),
    createdBy: str(r.createdBy).trim() || undefined,
    createdByName: str(r.createdByName).trim() || undefined,
  }
}

function normalizeAcceptedDay(raw: unknown): MealAcceptedDay | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealAcceptedDay>
  const date = str(r.date).trim() || str(r.id).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    id: str(r.id).trim() || date,
    date,
    acceptedAt: str(r.acceptedAt) || new Date().toISOString(),
    acceptedBy: str(r.acceptedBy).trim() || undefined,
    acceptedByName: str(r.acceptedByName).trim() || undefined,
  }
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeCompositionLine(raw: unknown, index: number): MealCompositionLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealCompositionLine>
  const nameRu = str(r.nameRu).trim()
  if (!nameRu) return null
  const gramsRaw = r.grams == null ? undefined : Math.round(num(r.grams, 0))
  const grams = gramsRaw && gramsRaw > 0 ? gramsRaw : undefined
  return {
    id: str(r.id).trim() || `c${index}`,
    nameRu,
    nameKa: str(r.nameKa, nameRu).trim() || nameRu,
    nameEn: str(r.nameEn, nameRu).trim() || nameRu,
    ...(grams ? { grams } : {}),
  }
}

function normalizeCatalogItem(raw: unknown, index: number): MealCatalogItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealCatalogItem>
  const id = str(r.id).trim()
  const nameRu = str(r.nameRu).trim()
  if (!id || !nameRu || (r.kind !== 'base' && r.kind !== 'extra')) return null
  const composition = Array.isArray(r.composition)
    ? r.composition
        .map((line, lineIndex) => normalizeCompositionLine(line, lineIndex))
        .filter((line): line is MealCompositionLine => line !== null)
    : []
  return {
    id,
    kind: r.kind,
    nameRu,
    nameKa: str(r.nameKa, nameRu).trim() || nameRu,
    nameEn: str(r.nameEn, nameRu).trim() || nameRu,
    employeePriceGel: r.kind === 'extra' ? Math.max(0, num(r.employeePriceGel, 0)) : 0,
    ...(composition.length ? { composition } : {}),
    active: r.active !== false,
    sort: num(r.sort, index),
  }
}

function normalizeWeek(raw: unknown): MealMenuWeek | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealMenuWeek>
  const weekStart = str(r.weekStart || r.id).trim()
  if (!isDate(weekStart)) return null
  const inputDays = Array.isArray(r.days) ? r.days : []
  const baseByDate = new Map<string, string>()
  const extrasByDate = new Map<string, string[]>()
  for (const day of inputDays) {
    if (!day || typeof day !== 'object') continue
    const date = str((day as { date?: string }).date).trim()
    if (!isDate(date)) continue
    const baseItemId = str((day as { baseItemId?: string }).baseItemId).trim()
    if (baseItemId) baseByDate.set(date, baseItemId)
    const rawExtras = (day as { extraIds?: unknown }).extraIds
    if (Array.isArray(rawExtras)) {
      extrasByDate.set(date, [
        ...new Set(rawExtras.map((id) => str(id).trim()).filter(Boolean)),
      ])
    }
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDaysIso(weekStart, index)
    const baseItemId = baseByDate.get(date)
    const extraIds = extrasByDate.get(date)
    return {
      date,
      ...(baseItemId ? { baseItemId } : {}),
      ...(extraIds ? { extraIds } : {}),
    }
  })
  const now = new Date().toISOString()
  return {
    id: weekStart,
    weekStart,
    status: r.status === 'published' ? 'published' : 'draft',
    days,
    extraIds: Array.isArray(r.extraIds)
      ? [...new Set(r.extraIds.map((id) => str(id).trim()).filter(Boolean))]
      : [],
    createdAt: str(r.createdAt, now),
    updatedAt: str(r.updatedAt, now),
    publishedAt: str(r.publishedAt).trim() || undefined,
    publishedBy: str(r.publishedBy).trim() || undefined,
    publishedByName: str(r.publishedByName).trim() || undefined,
    copiedFromWeekId: str(r.copiedFromWeekId).trim() || undefined,
  }
}

function normalizeAdvance(raw: unknown): MealAdvanceReceipt | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<MealAdvanceReceipt>
  const amountGel = Math.max(0, num(r.amountGel, 0))
  const receivedAt = str(r.receivedAt).trim()
  if (!amountGel || !receivedAt) return null
  return {
    id: str(r.id).trim() || crypto.randomUUID(),
    amountGel,
    receivedAt,
    note: str(r.note).trim() || undefined,
    createdBy: str(r.createdBy).trim() || undefined,
    createdByName: str(r.createdByName).trim() || undefined,
  }
}

export function normalizeMealsStore(raw: unknown): MealsStore {
  const r = (raw ?? {}) as Partial<MealsStore>
  const orders = Array.isArray(r.orders)
    ? r.orders.map(normalizeOrder).filter((o): o is MealOrder => o !== null)
    : []
  const acceptedDays = Array.isArray(r.acceptedDays)
    ? r.acceptedDays
        .map(normalizeAcceptedDay)
        .filter((d): d is MealAcceptedDay => d !== null)
    : []
  const byDate = new Map<string, MealAcceptedDay>()
  for (const day of acceptedDays) byDate.set(day.date, day)
  const catalog = Array.isArray(r.catalog)
    ? r.catalog
        .map((item, index) => normalizeCatalogItem(item, index))
        .filter((item): item is MealCatalogItem => item !== null)
    : []
  const weeks = Array.isArray(r.weeks)
    ? r.weeks.map(normalizeWeek).filter((week): week is MealMenuWeek => week !== null)
    : []
  const advances = Array.isArray(r.advances)
    ? r.advances.map(normalizeAdvance).filter((row): row is MealAdvanceReceipt => row !== null)
    : []
  return {
    settings: normalizeSettings(r.settings),
    catalog,
    weeks,
    advances,
    orders,
    acceptedDays: [...byDate.values()],
  }
}

export function getMeals(store: Pick<AppStore, 'meals'> | undefined | null): MealsStore {
  return normalizeMealsStore(store?.meals)
}
