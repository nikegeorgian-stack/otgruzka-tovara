import type { ViewId } from '@/lib/types'

/** Канонические разделы (без устаревших алиасов employees/codes/pay). */
export const ROUTABLE_VIEWS: ViewId[] = [
  'month',
  'summary',
  'production',
  'planner',
  'warehouse',
  'procurement',
  'technologist',
  'hr',
  'finance',
  'directories',
  'journals',
  'settings',
]

/** Устаревшие алиасы → канонический раздел. */
const VIEW_ALIASES: Partial<Record<string, ViewId>> = {
  employees: 'directories',
  codes: 'directories',
  pay: 'hr',
}

/**
 * Единая проверка активного пункта навигации.
 * Используется в боковом меню, нижней панели и мобильном drawer,
 * чтобы подсветка совпадала во всех трёх местах.
 */
export function isNavActive(view: ViewId, itemId: ViewId): boolean {
  if (view === itemId) return true
  if (itemId === 'hr' && view === 'pay') return true
  if (itemId === 'finance' && view === 'pay') return true
  if (itemId === 'directories' && (view === 'employees' || view === 'codes')) return true
  return false
}

const HASH_PREFIX = '#/'

export function viewToHash(view: ViewId): string {
  return `${HASH_PREFIX}${view}`
}

/** Разбирает текущий хэш в раздел (учитывая алиасы). null — если не распознан. */
export function hashToView(hash: string): ViewId | null {
  if (!hash) return null
  const raw = hash.replace(/^#\/?/, '').split(/[/?]/)[0]?.trim()
  if (!raw) return null
  if ((ROUTABLE_VIEWS as string[]).includes(raw)) return raw as ViewId
  return VIEW_ALIASES[raw] ?? null
}

export function readViewFromLocation(): ViewId | null {
  if (typeof window === 'undefined') return null
  return hashToView(window.location.hash)
}
