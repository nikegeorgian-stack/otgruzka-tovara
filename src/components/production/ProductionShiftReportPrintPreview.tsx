import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProductionShiftReportPrintSheet } from '@/components/production/ProductionShiftReportPrintSheet'
import { useI18n } from '@/context/I18nContext'
import { usePrintFit } from '@/hooks/usePrintFit'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import type { ShiftReportPrintModel } from '@/lib/production/shiftReportPrint'

type Props = {
  model: ShiftReportPrintModel
  onClose: () => void
}

export function ProductionShiftReportPrintPreview({ model, onClose }: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { runFit } = usePrintFit(printRef, { shrinkOnly: true, deps: [model] })

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

  const labels = {
    title: t('production.shift.printTitle'),
    correction: t('production.shift.printCorrection'),
    corrects: t('production.shift.printCorrects'),
    order: t('production.shift.order'),
    line: t('production.line'),
    shift: t('production.shift.shift'),
    master: t('production.shift.master'),
    recipe: t('production.shift.printRecipe'),
    materials: t('production.shift.printMaterials'),
    norm: t('production.shift.norm'),
    fact: t('production.shift.fact'),
    deviation: t('production.shift.deviation'),
    reason: t('production.shift.deviationReason'),
    waste: t('production.shift.waste'),
    output: t('production.shift.outputM2'),
    rolls: t('production.shift.rolls'),
    docs: t('production.shift.printDocs'),
    eSign: t('production.shift.printESign'),
    manualSign: t('production.shift.printManualSign'),
    date: t('production.date'),
  }

  function handlePrint() {
    runFit()
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      runFit()
      await exportPrintAreaToPdf(printRef.current, `shift_${model.number}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  const content = (
    <div className="print-modal-root fixed inset-0 z-[420] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t('print.preview')}</h2>
          <p className="text-sm text-stone-400">
            {model.number} · {model.shiftDate}
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
            className="rounded-sm bg-white px-4 py-2 text-sm font-semibold text-stone-900"
            onClick={handlePrint}
          >
            {t('print.print')}
          </button>
          <button
            type="button"
            className="rounded-sm px-3 py-2 text-sm text-stone-300 hover:text-white"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-stone-200 p-4">
        <div ref={printRef} className="print-area mx-auto">
          <ProductionShiftReportPrintSheet model={model} labels={labels} />
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
