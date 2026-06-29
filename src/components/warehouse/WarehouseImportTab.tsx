import { useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  isWarehouseImportError,
  type ImportResult,
} from '@/lib/warehouse/importExport'
import type { WarehouseLocation } from '@/lib/warehouse/types'
import type { WarehousePageProps } from './warehouseTypes'

type Props = Pick<WarehousePageProps, 'onImportExcel'> & {
  warehouseId: string
  locations: WarehouseLocation[]
  onWarehouseChange: (id: string) => void
}

type Notice = { type: 'error' | 'success' | 'info'; message: string; warnings?: string[] }

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xls')
}

export function WarehouseImportTab({
  onImportExcel,
  warehouseId,
  locations,
  onWarehouseChange,
}: Props) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  async function onFile(file: File) {
    setNotice(null)

    if (!warehouseId) {
      setNotice({ type: 'error', message: t('warehouse.import.noWarehouse') })
      return
    }

    if (!isExcelFile(file)) {
      setNotice({ type: 'error', message: t('warehouse.import.invalidFile') })
      return
    }

    if (!(await confirm({ message: t('warehouse.import.confirm') }))) {
      return
    }

    setBusy(true)
    try {
      const result = await onImportExcel(file, warehouseId)
      showResult(result)
    } catch (err) {
      if (isWarehouseImportError(err)) {
        const key =
          err.code === 'emptyWorkbook'
            ? 'warehouse.import.emptyWorkbook'
            : err.code === 'noData'
              ? 'warehouse.import.noData'
              : 'warehouse.import.parseError'
        setNotice({ type: 'error', message: t(key) })
      } else {
        setNotice({ type: 'error', message: t('warehouse.import.parseError') })
      }
    } finally {
      setBusy(false)
    }
  }

  function showResult(result: ImportResult) {
    const message = tf('warehouse.import.success', {
      ops: result.movementsAdded,
      items: result.itemsMatched,
      sheets: result.sheetsProcessed,
    })
    if (result.warnings.length > 0) {
      setNotice({
        type: result.movementsAdded > 0 ? 'info' : 'error',
        message,
        warnings: result.warnings,
      })
    } else {
      setNotice({ type: 'success', message })
    }
  }

  const selectedLocation = locations.find((l) => l.id === warehouseId)

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-sm border border-grid bg-white p-6 shadow-sm">
        <h3 className="font-bold text-ink">{t('warehouse.import.title')}</h3>
        <p className="mt-2 text-sm text-stone-500">{t('warehouse.import.hint')}</p>

        <label className="mt-4 block text-xs font-semibold text-stone-500">
          {t('warehouse.location')} *
          <select
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={warehouseId}
            onChange={(e) => onWarehouseChange(e.target.value)}
          >
            <option value="">{t('warehouse.import.selectWarehouse')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {selectedLocation && (
          <p className="mt-1 text-xs text-stone-400">
            {tf('warehouse.import.targetWarehouse', { name: selectedLocation.name })}
          </p>
        )}

        <input
          ref={ref}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={busy || !warehouseId}
          className="mt-4 rounded-sm bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => ref.current?.click()}
          title={!warehouseId ? t('warehouse.import.noWarehouse') : undefined}
        >
          {busy ? t('warehouse.import.busy') : t('warehouse.import.select')}
        </button>
      </div>

      {notice && (
        <div className="space-y-2">
          <FormNotice
            type={notice.type}
            message={notice.message}
            onDismiss={() => setNotice(null)}
          />
          {notice.warnings && notice.warnings.length > 0 && (
            <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                {t('warehouse.import.warningsTitle')} ({notice.warnings.length})
              </p>
              <ul className="mt-2 max-h-40 overflow-auto text-xs">
                {notice.warnings.map((w) => (
                  <li key={w} className="border-t border-amber-100 py-1 first:border-0">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
