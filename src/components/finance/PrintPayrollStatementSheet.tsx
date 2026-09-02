import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { formatMonthTitle } from '@/lib/dates'
import { statementTotals, type StatementRow } from '@/lib/finance/calc'
import { formatGel } from '@/lib/payroll'
import { t } from '@/i18n'
import type { AppStore, Locale } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  rows: StatementRow[]
  printLocale: Locale
}

function money(n: number): string {
  if (!n) return '—'
  return formatGel(n).replace(' ₾', '')
}

export function PrintPayrollStatementSheet({ store, month, rows, printLocale }: Props) {
  const totals = statementTotals(rows)
  const title = `${t(printLocale, 'fin.statement.title')} — ${formatMonthTitle(month, printLocale)}`

  return (
    <article className="print-sheet-page print-payroll-page">
      <div className="print-sheet-content">
        <PrintBrandWatermark />
        <PrintSheetHeader
          locale={printLocale}
          title={title}
          site={store.settings.site}
          responsible={store.settings.responsible}
          brigades={[]}
          store={store}
          monthKey={month}
        />

        <table className="print-table print-payroll-table">
          <thead>
            <tr>
              <th className="print-th print-th-left">№</th>
              <th className="print-th print-th-left">{t(printLocale, 'employees.colName')}</th>
              <th className="print-th">{t(printLocale, 'employees.colSchedule')}</th>
              <th className="print-th">{t(printLocale, 'stats.factH')}</th>
              <th className="print-th">{t(printLocale, 'fin.payslip.base')}</th>
              <th className="print-th">{t(printLocale, 'fin.payslip.night')}</th>
              <th className="print-th">110%</th>
              <th className="print-th">115%</th>
              <th className="print-th">120%</th>
              <th className="print-th">{t(printLocale, 'fin.payslip.idle')}</th>
              <th className="print-th">{t(printLocale, 'fin.payslip.vacation')}</th>
              <th className="print-th">{t(printLocale, 'fin.col.accrued')}</th>
              <th className="print-th">{t(printLocale, 'fin.col.net')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.employeeId}>
                <td className="print-td print-td-center">{i + 1}</td>
                <td className="print-td print-td-name">{row.emp.fullName || row.emp.nameKa}</td>
                <td className="print-td print-td-center">{row.schedule}</td>
                <td className="print-td print-td-center">{row.factHours || '—'}</td>
                <td className="print-td print-td-right">{money(row.breakdown.base)}</td>
                <td className="print-td print-td-right">{money(row.breakdown.night)}</td>
                <td className="print-td print-td-right">{money(row.breakdown.ot110)}</td>
                <td className="print-td print-td-right">{money(row.breakdown.ot115)}</td>
                <td className="print-td print-td-right">{money(row.breakdown.ot120)}</td>
                <td className="print-td print-td-right">{money(row.breakdown.idle)}</td>
                <td className="print-td print-td-right">
                  {money(row.breakdown.vacation + row.breakdown.sick)}
                </td>
                <td className="print-td print-td-right print-td-bold">{money(row.accrued)}</td>
                <td className="print-td print-td-right print-td-bold">{money(row.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="print-payroll-totals">
              <td className="print-td" colSpan={4}>
                {printLocale === 'ka' ? 'სულ' : 'Итого'}
              </td>
              <td className="print-td print-td-right" colSpan={7} />
              <td className="print-td print-td-right print-td-bold">{money(totals.accrued)}</td>
              <td className="print-td print-td-right print-td-bold">{money(totals.net)}</td>
            </tr>
          </tfoot>
        </table>

        <footer className="print-payroll-footer">
          <div>
            <span className="print-meta-label">{t(printLocale, 'fin.payslip.accountant')}</span>
            <span className="print-meta-line">{store.settings.responsible || '________________'}</span>
          </div>
          <div className="print-payroll-footer-date">{new Date().toLocaleDateString('ru-RU')}</div>
        </footer>
      </div>
    </article>
  )
}
