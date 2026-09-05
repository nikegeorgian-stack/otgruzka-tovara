import { useEffect, useRef, useState, type ReactNode } from 'react'
import { G5PurchaseOrderPrintSheet } from '@/components/print/G5PurchaseOrderPrintSheet'
import { G5ReceiptPrintSheet } from '@/components/print/G5ReceiptPrintSheet'
import { G5ReversalPrintSheet } from '@/components/print/G5ReversalPrintSheet'
import { G5SalesOrderPrintSheet } from '@/components/print/G5SalesOrderPrintSheet'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { useI18n } from '@/context/I18nContext'
import { usePrintFit } from '@/hooks/usePrintFit'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import type { G5PurchaseOrderPrintModel } from '@/lib/print/g5PurchaseOrderPrint'
import type { G5ReceiptPrintModel } from '@/lib/print/g5ReceiptPrint'
import type { G5ReversalPrintModel } from '@/lib/print/g5ReversalPrint'
import type { G5SalesOrderPrintModel } from '@/lib/print/g5SalesOrderPrint'

export type G5DocumentPrintModel =
  | G5SalesOrderPrintModel
  | G5PurchaseOrderPrintModel
  | G5ReceiptPrintModel
  | G5ReversalPrintModel

type Props = {
  model: G5DocumentPrintModel
  onClose: () => void
  showCommercial?: boolean
}

function sheetFor(
  model: G5DocumentPrintModel,
  showCommercial?: boolean,
): ReactNode {
  switch (model.kind) {
    case 'sales_order':
      return <G5SalesOrderPrintSheet model={model} showCommercial={showCommercial} />
    case 'purchase_order':
      return <G5PurchaseOrderPrintSheet model={model} showCommercial={showCommercial} />
    case 'receipt':
      return <G5ReceiptPrintSheet model={model} showCommercial={showCommercial} />
    case 'reversal':
      return <G5ReversalPrintSheet model={model} showCommercial={showCommercial} />
    default:
      return null
  }
}

function subtitleFor(model: G5DocumentPrintModel, t: (k: string) => string): string {
  switch (model.kind) {
    case 'sales_order':
      return t('g5.print.salesOrder.title')
    case 'purchase_order':
      return t('g5.print.purchaseOrder.title')
    case 'receipt':
      return t('g5.print.receipt.title')
    case 'reversal':
      return t('g5.print.reversal.title')
    default:
      return ''
  }
}

/** Thin preview wrapper around PrintModalShell for G5.2 document sheets. */
export function G5DocumentPrintModal({ model, onClose, showCommercial }: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { runFit } = usePrintFit(printRef, {
    portrait: true,
    shrinkOnly: true,
    deps: [model, showCommercial],
  })

  useEffect(() => {
    document.body.classList.add('print-preview-open')
    return () => {
      document.body.classList.remove('print-preview-open')
    }
  }, [])

  function handlePrint() {
    runFit()
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      runFit()
      const safeNo = model.docNumber.replace(/[^\w.-]+/g, '_')
      await exportPrintAreaToPdf(printRef.current, `g5_${model.kind}_${safeNo}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <PrintModalShell open onClose={onClose}>
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t('print.preview')}</h2>
          <p className="text-sm text-stone-400">
            {subtitleFor(model, t)} · № {model.docNumber}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            disabled={pdfBusy}
            onClick={() => void handlePdf()}
          >
            {t('print.exportPdf')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100"
            onClick={handlePrint}
          >
            {t('print.printBtn')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            onClick={onClose}
          >
            {t('print.close')}
          </button>
        </div>
      </div>

      <div className="print-modal-body">
        <div ref={printRef} id="print-area" className="print-area print-area--portrait">
          {sheetFor(model, showCommercial)}
        </div>
      </div>
    </PrintModalShell>
  )
}
