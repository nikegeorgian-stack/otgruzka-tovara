import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { FormulationCubeLabelSheet } from '@/components/technologist/FormulationCubeLabelSheet'
import { useI18n } from '@/context/I18nContext'
import { buildCubeLabelModel, type CubeLabelModel } from '@/lib/formulations/cubeLabel'
import type { FormulationBatchRun } from '@/lib/formulations/types'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'

type Props = {
  run: FormulationBatchRun
  site?: string
  warehouseName?: string
  labelText?: string
  onClose: () => void
}

export function FormulationCubeLabelModal({
  run,
  site,
  warehouseName,
  labelText,
  onClose,
}: Props) {
  const { t, locale } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [labels, setLabels] = useState<CubeLabelModel[]>([])
  const [ready, setReady] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void buildCubeLabelModel(run, {
      locale,
      site,
      warehouseName,
      labelText,
      includeQr: true,
    }).then((model) => {
      if (!cancelled) {
        setLabels([model])
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [run, locale, site, warehouseName, labelText])

  useEffect(() => {
    if (!ready) return
    document.body.classList.add('print-preview-open', 'print-cube-labels')
    return () => {
      document.body.classList.remove('print-preview-open', 'print-cube-labels')
    }
  }, [ready])

  function handlePrint() {
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      await exportPrintAreaToPdf(
        printRef.current,
        `cube_${run.documentNumber}.pdf`,
        { pageSelector: '.cube-label', orientation: 'portrait' },
      )
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <PrintModalShell open onClose={onClose} zIndex={110}>
      <div className="flex min-h-0 flex-1 flex-col bg-stone-100">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-300 bg-white px-4 py-3 print:hidden">
          <div>
            <h2 className="text-lg font-bold text-ink">{t('technologist.labelTitle')}</h2>
            <p className="text-sm text-stone-500">{run.documentNumber}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button variant="secondary" disabled={!ready || pdfBusy} onClick={() => void handlePdf()}>
              {t('print.exportPdf')}
            </Button>
            <Button variant="primary" disabled={!ready} onClick={handlePrint}>
              {t('print.printBtn')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 print:p-0">
          <div ref={printRef} className="print-area print-area--cube-labels mx-auto">
            {ready ? (
              <FormulationCubeLabelSheet labels={labels} locale={locale} />
            ) : (
              <p className="text-center text-sm text-stone-500 print:hidden">
                {t('hr.cec.loading')}
              </p>
            )}
          </div>
        </div>
      </div>
    </PrintModalShell>
  )
}
