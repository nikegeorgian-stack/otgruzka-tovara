import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WarehouseIssuePrintSheet } from '@/components/warehouse/WarehouseIssuePrintSheet'
import { useI18n } from '@/context/I18nContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import type { IssuePrintModel } from '@/lib/warehouse/printDocument'

type Props = {
  model: IssuePrintModel
  onClose: () => void
}

export function WarehouseIssuePrintPreview({ model, onClose }: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('print-preview-open', 'print-receipt')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('print-preview-open', 'print-receipt')
    }
  }, [onClose])

  function handlePrint() {
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      const safeNo = model.number.replace(/[^\w.-]+/g, '_')
      await exportPrintAreaToPdf(
        printRef.current,
        `rashod_${safeNo}_${model.dateFormatted.replace(/\./g, '-')}.pdf`,
      )
    } finally {
      setPdfBusy(false)
    }
  }

  const content = (
    <div className="print-modal-root fixed inset-0 z-[110] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t('print.preview')}</h2>
          <p className="text-sm text-stone-400">
            {t('warehouse.print.issueTitle')} · № {model.number} · {model.dateFormatted}
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
          <WarehouseIssuePrintSheet model={model} />
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
