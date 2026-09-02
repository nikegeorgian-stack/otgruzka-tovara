import { useI18n } from '@/context/I18nContext'
import type { WarehouseTab } from './warehouseTypes'

const FLOW: {
  id: Extract<WarehouseTab, 'nomenclature' | 'documents' | 'movements'>
  step: string
  titleKey: string
  bodyKey: string
  coach: string
}[] = [
  {
    id: 'nomenclature',
    step: '1',
    titleKey: 'warehouse.flow.nomenclature.title',
    bodyKey: 'warehouse.flow.nomenclature.body',
    coach: 'warehouse:flowNomenclature',
  },
  {
    id: 'documents',
    step: '2',
    titleKey: 'warehouse.flow.documents.title',
    bodyKey: 'warehouse.flow.documents.body',
    coach: 'warehouse:flowDocuments',
  },
  {
    id: 'movements',
    step: '3',
    titleKey: 'warehouse.flow.movements.title',
    bodyKey: 'warehouse.flow.movements.body',
    coach: 'warehouse:flowMovements',
  },
]

type Props = {
  value: WarehouseTab
  onChange: (tab: WarehouseTab) => void
}

export function WarehouseLedgerNav({ value, onChange }: Props) {
  const { t } = useI18n()
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800">
        {t('warehouse.flow.title')}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {FLOW.map((item) => {
          const active = value === item.id
          return (
            <button
              key={item.id}
              type="button"
              data-coach={item.coach}
              onClick={() => onChange(item.id)}
              className={`rounded-md border px-3 py-2.5 text-left transition ${
                active
                  ? 'border-teal-700 bg-teal-50 shadow-sm'
                  : 'border-stone-200 bg-stone-50/60 hover:border-teal-500 hover:bg-teal-50/50'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {item.step}
              </span>
              <span className="mt-0.5 block text-sm font-bold text-ink">
                {t(item.titleKey)}
              </span>
              <span className="mt-1 block text-xs leading-snug text-stone-500">
                {t(item.bodyKey)}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
