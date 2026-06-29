import type { AppStore, Locale } from '@/lib/types'

export type ExportKind = 'timesheet' | 'payroll' | 'brigades' | 'warehouse'

export async function runExport(
  kind: ExportKind,
  store: AppStore,
  options?: { month?: string; locale?: Locale; warehouseId?: string },
): Promise<void> {
  const locale = options?.locale ?? store.settings.locale
  const month = options?.month

  switch (kind) {
    case 'timesheet': {
      if (!month) return
      const { exportTimesheetExcel } = await import('@/lib/excelExport')
      await exportTimesheetExcel(store, month, locale)
      break
    }
    case 'payroll': {
      if (!month) return
      const { exportPayrollExcel } = await import('@/lib/excelExport')
      await exportPayrollExcel(store, month, locale)
      break
    }
    case 'brigades': {
      if (!month) return
      const { exportBrigadeReportExcel } = await import('@/lib/excelExport')
      await exportBrigadeReportExcel(store, month, locale)
      break
    }
    case 'warehouse': {
      const { exportWarehouseFromStore } = await import('@/lib/warehouse/exportBalances')
      await exportWarehouseFromStore(store.warehouse, options?.warehouseId)
      break
    }
  }
}

export { exportLabels } from './labels'
