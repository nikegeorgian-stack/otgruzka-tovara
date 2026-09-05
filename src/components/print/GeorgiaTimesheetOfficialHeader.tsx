import { t, tf, type Locale } from '@/i18n'
import { GE_OFFICIAL_FORM_ANNEX, GE_OFFICIAL_FORM_REF } from '@/lib/printGeorgiaOfficial'
import type { GeorgiaPrintHeaderFields } from '@/lib/printGeorgiaOfficial'

type Props = {
  locale: Locale
  fields: GeorgiaPrintHeaderFields
  sheetTitle: string
  pageLabel?: string
}

export function GeorgiaTimesheetOfficialHeader({
  locale,
  fields,
  sheetTitle,
  pageLabel,
}: Props) {
  const rows: { labelKey: string; value: string }[] = [
    { labelKey: 'print.ge.org', value: fields.organization },
    { labelKey: 'print.ge.unit', value: fields.structuralUnit },
    { labelKey: 'print.ge.prepared', value: fields.preparationDate },
    {
      labelKey: 'print.ge.period',
      value: `${fields.periodFrom} – ${fields.periodTo}`,
    },
    { labelKey: 'print.ge.idCode', value: fields.idCode },
  ]

  return (
    <header className="print-ge-official-header">
      <div className="print-ge-official-top">
        <div className="print-ge-official-title-block">
          <p className="print-ge-official-kicker">
            {t('ka', 'print.ge.formTitle')}
            {locale !== 'ka' ? (
              <span className="print-ge-bilingual"> / {t(locale, 'print.ge.formTitle')}</span>
            ) : null}
          </p>
          <h1 className="print-ge-official-sheet-title">{sheetTitle}</h1>
          <p className="print-ge-official-ref">
            {tf(locale, 'print.ge.orderRef', {
              order: GE_OFFICIAL_FORM_REF,
              annex: GE_OFFICIAL_FORM_ANNEX,
            })}
          </p>
        </div>
        <div className="print-ge-official-registry" aria-hidden>
          <span className="print-form-code">{GE_OFFICIAL_FORM_REF}</span>
          {pageLabel ? <span className="print-form-page">{pageLabel}</span> : null}
        </div>
      </div>

      <table className="print-ge-meta-table">
        <tbody>
          {rows.map(({ labelKey, value }) => (
            <tr key={labelKey}>
              <th className="print-ge-meta-label">
                {t('ka', labelKey)}
                {locale !== 'ka' ? (
                  <span className="print-ge-meta-ru"> / {t(locale, labelKey)}</span>
                ) : null}
              </th>
              <td className="print-ge-meta-value">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </header>
  )
}
