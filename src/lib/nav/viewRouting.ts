import type { ViewId } from '@/lib/types'
import type { DirectorySection } from '@/lib/directories/types'

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
  'hr_inspector',
  'finance',
  'directories',
  'journals',
  'settings',
]

/** Устаревшие алиасы → канонический раздел. */
const VIEW_ALIASES: Partial<Record<string, ViewId>> = {
  employees: 'directories',
  codes: 'directories',
  pay: 'finance',
}

export type ViewRoute = {
  view: ViewId
  directorySection?: DirectorySection
}

export function readRouteFromLocation(): ViewRoute | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash) return null
  const raw = hash.replace(/^#\/?/, '').split(/[/?]/)[0]?.trim()
  if (!raw) return null
  if (raw === 'employees') return { view: 'directories', directorySection: 'employees' }
  if (raw === 'codes') return { view: 'directories', directorySection: 'codes' }
  const view = hashToView(hash)
  return view ? { view } : null
}

/**
 * Единая проверка активного пункта навигации.
 * Используется в боковом меню, нижней панели и мобильном drawer,
 * чтобы подсветка совпадала во всех трёх местах.
 */
export function isNavActive(view: ViewId, itemId: ViewId): boolean {
  if (view === itemId) return true
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
  return readRouteFromLocation()?.view ?? null
}
