import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope } from '@/hooks/useModalScope'
import { usePrintFit } from '@/hooks/usePrintFit'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { formatMonthNameCapitalized, formatMonthTitle } from '@/lib/dates'
import { surnameWithInitials, t, tf } from '@/i18n'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { formatPrintConfigCaption } from '@/lib/print/timesheetPrintPrefs'
import { monthStats } from '@/lib/stats'
import type { AppStore, Locale, MonthSheet } from '@/lib/types'
import type { MonthGroupMode } from '@/lib/monthViewOptions'
import { PrintBrandWatermark } from '@/components/brand/FiberCellBrand'
import { PrintSheetHeader } from '@/components/brand/PrintSheetHeader'
import { sheetFormCode } from '@/lib/printForms'
import { PrintBrigadeSummarySheet } from './PrintBrigadeSummarySheet'
import { PrintTimesheetLegend } from './PrintTimesheetLegend'
import { PrintTimesheetTable } from './PrintTimesheetTable'

export type PrintVariant = 'plan' | 'fact' | 'both' | 'summary'

export type PrintConfig = {
  variant: PrintVariant
  brigades: string[]
  fitOnePage: boolean
  /** Колонки/KPI часов план·факт на бланке. */
  showHours: boolean
  /**
   * Каждая бригада — отдельный лист A4 (табель не рвётся между страницами).
   * По умолчанию включено.
   */
  oneBrigadePerPage: boolean
  printLocale: Locale
  georgiaOfficialHeader?: boolean
  groupMode?: import('@/lib/monthViewOptions').MonthGroupMode
  structuralUnitIds?: string[]
  /** Печать от мастера цеха — упрощённая форма плана и одна подпись. */
  workshopMasterMode?: boolean
}

type Props = {
  store: AppStore
  sheet: MonthSheet
  config: PrintConfig
  onClose: () => void
  onBack: () => void
  /** ФИО того, кто печатает (для подписи на графике работ). */
  printerName?: string
}

