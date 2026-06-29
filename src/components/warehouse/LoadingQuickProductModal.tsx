import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import {
  finishedCategoryId,
  finishedWarehouseLocationId,
} from '@/lib/warehouse/loadingProfile'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  finishedProduct: FinishedProduct
  warehouse: WarehouseStore
  onSaveItem: (item: WarehouseItem) => void
  onLinkProduct: (fp: FinishedProduct) => void
  onClose: () => void
  onCreated: (itemId: string) => void
}

export function LoadingQuickProductModal({
  finishedProduct,
  warehouse,
  onSaveItem,
  onLinkProduct,
  onClose,
  onCreated,
}: Props) {
  const { t } = useI18n()
  const [weight, setWeight] = useState('')
  const [error, setError] = useState<string | null>(null)

  function save() {
    const raw = weight.trim().replace(',', '.')
    const w = raw ? Number(raw) : 0
    if (!Number.isFinite(w) || w <= 0) {
      setError(t('warehouse.loading.weight.required'))
      return
    }
    const item: WarehouseItem = {
      id: crypto.randomUUID(),
      internalCode: '',
      name: finishedProduct.name,
      categoryId: finishedCategoryId(warehouse),
      warehouseId: finishedWarehouseLocationId(warehouse),
      unit: 'рул',
      weightKg: w,
      active: true,
      sortOrder: warehouse.items.length,
    }
    onSaveItem(item)
    onLinkProduct({ ...finishedProduct, warehouseItemId: item.id, updatedAt: new Date().toISOString() })
    onCreated(item.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stone-900/50 p-4">
      <div className="w-full max-w-md rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-ink">{t('warehouse.loading.quickItem.title')}</h3>
        <p className="mt-1 text-sm text-stone-500">{t('warehouse.loading.quickItem.hint')}</p>
        <p className="mt-3 font-medium text-ink">{finishedProduct.name}</p>
        <p className="text-xs text-stone-400">{finishedProduct.code}</p>
        {error && (
          <div className="mt-3">
            <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <label className="mt-4 block text-xs font-semibold text-stone-500">
          {t('warehouse.loading.weight.product')} (кг)
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm font-mono"
            placeholder={t('warehouse.loading.weight.kgPh')}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={save}>
            {t('warehouse.loading.quickItem.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}
