import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fitPrintPages, resetPrintFit } from '@/lib/printFit'
import { createPortal } from 'react-dom'
import { formatMonthTitle } from '@/lib/dates'
import { t } from '@/i18n'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { monthStats } from '@/lib/stats'
import type { MonthGroupMode } from '@/lib/monthViewOptions'
import type { AppStore, MonthSheet } from '@/lib/types'
import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { PrintCodeLegend, PrintTimesheetTable } from './PrintTimesheetTable'

import type { Locale } from '@/lib/types'

export type PrintVariant = 'plan' | 'fact' | 'both'

export type PrintConfig = {
  variant: PrintVariant
  brigades: string[]
  fitOnePage: boolean
  printLocale: Locale
  groupMode?: import('@/lib/monthViewOptions').MonthGroupMode
  structuralUnitIds?: string[]
}

type Props = {
  store: AppStore
  sheet: MonthSheet
  config: PrintConfig
  onClose: () => void
  onBack: () => void
}

export function PrintPreviewModal({ store, sheet, config, onClose, onBack }: Props) {
  const { variant, brigades, printLocale, groupMode = 'brigade', structuralUnitIds } =
    config
  const printRef = useRef<HTMLDivElement>(null)
  const stats = monthStats(sheet, store.employees, {
    brigades,
    structuralUnitIds,
  })
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('print-preview-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('print-preview-open')
      resetPrintFit(printRef.current)
    }
  }, [onClose])

  useLayoutEffect(() => {
    if (!config.fitOnePage) return
    const id = requestAnimationFrame(() => {
      fitPrintPages(printRef.current)
    })
    return () => cancelAnimationFrame(id)
  }, [config, sheet, variant, brigades])

  function handlePrint() {
    if (config.fitOnePage) fitPrintPages(printRef.current)
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      if (config.fitOnePage) fitPrintPages(printRef.current)
      await exportPrintAreaToPdf(
        printRef.current,
        `tabel_${sheet.month}_${printLocale}.pdf`,
      )
    } finally {
      setPdfBusy(false)
    }
  }

  const brigadesLabel =
    brigades.length < 4
      ? brigades.join(', ')
      : `${brigades.length} ${t(printLocale, 'print.brigadesCount')}`

  const content = (
    <div className="print-modal-root fixed inset-0 z-[100] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t(printLocale, 'print.preview')}</h2>
          <p className="text-sm text-stone-400 capitalize">
            A4 · {formatMonthTitle(sheet.month, printLocale)} · {brigadesLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-3 py-2 text-sm text-white hover:bg-stone-800"
            onClick={onBack}
          >
            {t(printLocale, 'common.back')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            disabled={pdfBusy}
            onClick={() => void handlePdf()}
          >
            {t(printLocale, 'print.exportPdf')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100"
            onClick={handlePrint}
          >
            {t(printLocale, 'print.printBtn')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            onClick={onClose}
          >
            {t(printLocale, 'print.close')}
          </button>
        </div>
      </div>

      <div className="print-modal-body">
        <div
          ref={printRef}
          id="print-area"
          className="print-area"
        >
          {(variant === 'plan' || variant === 'both') && (
            <PrintSheetPage
              store={store}
              sheet={sheet}
              mode="plan"
              stats={stats}
              brigades={brigades}
              printLocale={printLocale}
              groupMode={groupMode}
              structuralUnitIds={structuralUnitIds}
              pageBreak={variant === 'both'}
            />
          )}
          {(variant === 'fact' || variant === 'both') && (
            <PrintSheetPage
              store={store}
              sheet={sheet}
              mode="fact"
              stats={stats}
              brigades={brigades}
              printLocale={printLocale}
              groupMode={groupMode}
              structuralUnitIds={structuralUnitIds}
              pageBreak={false}
            />
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

type PageProps = {
  store: AppStore
  sheet: MonthSheet
  mode: 'plan' | 'fact'
  stats: ReturnType<typeof monthStats>
  brigades: string[]
  printLocale: import('@/lib/types').Locale
  groupMode?: MonthGroupMode
  structuralUnitIds?: string[]
  pageBreak: boolean
}

function PrintSheetPage({
  store,
  sheet,
  mode,
  stats,
  brigades,
  printLocale,
  groupMode = 'brigade',
  structuralUnitIds,
  pageBreak,
}: PageProps) {
  const isPlan = mode === 'plan'
  const titleKey = isPlan ? 'print.planSheet' : 'print.factSheet'
  return (
    <article
      className={`print-sheet-page ${pageBreak ? 'print-page-break-after' : ''}`}
      data-print-mode={mode}
    >
      <div className="print-sheet-content">
        <PrintBrandWatermark />
        <PrintSheetHeader
          locale={printLocale}
          title={`${t(printLocale, titleKey)} — ${formatMonthTitle(sheet.month, printLocale)}`}
          site={store.settings.site}
          responsible={store.settings.responsible}
          brigades={brigades}
        >
          <div className="print-kpi-row">
            <PrintKpi label={t(printLocale, 'print.kpiPlanH')} value={stats.planHours} />
            <PrintKpi label={t(printLocale, 'print.kpiFactH')} value={stats.factHours} />
            <PrintKpi label={t(printLocale, 'print.kpiDev')} value={stats.deviation} />
            <PrintKpi label={t(printLocale, 'print.kpiShifts')} value={stats.factShifts} />
          </div>
          <PrintCodeLegend locale={printLocale} />
        </PrintSheetHeader>

        <PrintTimesheetTable
          store={store}
          sheet={sheet}
          mode={mode}
          brigades={brigades}
          printLocale={printLocale}
          groupMode={groupMode}
          structuralUnitIds={structuralUnitIds}
          showTotals
        />

        <footer className="print-sheet-footer print-signatures">
          <PrintSignatureBlock
            locale={printLocale}
            signatures={store.settings.signatures}
          />
          <span>{t(printLocale, 'print.date')}: _______________</span>
        </footer>
      </div>
    </article>
  )
}

function PrintKpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="print-kpi">
      <span className="print-kpi-label">{label}</span>
      <span className="print-kpi-value">{value}</span>
    </div>
  )
}

function PrintSignatureBlock({
  locale,
  signatures,
}: {
  locale: import('@/lib/types').Locale
  signatures?: import('@/lib/types').PrintSignatures
}) {
  const s = signatures ?? {}
  const rows = [
    { ru: s.masterRu, ka: s.masterKa, key: 'print.signMaster' },
    { ru: s.accountantRu, ka: s.accountantKa, key: 'print.signAccountant' },
    { ru: s.directorRu, ka: s.directorKa, key: 'print.signDirector' },
  ]
  return (
    <div className="print-signature-grid">
      {rows.map(({ ru, ka, key }) => (
        <div key={key} className="print-signature-line">
          <span className="print-signature-label">
            {t(locale, key)}: {locale === 'ka' ? ka || ru : ru || ka}
          </span>
          <span className="print-signature-blank">_________________________</span>
        </div>
      ))}
    </div>
  )
}
