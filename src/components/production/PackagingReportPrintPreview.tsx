import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/context/I18nContext'
import { usePrintFit } from '@/hooks/usePrintFit'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { PackagingReportPrintSheet } from '@/components/production/PackagingReportPrintSheet'
import type { PackagingReportPrintModel } from '@/lib/production/packagingReportPrint'

type Props = {
  model: PackagingReportPrintModel
  onClose: () => void
}

export function PackagingReportPrintPreview({ model, onClose }: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { runFit } = usePrintFit(printRef, {
    shrinkOnly: true,
    deps: [model],
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
      await exportPrintAreaToPdf(printRef.current, `upakovka_${model.number}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  return createPortal(
    <div className="print-modal-root fixed inset-0 z-[420] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t('print.preview')}</h2>
          <p className="text-sm text-stone-400">
            {model.number} · {model.shiftDate} · {model.batchNo}
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
        <div ref={printRef} id="print-area" className="print-area">
          <PackagingReportPrintSheet model={model} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