export function PrintPreviewModal({
  store,
  sheet,
  config,
  onClose,
  onBack,
  printerName,
}: Props) {
  const { variant, brigades, printLocale, groupMode = 'brigade', structuralUnitIds } =
    config
  const workshopMasterMode = config.workshopMasterMode === true
  const showHours = config.showHours !== false
  const oneBrigadePerPage = config.oneBrigadePerPage !== false
  const georgiaOfficial =
    workshopMasterMode ? false : (config.georgiaOfficialHeader ?? printLocale === 'ka')
  const printRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })
  const [pdfBusy, setPdfBusy] = useState(false)

  /** Части печати: одна бригада на лист или все выбранные подряд. */
  const brigadeChunks = useMemo(
    () => (oneBrigadePerPage ? brigades.map((b) => [b]) : [brigades]),
    [brigades, oneBrigadePerPage],
  )

  const planChunks =
    variant === 'plan' || variant === 'both' ? brigadeChunks : []
  const factChunks =
    variant === 'fact' || variant === 'both' ? brigadeChunks : []
  const sheetPageCount = planChunks.length + factChunks.length

  const resolvedPrinterName = useMemo(() => {
    if (printerName?.trim()) return surnameWithInitials(printerName)
    const s = store.settings.signatures
    const fromSettings =
      printLocale === 'ka'
        ? s?.masterKa || s?.masterRu
        : s?.masterRu || s?.masterKa
    return surnameWithInitials(fromSettings)
  }, [printerName, printLocale, store.settings.signatures])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('print-preview-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('print-preview-open')
    }
  }, [onClose])

  const isPortrait = variant === 'summary'
  const { runFit } = usePrintFit(printRef, {
    enabled: config.fitOnePage,
    portrait: isPortrait,
    deps: [config, sheet, variant, brigades, isPortrait, oneBrigadePerPage],
  })

  function handlePrint() {
    runFit()
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      runFit()
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

  const configCaption = useMemo(
    () => formatPrintConfigCaption(config, (key) => t(printLocale, key)),
    [config, printLocale],
  )

  const content = (
    <div
      ref={panelRef}
      className="print-modal-root fixed inset-0 flex flex-col bg-stone-900/60"
      style={{ zIndex }}
    >
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t(printLocale, 'print.preview')}</h2>
          <p className="text-sm text-stone-400 capitalize">
            A4 · {formatMonthTitle(sheet.month, printLocale)} · {brigadesLabel}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">{configCaption}</p>
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
          className={`print-area${variant === 'summary' ? ' print-area--summary' : ''}`}
        >
          {variant === 'summary' ? (
            <PrintBrigadeSummarySheet
              store={store}
              sheet={sheet}
              brigades={brigades}
              printLocale={printLocale}
              georgiaOfficial={georgiaOfficial}
              showHours={showHours}
            />
          ) : null}
          {planChunks.map((chunk, i) => {
            const pageIndex = i + 1
            const pageBreak = pageIndex < sheetPageCount
            const pageLabel =
              sheetPageCount > 1 ? `${pageIndex}/${sheetPageCount}` : undefined
            return (
              <PrintSheetPage
                key={`plan-${chunk.join('|')}-${i}`}
                store={store}
                sheet={sheet}
                mode="plan"
                brigades={chunk}
                printLocale={printLocale}
                groupMode={groupMode}
                structuralUnitIds={structuralUnitIds}
                pageBreak={pageBreak}
                pageLabel={pageLabel}
                georgiaOfficial={georgiaOfficial}
                workshopMasterMode={workshopMasterMode}
                printerName={resolvedPrinterName}
                showHours={showHours}
              />
            )
          })}
          {factChunks.map((chunk, i) => {
            const pageIndex = planChunks.length + i + 1
            const pageBreak = pageIndex < sheetPageCount
            const pageLabel =
              sheetPageCount > 1 ? `${pageIndex}/${sheetPageCount}` : undefined
            return (
              <PrintSheetPage
                key={`fact-${chunk.join('|')}-${i}`}
                store={store}
                sheet={sheet}
                mode="fact"
                brigades={chunk}
                printLocale={printLocale}
                groupMode={groupMode}
                structuralUnitIds={structuralUnitIds}
                pageBreak={pageBreak}
                pageLabel={pageLabel}
                georgiaOfficial={georgiaOfficial}
                workshopMasterMode={workshopMasterMode}
                printerName={resolvedPrinterName}
                showHours={showHours}
              />
            )
          })}
        </div>
      </div>
    </div>
  )

  return createPortal(content, getModalPortalRoot())
}

type PageProps = {
  store: AppStore
  sheet: MonthSheet
  mode: 'plan' | 'fact'
  brigades: string[]
  printLocale: import('@/lib/types').Locale
  groupMode?: MonthGroupMode
  structuralUnitIds?: string[]
  pageBreak: boolean
  pageLabel?: string
  georgiaOfficial?: boolean
  workshopMasterMode?: boolean
  printerName?: string
  showHours?: boolean
}

