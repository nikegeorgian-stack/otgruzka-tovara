import { useMemo, useState } from 'react'
import { FormulationRecipeEditor } from '@/components/directories/FormulationRecipeEditor'
import { FormNotice } from '@/components/ui/FormNotice'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  extractSolidsPct,
  maxBatchesFromStock,
  recipeDryBatchKg,
  recipeTotalBatchKg,
} from '@/lib/formulations/calc'
import { emptyFormulationRecipe } from '@/lib/formulations/init'
import { syncFormulationRecipeWarehouse } from '@/lib/formulations/warehouseSync'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type {
  FormulationCategory,
  FormulationRecipe,
  FormulationStore,
  PigmentPaste,
} from '@/lib/formulations/types'
import {
  FORMULATION_CATEGORIES,
  formulationCategoryLabel,
  formulationColorLabel,
} from '@/lib/formulations/types'
import { colorVariantToProductColor } from '@/lib/formulations/colorMap'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Tab = 'recipes' | 'pigments'

type Props = {
  store: FormulationStore
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  onUpsertRecipe: (r: FormulationRecipe) => void
  onRemoveRecipe: (id: string) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onOpenNomenclature: () => void
}

export function FormulationsDirectoryPanel({
  store,
  warehouse,
  categoryNames,
  onUpsertRecipe,
  onRemoveRecipe,
  onUpsertWarehouseItem,
  onOpenNomenclature,
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const [tab, setTab] = useState<Tab>('recipes')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FormulationCategory | ''>('')
  const [selected, setSelected] = useState<FormulationRecipe | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return store.recipes.filter((r) => {
      if (!r.active) return false
      if (category && r.category !== category) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.variantCode?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [store.recipes, search, category])

  const warehouseBalances = useMemo(
    () => computeAllBalances(warehouse),
    [warehouse],
  )

  const filteredPigments = useMemo(() => {
    const q = search.trim().toLowerCase()
    return store.pigmentPastes.filter(
      (p) =>
        p.active &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          (p.colorIndex?.toLowerCase().includes(q) ?? false)),
    )
  }, [store.pigmentPastes, search])

  function openRecipe(r: FormulationRecipe) {
    setSelected({ ...r, components: r.components.map((c) => ({ ...c })) })
  }

  function saveRecipe() {
    if (!selected) return
    if (!selected.name.trim()) {
      setNotice(t('formulation.errName'))
      return
    }
    const { recipe, outputItem } = syncFormulationRecipeWarehouse(
      { ...selected, updatedAt: new Date().toISOString() },
      warehouse,
      locale,
    )
    onUpsertWarehouseItem(outputItem)
    onUpsertRecipe(recipe)
    setSelected(null)
    setNotice(t('formulation.savedSynced'))
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['recipes', 'formulation.tab.recipes'],
            ['pigments', 'formulation.tab.pigments'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-sm px-3 py-2 text-xs font-semibold ${
              tab === id ? 'bg-accent text-white' : 'text-stone-600 hover:bg-paper-dark'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-[200px] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('formulation.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab === 'recipes' && (
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as FormulationCategory | '')}
          >
            <option value="">{t('formulation.allCategories')}</option>
            {FORMULATION_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {locale === 'ka' ? c.labelKa : c.labelRu}
              </option>
            ))}
          </select>
        )}
        {tab === 'recipes' && (
          <button
            type="button"
            className="btn-add"
            onClick={() => openRecipe(emptyFormulationRecipe(store))}
          >
            {t('formulation.add')}
          </button>
        )}
      </div>

      {tab === 'recipes' && (
        <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-3">{t('formulation.col.code')}</th>
                <th className="px-4 py-3">{t('formulation.col.name')}</th>
                <th className="px-4 py-3">{t('formulation.col.category')}</th>
                <th className="px-4 py-3">{t('formulation.col.color')}</th>
                <th className="px-4 py-3">{t('formulation.col.whCode')}</th>
                <th className="px-4 py-3">{t('formulation.col.dryKg')}</th>
                <th className="px-4 py-3">{t('formulation.col.batchKg')}</th>
                <th className="px-4 py-3">{t('formulation.col.stockBatches')}</th>
                <th className="px-4 py-3">{t('formulation.col.solids')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredRecipes.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-stone-500">
                    {t('formulation.empty')}
                  </td>
                </tr>
              )}
              {filteredRecipes.map((r) => {
                const wh = r.outputWarehouseItemId
                  ? warehouse.items.find((i) => i.id === r.outputWarehouseItemId)
                  : undefined
                return (
                  <tr key={r.id} className="border-t border-grid/60 hover:bg-stone-50/50">
                    <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                    <td className="max-w-[280px] px-4 py-3">
                      <p className="font-medium leading-snug">{r.name}</p>
                      {r.variantCode && (
                        <p className="text-xs text-stone-400">{r.variantCode}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">{formulationCategoryLabel(r.category, locale)}</td>
                    <td className="px-4 py-3">
                      {r.colorVariant ? (
                        <ProductColorBadge
                          productColor={colorVariantToProductColor(r.colorVariant)}
                          colorLogo={formulationColorLabel(r.colorVariant, locale)}
                          size="md"
                        />
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">
                      {wh?.internalCode ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{recipeDryBatchKg(r)}</td>
                    <td className="px-4 py-3 tabular-nums">{recipeTotalBatchKg(r)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {(() => {
                        const n = maxBatchesFromStock(r, warehouseBalances)
                        return n != null ? n : '—'
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs">{extractSolidsPct(r.note) ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-sm font-medium text-accent hover:underline"
                        onClick={() => openRecipe(r)}
                      >
                        {t('counterparty.open')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pigments' && (
        <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-3">{t('formulation.pigmentName')}</th>
                <th className="px-4 py-3">{t('formulation.pigmentIndex')}</th>
                <th className="px-4 py-3">{t('formulation.pigmentPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPigments.map((p) => (
                <PigmentRow key={p.id} pigment={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <FormulationRecipeEditor
          recipe={selected}
          warehouse={warehouse}
          categoryNames={categoryNames}
          onChange={setSelected}
          onClose={() => setSelected(null)}
          onSave={saveRecipe}
          onDelete={
            selected.id
              ? async () => {
                  if (await confirm({ message: t('formulation.deleteConfirm'), danger: true })) {
                    onRemoveRecipe(selected.id)
                    setSelected(null)
                  }
                }
              : undefined
          }
          onOpenNomenclature={onOpenNomenclature}
        />
      )}
    </div>
  )
}

function PigmentRow({ pigment }: { pigment: PigmentPaste }) {
  return (
    <tr className="border-t border-grid/60">
      <td className="px-4 py-3">{pigment.name}</td>
      <td className="px-4 py-3 font-mono text-xs">{pigment.colorIndex ?? '—'}</td>
      <td className="px-4 py-3 tabular-nums">
        {pigment.pricePerKg != null
          ? `${pigment.pricePerKg} ${pigment.currency}/kg`
          : '—'}
      </td>
    </tr>
  )
}
