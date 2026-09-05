import type { AppStore, Locale } from '@/lib/types'

export type ExportKind =
  | 'timesheet'
  | 'payroll'
  | 'payroll_statement'
  | 'payroll_bank_transfer'
  | 'salary_calculation_1c'
  | 'advance_disbursement'
  | 'payout_disbursement'
  | 'brigades'
  | 'warehouse'

export async function runExport(
  kind: ExportKind,
  store: AppStore,
  options?: {
    month?: string
    locale?: Locale
    warehouseId?: string
    documentId?: string
    rateDate?: string
  },
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
    case 'payroll_statement': {
      if (!month) return
      const { exportPayrollStatementExcel } = await import('@/lib/excelExport')
      await exportPayrollStatementExcel(store, month, locale)
      break
    }
    case 'payroll_bank_transfer': {
      if (!month) return
      const { exportPayrollBankTransferExcel } = await import('@/lib/export/payrollBankTransferExcel')
      await exportPayrollBankTransferExcel(store, month, locale)
      break
    }
    case 'salary_calculation_1c': {
      if (!month) return
      const { exportSalaryCalculation1cExcel } = await import(
        '@/lib/export/salaryCalculation1cExcel'
      )
      await exportSalaryCalculation1cExcel(store, month, locale, {
        rateDate: options?.rateDate,
      })
      break
    }
    case 'advance_disbursement': {
      if (!options?.documentId) return
      const { exportAdvanceDisbursementExcel } = await import('@/lib/export/advanceDisbursementExcel')
      await exportAdvanceDisbursementExcel(store, options.documentId, locale)
      break
    }
    case 'payout_disbursement': {
      if (!options?.documentId) return
      const { exportPayoutDisbursementExcel } = await import('@/lib/export/payoutDisbursementExcel')
      await exportPayoutDisbursementExcel(store, options.documentId, locale)
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
