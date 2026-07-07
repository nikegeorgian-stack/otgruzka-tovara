import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'

import { FormNotice } from '@/components/ui/FormNotice'

import { ModalBackdrop } from '@/components/ui/ModalBackdrop'

import { RollWidthQuickPick } from '@/components/ui/RollWidthQuickPick'

import { useI18n } from '@/context/I18nContext'

import { formatFinishedProductCode } from '@/lib/finishedProducts/init'

import type { FinishedProduct } from '@/lib/finishedProducts/types'

import { newId } from '@/lib/production/files'

import { parseNum } from '@/lib/warehouse/loading'

import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

import {

  calcRollWeightFromDimensions,

  finishedCategoryId,

  finishedWarehouseLocationId,

} from '@/lib/warehouse/loadingProfile'



type ProductOption = {

  key: string

  label: string

  name: string

  itemId?: string

  finishedProductId?: string

}



type Mode = 'pick' | 'newFp' | 'warehouseOnly'



type Props = {

  options: ProductOption[]

  finishedProducts: FinishedProduct[]

  warehouse: WarehouseStore

  onPick: (key: string, synthetic?: ProductOption) => void

  onUpsertFinishedProduct: (fp: FinishedProduct) => void

  onUpsertItem: (item: WarehouseItem) => void

  onClose: () => void

}



function nextFpCode(items: FinishedProduct[]): string {

  const max = items.reduce((m, p) => {

    const match = p.code.match(/(\d+)\s*$/)

    return match ? Math.max(m, Number(match[1])) : m

  }, 0)

  return formatFinishedProductCode(max + 1)

}



function parseOptionalNum(raw: string): number | undefined {

  const n = parseNum(raw)

  return n > 0 ? n : undefined

}



