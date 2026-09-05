import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { employeeNameLines, t, tf } from '@/i18n'
import type { Locale } from '@/i18n/types'
import { formatMonthTitle } from '@/lib/dates'
import {
  documentLineTotal,
  resolveAdvanceDocumentLines,
} from '@/lib/finance/advanceDocuments'
import type { DisbursementPrintRow } from '@/lib/finance/disbursementPrintFilter'
import { primaryIbanDisplay, primaryIbanRaw } from '@/lib/hr/employeeBank'
import { formatGel } from '@/lib/payroll'
import type { FinanceAdvanceDocument } from '@/lib/finance/types'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  document: FinanceAdvanceDocument
  printLocale: Locale
  /** Если задано — печатаем только эти строки (фильтр в модалке). */
  printRows?: DisbursementPrintRow[]
  filterCaption?: string
}

function money(n: number): string {
  if (!n) return '—'
  return formatGel(n).replace(' ₾', '')
}

export function PrintAdvanceDisbursementSheet({
  store,
  document: doc,
  printLocale,
  printRows,
  filterCaption,
}: Props) {
  const resolved = resolveAdvanceDocumentLines(store, doc)
  const rows =
    printRows ??
    resolved.map((r) => ({
      lineId: r.line.id,
      employeeId: r.line.employeeId,
      emp: r.emp,
      employeeName: r.employeeName,
      amount: r.line.amount,
    }))
  const total = printRows
    ? printRows.reduce((s, r) => s + Math.round(r.amount), 0)
    : documentLineTotal(doc.lines)
  const monthTitle = formatMonthTitle(doc.month, printLocale)
  const title = `${t(printLocale, 'fin.advDoc.printTitle')} — ${doc.number}`

  return (
    <article className="print-sheet-page print-bank-transfer-page print-advance-doc-page">
      <div className="print-sheet-content">
        <PrintBrandWatermark />
        <PrintSheetHeader
          locale={printLocale}
          title={title}
          site={store.settings.site}
          responsible={store.settings.responsible}
          brigades={[]}
          store={store}
          monthKey={doc.month}
        />

        <p className="print-bank-purpose">
          {doc.purpose ||
            tf(printLocale, 'fin.advDoc.purposeDefaultLong', { month: monthTitle })}
          {' · '}
          {t(printLocale, 'fin.date')}: {doc.date}
          {' · '}
          {t(printLocale, 'fin.method')}: {t(printLocale, `fin.method.${doc.method}`)}
          {filterCaption ? ` · ${filterCaption}` : ''}
        </p>

        <table className="print-table print-bank-transfer-table">
          <thead>
            <tr>
              <th className="print-th print-th-center print-bank-col-no">
                {t(printLocale, 'fin.bankTransfer.colNo')}
              </th>
              <th className="print-th print-th-left">
                {t(printLocale, 'fin.bankTransfer.colName')}
              </th>
              <th className="print-th print-th-right">{t(printLocale, 'fin.advDoc.colAmount')}</th>
              {doc.method === 'bank' && (
                <th className="print-th print-th-left">
                  {t(printLocale, 'fin.bankTransfer.colIban')}
                </th>
              )}
              <th className="print-th print-th-center">{t(printLocale, 'fin.advDoc.colSignature')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const missingIban = doc.method === 'bank' && row.emp && !primaryIbanRaw(row.emp)
              return (
                <tr key={row.lineId} className={missingIban ? 'print-bank-row--warn' : undefined}>
                  <td className="print-td print-td-center">{i + 1}</td>
                  <td className="print-td print-td-name">
                    {row.emp
                      ? employeeNameLines(row.emp, printLocale).primary
                      : row.employeeName}
                  </td>
                  <td className="print-td print-td-right print-td-bold">{money(row.amount)}</td>
                  {doc.method === 'bank' && (
                    <td
                      className={`print-td print-td-mono ${missingIban ? 'print-bank-missing' : ''}`}
                    >
                      {missingIban ? '—' : row.emp ? primaryIbanDisplay(row.emp) : '—'}
                    </td>
                  )}
                  <td className="print-td print-td-center print-signature-cell">________</td>
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
              <td className="print-td print-td-right print-td-bold">{money(total)}</td>
              {doc.method === 'bank' && <td colSpan={2} />}
              {doc.method !== 'bank' && <td />}
            </tr>
          </tfoot>
        </table>

        <footer className="print-bank-footer">
          <div>
            <span className="print-meta-label">{t(printLocale, 'fin.payslip.accountant')}</span>
            <span className="print-meta-line">
              {store.settings.responsible || '________________'}
            </span>
          </div>
          <div>
            <span className="print-meta-label">{t(printLocale, 'fin.advDoc.cashier')}</span>
            <span className="print-meta-line">________________</span>
          </div>
          <div className="print-bank-footer-date">
            {t(printLocale, 'fin.bankTransfer.date')}:{' '}
            {new Date(doc.postedAt ?? doc.at).toLocaleDateString(
              printLocale === 'ka' ? 'ka-GE' : 'ru-RU',
            )}
          </div>
        </footer>
      </div>
    </article>
  )
}
