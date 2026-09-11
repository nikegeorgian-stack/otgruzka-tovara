import { useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { AppUser } from '@/lib/access/types'
import { PRODUCTION_LINES } from '@/lib/production/types'
import {
  canConfigureProductionLineBindings,
  exactProductionLineBinding,
  prepareProductionLineBindingCommand,
  productionLineBindingErrorKey,
  productionLineBindingOptions,
  type ProductionLineBindingSaveResult,
  type ProductionLineBindingSettingsWarehouse,
} from '@/lib/warehouse/productionLineBindingSettings'
import type { ProductionLineLocationBinding } from '@/lib/warehouse/types'

type Props = {
  warehouse: ProductionLineBindingSettingsWarehouse
  currentUser: AppUser | null
  allowStagingConfiguration: boolean
  onUpsert: (
    binding: Omit<ProductionLineLocationBinding, 'id'> & { id?: string },
  ) => ProductionLineBindingSaveResult | Promise<ProductionLineBindingSaveResult>
}

export function ProductionLineBindingSettingsPanel({
  warehouse,
  currentUser,
  allowStagingConfiguration,
  onUpsert,
}: Props) {
  const { t, tf } = useI18n()
  const initialLineId = PRODUCTION_LINES[0]?.id ?? ''
  const initialBinding = exactProductionLineBinding(warehouse, initialLineId)
  const [lineId, setLineId] = useState<string>(initialLineId)
  const [productionWarehouseId, setProductionWarehouseId] = useState(
    initialBinding?.productionWarehouseId ?? '',
  )
  const [productionLocationId, setProductionLocationId] = useState(
    initialBinding?.productionLocationId ?? '',
  )
  const [note, setNote] = useState(initialBinding?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{
    type: 'error' | 'success' | 'info'
    message: string
  } | null>(null)

  if (!canConfigureProductionLineBindings(allowStagingConfiguration, currentUser)) {
    return null
  }

  const { productionWarehouses, productionLocations } =
    productionLineBindingOptions(warehouse)

  function selectLine(nextLineId: string) {
    const binding = exactProductionLineBinding(warehouse, nextLineId)
    setLineId(nextLineId)
    setProductionWarehouseId(binding?.productionWarehouseId ?? '')
    setProductionLocationId(binding?.productionLocationId ?? '')
    setNote(binding?.note ?? '')
    setNotice(null)
  }

  function errorMessage(error: string) {
    return `${t(productionLineBindingErrorKey(error))} (${error})`
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setNotice(null)
    const prepared = prepareProductionLineBindingCommand(warehouse, {
      lineId,
      productionWarehouseId,
      productionLocationId,
      note,
    })
    if (!prepared.ok) {
      setNotice({ type: 'error', message: errorMessage(prepared.error) })
      return
    }
    setSaving(true)
    try {
      const result = await onUpsert(prepared.command)
      if (!result.ok || !result.binding) {
        const error =
          result.error ||
          (!result.binding
            ? 'production_line_binding_config_ack_mismatch'
            : 'production_line_binding_config_unknown_error')
        setNotice({ type: 'error', message: errorMessage(error) })
        return
      }
      setProductionWarehouseId(result.binding.productionWarehouseId)
      setProductionLocationId(result.binding.productionLocationId)
      setNote(result.binding.note ?? '')
      setNotice({
        type: 'success',
        message: result.criticalRevision
          ? tf('settings.lineBinding.savedRevision', {
              revision: result.criticalRevision,
            })
          : t('settings.lineBinding.saved'),
      })
    } catch (error) {
      const code = error instanceof Error && error.message ? error.message : 'network'
      setNotice({ type: 'error', message: errorMessage(code) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="rounded-sm border border-amber-300 bg-amber-50/40 p-5 shadow-sm"
      data-testid="staging-production-line-binding-settings"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink">{t('settings.lineBinding.title')}</h2>
          <p className="mt-1 text-xs text-stone-600">{t('settings.lineBinding.hint')}</p>
        </div>
        <span className="rounded-sm bg-amber-200 px-2 py-1 text-[10px] font-bold uppercase text-amber-900">
          {t('settings.lineBinding.stagingBadge')}
        </span>
      </div>

      {notice ? (
        <div className="mt-3">
          <FormNotice type={notice.type} message={notice.message} />
        </div>
      ) : null}

      <form className="mt-4 grid gap-3 lg:grid-cols-2" onSubmit={save}>
        <label className="block text-xs font-medium text-stone-600">
          {t('settings.lineBinding.line')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={lineId}
            onChange={(event) => selectLine(event.target.value)}
            data-testid="line-binding-line-id"
          >
            {PRODUCTION_LINES.map((line) => (
              <option key={line.id} value={line.id}>
                {t(`settings.lineBinding.line.${line.id}`)} · ID: {line.id}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-600">
          {t('settings.lineBinding.warehouse')}
          <select
            required
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={productionWarehouseId}
            onChange={(event) => setProductionWarehouseId(event.target.value)}
            data-testid="line-binding-warehouse-id"
          >
            <option value="">{t('settings.lineBinding.chooseWarehouse')}</option>
            {productionWarehouses.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} · ID: {location.id}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-600">
          {t('settings.lineBinding.location')}
          <select
            required
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={productionLocationId}
            onChange={(event) => setProductionLocationId(event.target.value)}
            data-testid="line-binding-location-id"
          >
            <option value="">{t('settings.lineBinding.chooseLocation')}</option>
            {productionLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} · ID: {location.id}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-600">
          {t('settings.lineBinding.note')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={240}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
          <button
            type="submit"
            disabled={
              saving || !lineId || !productionWarehouseId || !productionLocationId
            }
            className="rounded-sm bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('settings.lineBinding.saving') : t('settings.lineBinding.save')}
          </button>
          <span className="text-xs text-stone-500">
            {t('settings.lineBinding.exactIdHint')}
          </span>
        </div>
      </form>
    </section>
  )
}
