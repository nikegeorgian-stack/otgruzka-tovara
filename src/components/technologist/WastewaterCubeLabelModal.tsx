import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { WastewaterCubeLabelSheet } from '@/components/technologist/WastewaterCubeLabelSheet'
import { useI18n } from '@/context/I18nContext'
import {
  buildWastewaterCubeLabelModel,
  DEFAULT_WW_LABEL_FIELDS,
  type WastewaterCubeLabelModel,
  type WastewaterLabelFieldOpts,
} from '@/lib/wastewater/cubeLabel'
import type { WastewaterCube } from '@/lib/wastewater/types'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'

type Props = {
  cube: WastewaterCube
  site?: string
  onClose: () => void
}

type FieldKey = keyof WastewaterLabelFieldOpts

const FIELD_KEYS: FieldKey[] = [
  'includeQr',
  'includeNumber',
  'includeInternalCode',
  'includeWasteType',
  'includeColor',
  'includeStatus',
  'includeLocation',
  'includeMass',
  'includeFillDates',
]

export function WastewaterCubeLabelModal({ cube, site, onClose }: Props) {
  const { t, locale } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<'setup' | 'preview'>('setup')
  const [fields, setFields] = useState<WastewaterLabelFieldOpts>({
    ...DEFAULT_WW_LABEL_FIELDS,
  })
  const [labels, setLabels] = useState<WastewaterCubeLabelModel[]>([])
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    if (step !== 'preview') return
    document.body.classList.add('print-preview-open', 'print-cube-labels')
    return () => {
      document.body.classList.remove('print-preview-open', 'print-cube-labels')
    }
  }, [step])

  function toggleField(key: FieldKey) {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function buildPreview() {
    setBusy(true)
    try {
      const statusLabel = t(`wastewater.status.${cube.status}`)
      const model = await buildWastewaterCubeLabelModel(cube, fields, statusLabel, site)
      setLabels([model])
      setStep('preview')
    } finally {
      setBusy(false)
    }
  }

  function handlePrint() {
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      await exportPrintAreaToPdf(
        printRef.current,
        `ww_cube_${cube.internalCode || cube.cubeNumber}.pdf`,
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
            <h2 className="text-lg font-bold text-ink">{t('wastewater.labelTitle')}</h2>
            <p className="text-sm text-stone-500">
              {cube.internalCode} · №{cube.cubeNumber}
              {cube.wasteType ? ` · ${cube.wasteType}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 'preview' ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setStep('setup')}>
                  {t('warehouse.labels.back')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handlePrint}>
                  {t('common.print')}
                </Button>
                <Button variant="primary" size="sm" disabled={pdfBusy} onClick={() => void handlePdf()}>
                  PDF
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void buildPreview()}>
                  {t('warehouse.labels.preview')}
                </Button>
              </>
            )}
          </div>
        </div>

        {step === 'setup' ? (
          <div className="overflow-auto p-4 print:hidden">
            <p className="mb-3 text-sm text-stone-600">{t('wastewater.labelFieldsHint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIELD_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={fields[key]}
                    onChange={() => toggleField(key)}
                  />
                  {t(`wastewater.labelField.${key}`)}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div ref={printRef} className="print-area--cube-labels min-h-0 flex-1 overflow-auto p-4">
            <WastewaterCubeLabelSheet labels={labels} locale={locale} />
          </div>
        )}
      </div>
    </PrintModalShell>
  )
}
