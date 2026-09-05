import type { ReactNode } from 'react'
import { FiberCellBrand } from './FiberCellBrand'
import { GeorgiaTimesheetOfficialHeader } from '@/components/print/GeorgiaTimesheetOfficialHeader'
import { resolveGeorgiaPrintHeaderForMonth } from '@/lib/printGeorgiaOfficial'
import { t, type Locale } from '@/i18n'
import type { AppStore } from '@/lib/types'

type Props = {
  locale: Locale
  title: string
  site: string
  responsible?: string
  brigades: string[]
  formCode?: string
  pageLabel?: string
  georgiaOfficial?: boolean
  store?: AppStore
  monthKey?: string
  /** Скрыть строку «Табель учёта…» — для графика работ. */
  hideSheetOrg?: boolean
  /** Только заголовок: без логотипа, участка, списка бригад. */
  titleOnly?: boolean
  children?: ReactNode
}

export function PrintSheetHeader({
  locale,
  title,
  site,
  responsible,
  brigades,
  formCode,
  pageLabel,
  georgiaOfficial = false,
  store,
  monthKey,
  hideSheetOrg = false,
  titleOnly = false,
  children,
}: Props) {
  if (titleOnly) {
    return (
      <header className="print-sheet-header print-sheet-header--title-only">
        <h1 className="print-title">{title}</h1>
        {children}
      </header>
    )
  }

  if (georgiaOfficial && store && monthKey) {
    const fields = resolveGeorgiaPrintHeaderForMonth(store, monthKey, locale)
    return (
      <div className="print-sheet-header-wrap">
        <GeorgiaTimesheetOfficialHeader
          locale={locale}
          fields={fields}
          sheetTitle={title}
          pageLabel={pageLabel}
        />
        {brigades.length > 0 ? (
          <p className="print-meta print-brigades-list print-ge-brigades">
            {t(locale, 'print.brigadesLabel')}: {brigades.join(' · ')}
          </p>
        ) : null}
        {children}
      </div>
    )
  }

  return (
    <header className="print-sheet-header">
      <div className="print-fc-header-row">
        <FiberCellBrand variant="print" />
        <div className="print-fc-header-text">
          {(formCode || pageLabel) && (
            <div className="print-form-registry" aria-hidden>
              {formCode ? <span className="print-form-code">{formCode}</span> : null}
              {pageLabel ? <span className="print-form-page">{pageLabel}</span> : null}
            </div>
          )}
          {!hideSheetOrg ? (
            <p className="print-org">{t(locale, 'print.sheetTitle')}</p>
          ) : null}
          <h1 className="print-title">{title}</h1>
          <p className="print-meta">
            {t(locale, 'print.site')}: {site}
            {responsible
              ? ` · ${t(locale, 'print.responsible')}: ${responsible}`
              : ''}
          </p>
          <p className="print-meta print-brigades-list">
            {t(locale, 'print.brigadesLabel')}: {brigades.join(' · ')}
          </p>
        </div>
      </div>
      {children}
    </header>
  )
}
