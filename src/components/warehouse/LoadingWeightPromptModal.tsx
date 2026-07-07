import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { useI18n } from '@/context/I18nContext'
import type { MissingWeight } from '@/lib/warehouse/loadingProfile'
import type { WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  missing: MissingWeight[]
  items: WarehouseItem[]
  onSaveItem: (item: WarehouseItem) => void
  onClose: () => void
  onSaved: () => void
}

export function LoadingWeightPromptModal({
  missing,
  items,
  onSaveItem,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n()
  const [weights, setWeights] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const m of missing) {
      const key = m.itemId || m.finishedProductId || m.kind
      init[key] = ''
    }
    return init
  })
  const [error, setError] = useState<string | null>(null)

  function labelFor(m: MissingWeight): string {
    if (m.kind === 'product') return t('warehouse.loading.weight.product')
    if (m.kind === 'box') return t('warehouse.loading.weight.box')
    return t('warehouse.loading.weight.pallet')
  }

  function save() {
    setError(null)
    for (const m of missing) {
      const key = m.itemId || m.finishedProductId || m.kind
      const raw = weights[key]?.trim().replace(',', '.')
      const w = raw ? Number(raw) : 0
      if (!Number.isFinite(w) || w <= 0) {
        setError(t('warehouse.loading.weight.required'))
        return
      }
      if (!m.itemId) continue
      const item = items.find((i) => i.id === m.itemId)
      if (!item) continue
      onSaveItem({ ...item, weightKg: w })
    }
    onSaved()
    onClose()
  }

  return (
    <ModalBackdrop
      open
      onClose={onClose}
      className="fixed inset-0 flex items-center justify-center bg-stone-900/50 p-4"
      panelClassName="w-full max-w-md rounded-sm border border-grid bg-white p-5 shadow-sm"
    >
        <h3 className="text-lg font-bold text-ink">{t('warehouse.loading.weight.title')}</h3>
        <p className="mt-1 text-sm text-stone-500">{t('warehouse.loading.weight.hint')}</p>
        {error && (
          <div className="mt-3">
            <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <ul className="mt-4 space-y-3">
          {missing.map((m) => {
            const key = m.itemId || m.finishedProductId || m.kind
            return (
              <li key={key} className="rounded-sm border border-grid bg-stone-50 p-3">
                <p className="text-xs font-semibold text-stone-500">{labelFor(m)}</p>
                <p className="text-sm font-medium text-ink">{m.itemName}</p>
                {m.itemId ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="mt-2 w-full rounded-sm border border-grid px-3 py-2 text-sm font-mono"
                    placeholder={t('warehouse.loading.weight.kgPh')}
                    value={weights[key] ?? ''}
                    onChange={(e) => setWeights((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                ) : (
                  <p className="mt-2 text-xs text-amber-700">{t('warehouse.loading.weight.createFirst')}</p>
                )}
              </li>
            )
          })}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
    </ModalBackdrop>
  )
}
