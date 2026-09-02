import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { formatMonthTitle } from '@/lib/dates'
import { brigadeSummaryRows, brigadeSummaryTotals } from '@/lib/printBrigadeSummary'
import { TIMESHEET_PRINT_FORMS } from '@/lib/printForms'
import { t } from '@/i18n'
import type { AppStore, Locale, MonthSheet } from '@/lib/types'

type Props = {
  store: AppStore
  sheet: MonthSheet
  brigades: string[]
  printLocale: Locale
  pageLabel?: string
  georgiaOfficial?: boolean
  showHours?: boolean
}

export function PrintBrigadeSummarySheet({
  store,
  sheet,
  brigades,
  printLocale,
  pageLabel,
  georgiaOfficial = false,
  showHours = true,
}: Props) {
  const rows = brigadeSummaryRows(store, sheet, brigades)
  const totals = brigadeSummaryTotals(rows)
  const title = `${t(printLocale, 'print.summarySheet')} — ${formatMonthTitle(sheet.month, printLocale)}`

  return (
    <article
      className="print-sheet-page print-summary-page"
      data-print-mode="summary"
    >
      <div className="print-sheet-content">
        <PrintBrandWatermark />
        <PrintSheetHeader
          locale={printLocale}
          title={title}
          site={store.settings.site}
          responsible={store.settings.responsible}
          brigades={brigades}
          formCode={georgiaOfficial ? undefined : TIMESHEET_PRINT_FORMS.summary.code}
          pageLabel={pageLabel}
          georgiaOfficial={georgiaOfficial}
          store={store}
          monthKey={sheet.month}
        />

        <table className="print-table print-summary-table">
          <thead>
            <tr>
              <th className="print-th print-th-left">{t(printLocale, 'print.sumColBrigade')}</th>
              <th className="print-th">{t(printLocale, 'print.sumColEmployees')}</th>
              {showHours ? (
                <>
                  <th className="print-th">{t(printLocale, 'print.colPlanH')}</th>
                  <th className="print-th">{t(printLocale, 'print.colFactH')}</th>
                  <th className="print-th">{t(printLocale, 'print.kpiDev')}</th>
                </>
              ) : null}
              <th className="print-th">{t(printLocale, 'print.kpiShifts')}</th>
              <th className="print-th">{t(printLocale, 'print.sumColMismatch')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.brigade}>
                <td className="print-td print-td-name">{row.brigade}</td>
                <td className="print-td print-td-center">{row.employees}</td>
                {showHours ? (
                  <>
                    <td className="print-td print-td-center print-td-bold">{row.planHours}</td>
                    <td className="print-td print-td-center print-td-bold">{row.factHours}</td>
                    <td
                      className={`print-td print-td-center print-td-bold ${
                        row.deviation < 0
                          ? 'print-sum-dev--neg'
                          : row.deviation > 0
                            ? 'print-sum-dev--pos'
                            : ''
                      }`}
                    >
                      {row.deviation > 0 ? `+${row.deviation}` : row.deviation}
                    </td>
                  </>
                ) : null}
                <td className="print-td print-td-center">{row.factShifts}</td>
                <td
                  className={`print-td print-td-center ${
                    row.mismatches > 0 ? 'print-sum-mismatch' : ''
                  }`}
                >
                  {row.mismatches}
                </td>
              </tr>
            ))}
            <tr className="print-summary-total-row">
              <td className="print-td print-td-name print-td-bold">
                {t(printLocale, 'print.sumTotal')}
              </td>
              <td className="print-td print-td-center print-td-bold">{totals.employees}</td>
              {showHours ? (
                <>
                  <td className="print-td print-td-center print-td-bold">{totals.planHours}</td>
                  <td className="print-td print-td-center print-td-bold">{totals.factHours}</td>
                  <td className="print-td print-td-center print-td-bold">
                    {totals.deviation > 0 ? `+${totals.deviation}` : totals.deviation}
                  </td>
                </>
              ) : null}
              <td className="print-td print-td-center print-td-bold">{totals.factShifts}</td>
              <td className="print-td print-td-center print-td-bold">{totals.mismatches}</td>
            </tr>
          </tbody>
        </table>

        <footer className="print-sheet-footer print-signatures print-signatures--grid">
          <PrintSummarySignatures
            locale={printLocale}
            store={store}
            georgiaOfficial={georgiaOfficial}
          />
          <span className="print-footer-date">
            {t(printLocale, 'print.date')}: _______________
          </span>
        </footer>
      </div>
    </article>
  )
}

function PrintSummarySignatures({
  locale,
  store,
  georgiaOfficial = false,
}: {
  locale: Locale
  store: AppStore
  georgiaOfficial?: boolean
}) {
  const s = store.settings.signatures ?? {}

  if (georgiaOfficial) {
    const directorName =
      locale === 'ka' ? s.directorKa || s.directorRu : s.directorRu || s.directorKa
    return (
      <>
        <div className="print-sig-card">
          <span className="print-sig-role">{t(locale, 'print.ge.signResponsible')}</span>
          <span className="print-sig-line" />
          <span className="print-sig-name">{store.settings.responsible || ''}</span>
        </div>
        <div className="print-sig-card">
          <span className="print-sig-role">{t(locale, 'print.ge.signHead')}</span>
          <span className="print-sig-line" />
          <span className="print-sig-name">{directorName || ''}</span>
        </div>
        <div className="print-sig-card print-sig-card--date">
          <span className="print-sig-role">{t(locale, 'print.ge.signDate')}</span>
          <span className="print-sig-line" />
        </div>
      </>
    )
  }

  const items = [
    { key: 'print.signMaster', name: locale === 'ka' ? s.masterKa || s.masterRu : s.masterRu || s.masterKa },
    { key: 'print.signAccountant', name: locale === 'ka' ? s.accountantKa || s.accountantRu : s.accountantRu || s.accountantKa },
    { key: 'print.signDirector', name: locale === 'ka' ? s.directorKa || s.directorRu : s.directorRu || s.directorKa },
  ]
  return (
    <>
      {items.map(({ key, name }) => (
        <div key={key} className="print-sig-card">
          <span className="print-sig-role">{t(locale, key)}</span>
          <span className="print-sig-line" />
          <span className="print-sig-name">{name || ''}</span>
        </div>
      ))}
    </>
  )
}
