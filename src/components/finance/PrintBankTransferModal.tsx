import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope } from '@/hooks/useModalScope'
import { usePrintFit } from '@/hooks/usePrintFit'
import { formatMonthTitle } from '@/lib/dates'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { t } from '@/i18n'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import type { StatementRow } from '@/lib/finance/calc'
import type { AppStore, Locale } from '@/lib/types'
import { PrintBankTransferSheet } from './PrintBankTransferSheet'

type Props = {
  store: AppStore
  month: string
  rows: StatementRow[]
  printLocale: Locale
  onClose: () => void
}

export function PrintBankTransferModal({
  store,
  month,
  rows,
  printLocale,
  onClose,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })

  const { runFit } = usePrintFit(printRef, {
    portrait: true,
    shrinkOnly: true,
    deps: [month, rows, printLocale],
  })

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
        `bank-transfer-${month}.pdf`,
        { pageSelector: '.print-bank-transfer-page', orientation: 'portrait' },
      )
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
          <h2 className="text-lg font-bold">{t(printLocale, 'fin.printBankTransfer')}</h2>
          <p className="text-sm text-stone-400">
            A4 · {formatMonthTitle(month, printLocale)} · {rows.length}{' '}
            {t(printLocale, 'print.employeesInSheet')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        <div ref={printRef} id="print-area" className="print-area print-area--bank-transfer">
          <PrintBankTransferSheet
            store={store}
            month={month}
            rows={rows}
            printLocale={printLocale}
          />
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
