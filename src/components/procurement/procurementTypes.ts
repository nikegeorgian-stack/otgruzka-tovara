import type { ProcurementPageProps } from '@/lib/app/procurementProps'

export type ProcurementTab =
  | 'orders'
  | 'tracking'
  | 'containers'
  | 'stock'
  | 'analytics'
  | 'catalog'

export const PROCUREMENT_TABS: ProcurementTab[] = [
  'orders',
  'tracking',
  'containers',
  'stock',
  'analytics',
  'catalog',
]

/** Кабинет менеджера закупок (импорт, контейнеры). */
export const PROCUREMENT_WEB_TABS: ProcurementTab[] = [
  'containers',
  'tracking',
  'orders',
  'stock',
  'analytics',
  'catalog',
]
export type { ProcurementPageProps }
