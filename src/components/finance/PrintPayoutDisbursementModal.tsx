import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope } from '@/hooks/useModalScope'
import { usePrintFit } from '@/hooks/usePrintFit'
import { DisbursementPrintFilters } from '@/components/finance/DisbursementPrintFilters'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { t } from '@/i18n'
import {
  defaultPrintFilter,
  resolvePrintRows,
  type DisbursementPrintFilterState,
} from '@/lib/finance/disbursementPrintFilter'
import { resolvePayoutDocumentLines } from '@/lib/finance/payoutDocuments'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import type { FinancePayoutDocument } from '@/lib/finance/types'
import type { AppStore, Locale } from '@/lib/types'
import { PrintPayoutDisbursementSheet } from './PrintPayoutDisbursementSheet'

type Props = {
  store: AppStore
  document: FinancePayoutDocument
  printLocale: Locale
  onClose: () => void
}

export function PrintPayoutDisbursementModal({
  store,
  document,
  printLocale,
  onClose,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [filter, setFilter] = useState<DisbursementPrintFilterState>(defaultPrintFilter)
  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })

  const allRows = useMemo(
    () =>
      resolvePayoutDocumentLines(store, document).map((r) => ({
        lineId: r.line.id,
        employeeId: r.line.employeeId,
        emp: r.emp,
        employeeName: r.employeeName,
        amount: r.line.amount,
      })),
    [store, document],
  )

  const printRows = useMemo(() => resolvePrintRows(allRows, filter), [allRows, filter])

  const filterCaption = useMemo(() => {
    const parts: string[] = []
    if (filter.unitIds.length) parts.push(t(printLocale, 'fin.printFilter.partialUnits'))
    if (filter.brigades.length) parts.push(t(printLocale, 'fin.printFilter.partialBrigades'))
    if (filter.selectedLineIds != null && printRows.length < allRows.length) {
      parts.push(t(printLocale, 'fin.printFilter.partialPeople'))
    }
    return parts.join(' · ')
  }, [filter, printRows.length, allRows.length, printLocale])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    globalThis.document.body.classList.add('print-preview-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      globalThis.document.body.classList.remove('print-preview-open')
    }
  }, [onClose])

  const { runFit } = usePrintFit(printRef, {
    portrait: true,
    shrinkOnly: true,
    enabled: printRows.length > 0,
    deps: [document, printRows, printLocale],
  })

  async function handlePdf() {
    if (!printRef.current || printRows.length === 0) return
    setPdfBusy(true)
    try {
      runFit()
      await exportPrintAreaToPdf(printRef.current, `${document.number}.pdf`, {
        pageSelector: '.print-advance-doc-page',
        orientation: 'portrait',
      })
    } finally {
      setPdfBusy(false)
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      className="print-modal-root fixed inset-0 flex flex-col bg-stone-900/60"
      style={{ zIndex }}
    >
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t(printLocale, 'fin.payDoc.print')}</h2>
          <p className="text-sm text-stone-400">{document.number}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            disabled={pdfBusy || printRows.length === 0}
            onClick={() => void handlePdf()}
          >
            {t(printLocale, 'print.exportPdf')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50"
            disabled={printRows.length === 0}
            onClick={() => {
              runFit()
              requestAnimationFrame(() => window.print())
            }}
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

      <DisbursementPrintFilters
        rows={allRows}
        units={store.hrStructuralUnits ?? []}
        filter={filter}
        onChange={setFilter}
      />

      <div className="print-modal-body">
        <div ref={printRef} className="print-area print-area--bank-transfer">
          {printRows.length > 0 ? (
            <PrintPayoutDisbursementSheet
              store={store}
              document={document}
              printLocale={printLocale}
              printRows={printRows}
              filterCaption={filterCaption || undefined}
            />
          ) : (
            <p className="p-8 text-center text-sm text-stone-300">
              {t(printLocale, 'fin.printFilter.empty')}
            </p>
          )}
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
