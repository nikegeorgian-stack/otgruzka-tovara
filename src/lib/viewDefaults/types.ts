import type { FinanceSection } from '@/pages/FinancePage'
import type { WarehouseTab } from '@/components/warehouse/warehouseTypes'
import type { MonthGroupMode, MonthViewDisplay } from '@/lib/monthViewOptions'
import type { MonthRowSort } from '@/lib/monthRowSort'
import type { HrSection, ViewId } from '@/lib/types'

export type MonthViewLayout = 'dual' | 'plan' | 'fact'

export type MonthViewDefaults = {
  layout?: MonthViewLayout
  viewDisplay?: Partial<MonthViewDisplay>
  defaultBrigades?: string[]
  groupMode?: MonthGroupMode
  rowSort?: MonthRowSort
}

export type WarehouseViewDefaults = {
  tab?: WarehouseTab
  warehouseId?: string
  deficitOnly?: boolean
  showArchived?: boolean
}

export type FinanceViewDefaults = {
  section?: FinanceSection
}

export type HrViewDefaults = {
  section?: HrSection
}

export type GlobalViewDefaults = {
  lastView?: ViewId
  lastMonth?: string
}

export type UserViewDefaults = {
  global?: GlobalViewDefaults
  month?: MonthViewDefaults
  warehouse?: WarehouseViewDefaults
  finance?: FinanceViewDefaults
  hr?: HrViewDefaults
}

export function resolveMonthViewDefaults(
  viewDefaults?: UserViewDefaults,
  legacyBrigades?: string[],
): MonthViewDefaults | undefined {
  const month = viewDefaults?.month
  const brigades = month?.defaultBrigades?.length
    ? month.defaultBrigades
    : legacyBrigades?.length
      ? legacyBrigades
      : undefined
  if (!month && !brigades) return undefined
  return {
    ...month,
    defaultBrigades: brigades,
  }
}

export function resolveWarehouseViewDefaults(
  viewDefaults?: UserViewDefaults,
): WarehouseViewDefaults | undefined {
  return viewDefaults?.warehouse
}

export function resolveFinanceViewDefaults(
  viewDefaults?: UserViewDefaults,
): FinanceViewDefaults | undefined {
  return viewDefaults?.finance
}

export function resolveHrViewDefaults(
  viewDefaults?: UserViewDefaults,
): HrViewDefaults | undefined {
  return viewDefaults?.hr
}

export function mergeUserViewDefaults<K extends keyof UserViewDefaults>(
  prev: UserViewDefaults | undefined,
  viewId: K,
  patch: NonNullable<UserViewDefaults[K]>,
): UserViewDefaults {
  const base = prev ?? {}
  if (viewId === 'global' || viewId === 'month' || viewId === 'warehouse' || viewId === 'finance' || viewId === 'hr') {
    return {
      ...base,
      [viewId]: { ...(base[viewId] as object | undefined), ...patch },
    }
  }
  return base
}
