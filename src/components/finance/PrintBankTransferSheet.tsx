import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { employeeNameLines, t, tf } from '@/i18n'
import type { Locale } from '@/i18n/types'
import { formatMonthTitle } from '@/lib/dates'
import { statementTotals, type StatementRow } from '@/lib/finance/calc'
import { primaryIbanDisplay, primaryIbanRaw } from '@/lib/hr/employeeBank'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'

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

export function PrintBankTransferSheet({ store, month, rows, printLocale }: Props) {
  const totals = statementTotals(rows)
  const monthTitle = formatMonthTitle(month, printLocale)
  const title = `${t(printLocale, 'fin.bankTransfer.title')} — ${monthTitle}`
  const missingCount = rows.filter((r) => !primaryIbanRaw(r.emp)).length

  return (
    <article className="print-sheet-page print-bank-transfer-page">
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

        <p className="print-bank-purpose">{tf(printLocale, 'fin.bankTransfer.purpose', { month: monthTitle })}</p>

        <table className="print-table print-bank-transfer-table">
          <thead>
            <tr>
              <th className="print-th print-th-center print-bank-col-no">{t(printLocale, 'fin.bankTransfer.colNo')}</th>
              <th className="print-th print-th-left">{t(printLocale, 'fin.bankTransfer.colName')}</th>
              <th className="print-th print-th-right">{t(printLocale, 'fin.bankTransfer.colAmount')}</th>
              <th className="print-th print-th-left">{t(printLocale, 'fin.bankTransfer.colIban')}</th>
              <th className="print-th print-th-left">{t(printLocale, 'fin.bankTransfer.colNote')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const missingIban = !primaryIbanRaw(row.emp)
              return (
                <tr key={row.employeeId} className={missingIban ? 'print-bank-row--warn' : undefined}>
                  <td className="print-td print-td-center">{i + 1}</td>
                  <td className="print-td print-td-name">{employeeNameLines(row.emp, printLocale).primary}</td>
                  <td className="print-td print-td-right print-td-bold">{money(row.remaining)}</td>
                  <td className={`print-td print-td-mono ${missingIban ? 'print-bank-missing' : ''}`}>
                    {missingIban ? '—' : primaryIbanDisplay(row.emp)}
                  </td>
                  <td className={`print-td ${missingIban ? 'print-bank-missing' : ''}`}>
                    {missingIban ? t(printLocale, 'fin.bankTransfer.missingIban') : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="print-bank-totals">
              <td className="print-td" colSpan={2}>
                {t(printLocale, 'fin.bankTransfer.total')} (
                {tf(printLocale, 'fin.bankTransfer.count', { n: rows.length })})
              </td>
              <td className="print-td print-td-right print-td-bold">{money(totals.remaining)}</td>
              <td className="print-td print-bank-missing" colSpan={2}>
                {missingCount
                  ? tf(printLocale, 'fin.bankTransfer.missingCount', { n: missingCount })
                  : ''}
              </td>
            </tr>
          </tfoot>
        </table>

        <footer className="print-bank-footer">
          <div>
            <span className="print-meta-label">{t(printLocale, 'fin.payslip.accountant')}</span>
            <span className="print-meta-line">{store.settings.responsible || '________________'}</span>
          </div>
          <div>
            <span className="print-meta-label">{t(printLocale, 'fin.bankTransfer.director')}</span>
            <span className="print-meta-line">________________</span>
          </div>
          <div className="print-bank-footer-date">
            {t(printLocale, 'fin.bankTransfer.date')}:{' '}
            {new Date().toLocaleDateString(printLocale === 'ka' ? 'ka-GE' : 'ru-RU')}
          </div>
        </footer>
      </div>
    </article>
  )
}