function PrintSheetPage({
  store,
  sheet,
  mode,
  brigades,
  printLocale,
  groupMode = 'brigade',
  structuralUnitIds,
  pageBreak,
  pageLabel,
  georgiaOfficial = false,
  workshopMasterMode = false,
  printerName = '',
  showHours = true,
}: PageProps) {
  const isPlan = mode === 'plan'
  /** План печатается как «График работ» без KPI / кодов (итоги часов — по галочке). */
  const workSchedule = isPlan
  /** На графике — только подпись печатающего; у мастера цеха то же на факте. */
  const printerOnlySign = workSchedule || workshopMasterMode
  const monthCap = formatMonthNameCapitalized(sheet.month, printLocale)
  const title = workSchedule
    ? tf(printLocale, 'print.workScheduleTitle', { month: monthCap })
    : `${t(printLocale, 'print.factSheet')} — ${formatMonthTitle(sheet.month, printLocale)}`
  const stats = monthStats(sheet, store.employees, {
    brigades,
    structuralUnitIds,
  })

  return (
    <article
      className={[
        'print-sheet-page',
        pageBreak ? 'print-page-break-after' : '',
        workSchedule ? 'print-sheet-page--work-schedule' : '',
        printerOnlySign ? 'print-sheet-page--printer-sign' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-print-mode={mode}
    >
      <div className="print-sheet-content">
        {!workSchedule ? <PrintBrandWatermark /> : null}
        <PrintSheetHeader
          locale={printLocale}
          title={title}
          site={store.settings.site}
          responsible={
            workSchedule || printerOnlySign ? undefined : store.settings.responsible
          }
          brigades={workSchedule ? [] : brigades}
          formCode={
            georgiaOfficial || workSchedule ? undefined : sheetFormCode(mode)
          }
          pageLabel={workSchedule ? undefined : pageLabel}
          georgiaOfficial={georgiaOfficial && !workSchedule}
          store={store}
          monthKey={sheet.month}
          hideSheetOrg={workSchedule}
          titleOnly={workSchedule}
        >
          {!workSchedule ? (
            <>
              <div className="print-kpi-row">
                {showHours ? (
                  <>
                    <PrintKpi label={t(printLocale, 'print.kpiPlanH')} value={stats.planHours} />
                    <PrintKpi label={t(printLocale, 'print.kpiFactH')} value={stats.factHours} />
                    <PrintKpi label={t(printLocale, 'print.kpiDev')} value={stats.deviation} />
                  </>
                ) : null}
                <PrintKpi label={t(printLocale, 'print.kpiShifts')} value={stats.factShifts} />
              </div>
              <PrintTimesheetLegend locale={printLocale} georgiaOfficial={georgiaOfficial} />
            </>
          ) : null}
        </PrintSheetHeader>

        <PrintTimesheetTable
          store={store}
          sheet={sheet}
          mode={mode}
          brigades={brigades}
          printLocale={printLocale}
          groupMode={groupMode}
          structuralUnitIds={structuralUnitIds}
          showTotals={showHours}
        />

        <footer
          className={`print-sheet-footer print-signatures print-signatures--grid${
            printerOnlySign ? ' print-signatures--printer-only' : ''
          }`}
        >
          <PrintSignatureBlock
            locale={printLocale}
            signatures={store.settings.signatures}
            georgiaOfficial={georgiaOfficial && !printerOnlySign}
            responsible={store.settings.responsible}
            printerOnly={printerOnlySign}
            printerName={printerName}
            workshopMaster={workshopMasterMode}
          />
          {!printerOnlySign ? (
            <span className="print-footer-date">
              {t(printLocale, 'print.date')}: _______________
            </span>
          ) : null}
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
  georgiaOfficial = false,
  responsible,
  printerOnly = false,
  printerName = '',
  workshopMaster = false,
}: {
  locale: import('@/lib/types').Locale
  signatures?: import('@/lib/types').PrintSignatures
  georgiaOfficial?: boolean
  responsible?: string
  printerOnly?: boolean
  printerName?: string
  workshopMaster?: boolean
}) {
  const s = signatures ?? {}

  if (printerOnly) {
    const fromSettings =
      locale === 'ka' ? s.masterKa || s.masterRu : s.masterRu || s.masterKa
    const name = printerName || surnameWithInitials(fromSettings)
    const roleKey = workshopMaster ? 'print.signMasterShop' : 'print.signPrinter'
    return (
      <div className="print-sig-card print-sig-card--printer">
        <span className="print-sig-role">{t(locale, roleKey)}</span>
        <span className="print-sig-line" />
        <span className="print-sig-name">{name}</span>
      </div>
    )
  }

  if (georgiaOfficial) {
    const directorName =
      locale === 'ka' ? s.directorKa || s.directorRu : s.directorRu || s.directorKa
    return (
      <>
        <div className="print-sig-card">
          <span className="print-sig-role">{t(locale, 'print.ge.signResponsible')}</span>
          <span className="print-sig-line" />
          <span className="print-sig-name">{responsible || ''}</span>
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

  const rows = [
    { ru: s.masterRu, ka: s.masterKa, key: 'print.signMaster' },
    { ru: s.accountantRu, ka: s.accountantKa, key: 'print.signAccountant' },
    { ru: s.directorRu, ka: s.directorKa, key: 'print.signDirector' },
  ]
  return (
    <>
      {rows.map(({ ru, ka, key }) => (
        <div key={key} className="print-sig-card">
          <span className="print-sig-role">{t(locale, key)}</span>
          <span className="print-sig-line" />
          <span className="print-sig-name">
            {locale === 'ka' ? ka || ru : ru || ka}
          </span>
        </div>
      ))}
    </>
  )
}