export function LoadingPickProductModal({

  options,

  finishedProducts,

  warehouse,

  onPick,

  onUpsertFinishedProduct,

  onUpsertItem,

  onClose,

}: Props) {

  const { t, tf } = useI18n()

  const [mode, setMode] = useState<Mode>('pick')

  const [query, setQuery] = useState('')

  const [name, setName] = useState('')

  const [rollLengthM, setRollLengthM] = useState('')

  const [grammageGsm, setGrammageGsm] = useState('')

  const [rollWidthM, setRollWidthM] = useState('')

  const [weight, setWeight] = useState('')

  const [error, setError] = useState<string | null>(null)



  const filtered = useMemo(() => {

    const q = query.trim().toLowerCase()

    if (!q) return options

    return options.filter((o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))

  }, [options, query])



  function resolveWeightKg(): number | null {

    const manual = parseNum(weight)

    if (manual > 0) return manual

    const calc = calcRollWeightFromDimensions(

      parseNum(rollLengthM),

      parseNum(rollWidthM),

      parseNum(grammageGsm),

    )

    return calc > 0 ? calc : null

  }



  function createWarehouseItem(productName: string, w: number): string {

    const item: WarehouseItem = {

      id: crypto.randomUUID(),

      internalCode: '',

      name: productName.trim(),

      categoryId: finishedCategoryId(warehouse),

      warehouseId: finishedWarehouseLocationId(warehouse),

      unit: 'рул',

      weightKg: w,

      active: true,

      sortOrder: warehouse.items.length,

    }

    onUpsertItem(item)

    return item.id

  }



  function saveNewFp() {

    const productName = name.trim()

    if (!productName) {

      setError(t('warehouse.err.nameRequired'))

      return

    }

    const w = resolveWeightKg()

    if (!w) {

      setError(t('warehouse.loading.quickFp.errWeightOrDims'))

      return

    }

    setError(null)

    const now = new Date().toISOString()

    const fp: FinishedProduct = {

      id: newId(),

      code: nextFpCode(finishedProducts),

      name: productName,

      category: 'ratl1',

      unit: 'mp',

      productType: 'mesh',

      metersPerRoll: parseOptionalNum(rollLengthM),

      grammageGsm: parseOptionalNum(grammageGsm),

      rollWidthM: parseOptionalNum(rollWidthM),

      active: true,

      createdAt: now,

      updatedAt: now,

    }

    const itemId = createWarehouseItem(productName, w)

    onUpsertFinishedProduct({ ...fp, warehouseItemId: itemId })

    onPick(`fp:${fp.id}`, {

      key: `fp:${fp.id}`,

      label: `${fp.code} · ${productName}`,

      name: productName,

      finishedProductId: fp.id,

      itemId,

    })

    onClose()

  }



  function saveWarehouseOnly() {

    const productName = name.trim()

    if (!productName) {

      setError(t('warehouse.err.nameRequired'))

      return

    }

    const w = resolveWeightKg()

    if (!w) {

      setError(t('warehouse.loading.quickFp.errWeightOrDims'))

      return

    }

    setError(null)

    const itemId = createWarehouseItem(productName, w)

    onPick(`wi:${itemId}`, {

      key: `wi:${itemId}`,

      label: productName,

      name: productName,

      itemId,

    })

    onClose()

  }



  const calcPreview = calcRollWeightFromDimensions(

    parseNum(rollLengthM),

    parseNum(rollWidthM),

    parseNum(grammageGsm),

  )



  return (
    <ModalBackdrop
      open
      onClose={onClose}
      className="fixed inset-0 flex items-center justify-center bg-stone-900/50 p-4"
      panelClassName="flex max-h-[90vh] w-full max-w-lg flex-col rounded-sm border border-grid bg-white shadow-sm"
    >
        <div className="border-b border-grid px-5 py-4">

          <h3 className="text-lg font-bold text-ink">{t('warehouse.loading.pickProductTitle')}</h3>

          <p className="mt-1 text-sm text-stone-500">{t('warehouse.loading.pickProductHint')}</p>

        </div>



        <div className="flex gap-1 border-b border-grid px-5 py-2">

          {(

            [

              ['pick', t('warehouse.loading.pickTabCatalog')],

              ['newFp', t('warehouse.loading.pickTabNewFp')],

              ['warehouseOnly', t('warehouse.loading.pickTabWarehouse')],

            ] as [Mode, string][]

          ).map(([id, label]) => (

            <button

              key={id}

              type="button"

              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${

                mode === id ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'

              }`}

              onClick={() => {

                setMode(id)

                setError(null)

              }}

            >

              {label}

            </button>

          ))}

        </div>



        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">

          {error && (

            <div className="mb-3">

              <FormNotice type="error" message={error} onDismiss={() => setError(null)} />

            </div>

          )}



          {mode === 'pick' && (

            <>

              <input

                type="search"

                autoFocus

                className="mb-3 w-full rounded-sm border border-grid px-3 py-2 text-sm"

                placeholder={t('warehouse.loading.pickSearch')}

                value={query}

                onChange={(e) => setQuery(e.target.value)}

              />

              {filtered.length === 0 ? (

                <p className="rounded-sm border border-dashed border-grid bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">

                  {t('warehouse.loading.pickEmpty')}

                </p>

              ) : (

                <ul className="divide-y divide-grid/60 rounded-sm border border-grid">

                  {filtered.map((o) => (

                    <li key={o.key}>

                      <button

                        type="button"

                        className="w-full px-3 py-2.5 text-left text-sm hover:bg-teal-50"

                        onClick={() => {

                          onPick(o.key)

                          onClose()

                        }}

                      >

                        {o.label}

                      </button>

                    </li>

                  ))}

                </ul>

              )}

            </>

          )}



          {(mode === 'newFp' || mode === 'warehouseOnly') && (

            <div className="space-y-3">

              <p className="text-sm text-stone-500">

                {mode === 'newFp'

                  ? t('warehouse.loading.pickNewFpHint')

                  : t('warehouse.loading.pickWarehouseHint')}

              </p>

              <label className="block text-xs font-semibold text-stone-500">

                {t('warehouse.loading.col.name')}

                <input

                  type="text"

                  autoFocus

                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"

                  value={name}

                  onChange={(e) => setName(e.target.value)}

                />

              </label>

              <div className="grid grid-cols-2 gap-3">

                <label className="block text-xs font-semibold text-stone-500">

                  {t('warehouse.loading.col.rollLength')}

                  <input

                    type="text"

                    inputMode="decimal"

                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"

                    value={rollLengthM}

                    onChange={(e) => setRollLengthM(e.target.value)}

                  />

                </label>

                <label className="block text-xs font-semibold text-stone-500">

                  {t('warehouse.loading.col.grammage')}

                  <input

                    type="text"

                    inputMode="decimal"

                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"

                    value={grammageGsm}

                    onChange={(e) => setGrammageGsm(e.target.value)}

                  />

                </label>

              </div>

              <label className="block text-xs font-semibold text-stone-500">

                {t('warehouse.loading.col.rollWidth')}

                <input

                  type="text"

                  inputMode="decimal"

                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"

                  value={rollWidthM}

                  onChange={(e) => setRollWidthM(e.target.value)}

                />

                <RollWidthQuickPick

                  value={parseOptionalNum(rollWidthM)}

                  onPick={(w) => setRollWidthM(String(w))}

                />

              </label>

              <label className="block text-xs font-semibold text-stone-500">

                {t('warehouse.loading.weight.product')} (кг)

                <input

                  type="text"

                  inputMode="decimal"

                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm font-mono"

                  placeholder={t('warehouse.loading.quickFp.weightPh')}

                  value={weight}

                  onChange={(e) => setWeight(e.target.value)}

                />

                {calcPreview > 0 && !weight.trim() && (

                  <span className="mt-1 block text-[10px] text-teal-700">

                    {tf('warehouse.loading.quickFp.calcWeight', { kg: calcPreview })}

                  </span>

                )}

              </label>

            </div>

          )}

        </div>



        <div className="flex justify-end gap-2 border-t border-grid px-5 py-4">

          <Button variant="secondary" size="sm" onClick={onClose}>

            {t('common.cancel')}

          </Button>

          {mode === 'newFp' && (

            <Button variant="primary" size="sm" onClick={saveNewFp}>

              {t('warehouse.loading.pickCreateFp')}

            </Button>

          )}

          {mode === 'warehouseOnly' && (

            <Button variant="primary" size="sm" onClick={saveWarehouseOnly}>

              {t('warehouse.loading.pickCreateWarehouse')}

            </Button>

          )}

        </div>

    </ModalBackdrop>
  )

}


