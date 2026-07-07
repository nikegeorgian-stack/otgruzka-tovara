import { computeProcurementKpis } from '@/lib/procurement/analytics'
import { monthStats } from '@/lib/stats'
import type { AppStore } from '@/lib/types'
import { computeAllBalances, computeAllBalancesAsOf, computeReorderRows } from '@/lib/warehouse/stock'

export type ExecutiveKpiInput = Pick<
  AppStore,
  'procurement' | 'warehouse' | 'months' | 'employees'
>

export type ExecutiveKpis = {
  openPurchaseOrders: number
  procurementOverdue: number
  factHoursMonth: number
  factHoursMonthKey: string
  stockDeficits: number
}

function resolveTimesheetMonthKey(store: ExecutiveKpiInput): string {
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (store.months[current]) return current
  const keys = Object.keys(store.months).sort()
  return keys[keys.length - 1] ?? current
}

/** Сводные KPI директора: закупки, табель, склад */
export function computeExecutiveKpis(
  input: ExecutiveKpiInput,
  today = new Date(),
  asOfIso?: string,
): ExecutiveKpis {
  const proc = computeProcurementKpis(input.procurement.orders, today)
  const monthKey = resolveTimesheetMonthKey(input)
  const sheet = input.months[monthKey]
  const stats = sheet ? monthStats(sheet, input.employees) : null

  const balances = asOfIso
    ? computeAllBalancesAsOf(input.warehouse, asOfIso)
    : computeAllBalances(input.warehouse)
  const deficits = computeReorderRows(
    input.warehouse.items.filter((i) => i.active),
    balances,
  )

  return {
    openPurchaseOrders: proc.activeOrders,
    procurementOverdue: proc.overdue,
    factHoursMonth: stats?.factHours ?? 0,
    factHoursMonthKey: monthKey,
    stockDeficits: deficits.length,
  }
}
