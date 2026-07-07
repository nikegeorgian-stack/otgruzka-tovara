import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import { WAREHOUSE_TABS, type WarehouseTab } from '@/components/warehouse/warehouseTypes'
import type { WarehouseViewDefaults } from '@/lib/viewDefaults/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  webMode?: boolean
  initial: WarehouseViewDefaults
  onSave: (defaults: WarehouseViewDefaults) => void
  onClose: () => void
}

export function WarehouseViewDefaultsDialog({
  warehouse,
  webMode = false,
  initial,
  onSave,
  onClose,
}: Props) {
  const { t } = useI18n()
  const tabs = webMode ? WAREHOUSE_TABS.filter((t) => t !== 'import') : WAREHOUSE_TABS
  const [tab, setTab] = useState<WarehouseTab>(initial.tab ?? 'balances')
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? '')
  const [deficitOnly, setDeficitOnly] = useState(initial.deficitOnly ?? false)
  const [showArchived, setShowArchived] = useState(initial.showArchived ?? false)

  return (
    <AppDialog
      open
      onClose={onClose}
      size="md"
      title={t('warehouse.defaults.title')}
      subtitle={t('warehouse.defaults.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-paper-dark"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-95"
            onClick={() => {
              onSave({ tab, warehouseId: warehouseId || undefined, deficitOnly, showArchived })
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('warehouse.defaults.tab')}
          </p>
          <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                  tab === id ? 'bg-white text-ink shadow-sm' : 'text-stone-500 hover:text-ink'
                }`}
                onClick={() => setTab(id)}
              >
                {t(`warehouse.tab.${id}`)}
              </button>
            ))}
          </div>
        </section>
        {warehouse.locations.length > 0 && (
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('warehouse.defaults.location')}
            </label>
            <select
              className="mt-2 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('warehouse.defaults.allLocations')}</option>
              {warehouse.locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </section>
        )}
        <section className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-grid text-accent"
              checked={deficitOnly}
              onChange={(e) => setDeficitOnly(e.target.checked)}
            />
            {t('warehouse.defaults.deficitOnly')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-grid text-accent"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('warehouse.defaults.showArchived')}
          </label>
        </section>
      </div>
    </AppDialog>
  )
}
