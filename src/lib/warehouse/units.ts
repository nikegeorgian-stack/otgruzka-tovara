import type { Locale } from '@/lib/types'

export type UnitDimension = 'count' | 'mass' | 'volume' | 'length' | 'area' | 'cubic'

export type UnitDef = {
  code: string
  dimension: UnitDimension
  ru: string
  ka: string
}

/** Справочник единиц измерения: код (как хранится) + перевод + размерность. */
export const UNIT_DEFS: UnitDef[] = [
  // Штучные / тара
  { code: 'шт', dimension: 'count', ru: 'шт', ka: 'ცალი' },
  { code: 'компл', dimension: 'count', ru: 'компл', ka: 'კომპლ.' },
  { code: 'уп', dimension: 'count', ru: 'уп', ka: 'შეფ.' },
  { code: 'рул', dimension: 'count', ru: 'рул', ka: 'რულ.' },
  { code: 'коробка', dimension: 'count', ru: 'коробка', ka: 'კოლოფი' },
  { code: 'ящик', dimension: 'count', ru: 'ящик', ka: 'ყუთი' },
  { code: 'мешок', dimension: 'count', ru: 'мешок', ka: 'ტომარა' },
  { code: 'палета', dimension: 'count', ru: 'палета', ka: 'პალეტი' },
  // Масса
  { code: 'г', dimension: 'mass', ru: 'г', ka: 'გ' },
  { code: 'кг', dimension: 'mass', ru: 'кг', ka: 'კგ' },
  { code: 'т', dimension: 'mass', ru: 'т', ka: 'ტ' },
  // Объём
  { code: 'мл', dimension: 'volume', ru: 'мл', ka: 'მლ' },
  { code: 'л', dimension: 'volume', ru: 'л', ka: 'ლ' },
  // Длина / площадь / объём
  { code: 'м', dimension: 'length', ru: 'м', ka: 'მ' },
  { code: 'м²', dimension: 'area', ru: 'м²', ka: 'მ²' },
  { code: 'м³', dimension: 'cubic', ru: 'м³', ka: 'მ³' },
]

const BY_CODE = new Map(UNIT_DEFS.map((u) => [u.code, u]))

export const UNIT_CODES = UNIT_DEFS.map((u) => u.code)

/** Локализованная подпись единицы (фолбэк — сам код). */
export function unitLabel(code: string | undefined, locale: Locale): string {
  if (!code) return ''
  const def = BY_CODE.get(code)
  if (!def) return code
  return locale === 'ka' ? def.ka : def.ru
}

export function unitDimension(code: string): UnitDimension | undefined {
  return BY_CODE.get(code)?.dimension
}

/**
 * Можно ли связать единицы коэффициентом пересчёта.
 * 'count' — это тара/упаковка (уп, рул, компл, шт): сочетается с любой единицей
 * (например, 1 рулон = 50 м — это нормально). Запрещаем только связь двух
 * РАЗНЫХ измеримых величин (масса ↔ объём ↔ длина ↔ площадь ↔ м³).
 * Неизвестные единицы не блокируем.
 */
export function unitsConvertible(a: string, b: string): boolean {
  const da = unitDimension(a)
  const db = unitDimension(b)
  if (!da || !db) return true
  if (da === 'count' || db === 'count') return true
  return da === db
}
