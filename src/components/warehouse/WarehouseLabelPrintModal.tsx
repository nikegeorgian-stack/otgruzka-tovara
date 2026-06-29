import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FormNotice } from '@/components/ui/FormNotice'
import { WarehouseLabelPrintSheet } from '@/components/warehouse/WarehouseLabelPrintSheet'
import { useI18n } from '@/context/I18nContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import {
  buildLabelModels,
  expandLabelCopies,
  type LabelModel,
  type LabelPrintOptions,
} from '@/lib/warehouse/labelCodes'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  items: WarehouseItem[]
  preselectedIds?: string[]
  site?: string
  onUpsertItem: (item: WarehouseItem) => void
  onClose: () => void
}

export function WarehouseLabelPrintModal({
  warehouse,
  items,
  preselectedIds,
  site,
  onUpsertItem,
  onClose,
}: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)

  const categoryNames = useMemo(
    () => new Map(warehouse.categories.map((c) => [c.id, c.name])),
    [warehouse.categories],
  )
  const locationNames = useMemo(
    () => new Map(warehouse.locations.map((l) => [l.id, l.name])),
    [warehouse.locations],
  )

  const activeItems = useMemo(() => items.filter((i) => i.active), [items])

  const [step, setStep] = useState<'setup' | 'preview'>('setup')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectedIds?.length ? preselectedIds : []),
  )
  const [includeQr, setIncludeQr] = useState(true)
  const [includeBarcode, setIncludeBarcode] = useState(true)
  const [generateBarcodeIfMissing, setGenerateBarcodeIfMissing] = useState(true)
  const [copies, setCopies] = useState(1)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [labels, setLabels] = useState<LabelModel[]>([])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return activeItems
    return activeItems.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.internalCode.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.barcode?.toLowerCase().includes(q),
    )
  }, [activeItems, filter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (step !== 'preview') return
    document.body.classList.add('print-preview-open', 'print-labels')
    return () => {
      document.body.classList.remove('print-preview-open', 'print-labels')
    }
  }, [step])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const i of filtered) next.add(i.id)
      return next
    })
  }

  async function buildPreview() {
    if (!selected.size) {
      setError(t('warehouse.labels.errNoSelection'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const opts: LabelPrintOptions = {
        includeQr,
        includeBarcode,
        generateBarcodeIfMissing: includeBarcode && generateBarcodeIfMissing,
      }
      const picked = activeItems.filter((i) => selected.has(i.id))
      const models = await buildLabelModels(picked, categoryNames, locationNames, opts, site)

      for (const model of models) {
        if (model.patch) {
          onUpsertItem({ ...model.item, ...model.patch })
        }
      }

      setLabels(expandLabelCopies(models, copies))
      setStep('preview')
    } catch {
      setError(t('warehouse.labels.errBuild'))
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
      await exportPrintAreaToPdf(printRef.current, `labels_${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  const setup = (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm bg-white shadow-sm">
        <div className="border-b border-grid px-6 py-4">
          <h2 className="text-lg font-bold text-ink">{t('warehouse.labels.title')}</h2>
          <p className="mt-1 text-sm text-stone-500">{t('warehouse.labels.hint')}</p>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}

          <div className="rounded-sm border border-teal-200 bg-teal-50/50 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-800">
              {t('warehouse.labels.options')}
            </p>
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeQr}
                onChange={(e) => setIncludeQr(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t('warehouse.labels.withQr')}</span>
                <span className="mt-0.5 block text-xs text-stone-500">{t('warehouse.labels.withQrHint')}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeBarcode}
                onChange={(e) => setIncludeBarcode(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t('warehouse.labels.withBarcode')}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {t('warehouse.labels.withBarcodeHint')}
                </span>
              </span>
            </label>
            {includeBarcode && (
              <label className="ml-6 flex items-start gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={generateBarcodeIfMissing}
                  onChange={(e) => setGenerateBarcodeIfMissing(e.target.checked)}
                />
                <span>
                  <span className="font-medium">{t('warehouse.labels.genBarcode')}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {t('warehouse.labels.genBarcodeHint')}
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <span className="font-medium">{t('warehouse.labels.copies')}</span>
              <input
                type="number"
                min={1}
                max={99}
                className="w-20 rounded-sm border border-grid px-2 py-1.5 text-sm"
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value) || 1)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-[12rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('warehouse.search')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-2 text-sm hover:bg-stone-50"
              onClick={selectAllVisible}
            >
              {t('warehouse.labels.selectVisible')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-2 text-sm hover:bg-stone-50"
              onClick={() => setSelected(new Set())}
            >
              {t('warehouse.labels.clearSelection')}
            </button>
          </div>

          <p className="text-xs text-stone-500">
            {t('warehouse.labels.selectedCount').replace('{n}', String(selected.size))}
          </p>

          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-sm border border-grid p-2">
            {filtered.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="font-mono text-[11px] text-teal-700">{item.internalCode}</span>
                  </span>
                  {item.barcode ? (
                    <span className="text-[10px] text-stone-400">{item.barcode}</span>
                  ) : (
                    <span className="text-[10px] text-amber-600">{t('warehouse.labels.noBarcode')}</span>
                  )}
                </label>
              </li>
            ))}
            {!filtered.length && (
              <li className="px-2 py-6 text-center text-sm text-stone-400">{t('warehouse.emptyFilter')}</li>
            )}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-grid px-6 py-4">
          <button type="button" className="rounded-sm border border-grid px-4 py-2 text-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            disabled={busy || !selected.size}
            onClick={() => void buildPreview()}
          >
            {busy ? t('warehouse.labels.building') : t('warehouse.labels.preview')}
          </button>
        </div>
      </div>
    </div>
  )

  const preview = (
    <div className="print-modal-root fixed inset-0 z-[110] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <div>
          <h2 className="text-lg font-bold">{t('warehouse.labels.previewTitle')}</h2>
          <p className="text-sm text-stone-400">
            {t('warehouse.labels.previewMeta').replace('{n}', String(labels.length))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            onClick={() => setStep('setup')}
          >
            {t('warehouse.labels.back')}
          </button>
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
        <div ref={printRef} id="print-area" className="print-area print-area--labels">
          <WarehouseLabelPrintSheet labels={labels} />
        </div>
      </div>
    </div>
  )

  return createPortal(step === 'setup' ? setup : preview, document.body)
}
