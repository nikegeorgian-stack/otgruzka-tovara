import { useMemo, useState } from 'react'
import { FormulationRecipeBuilder } from '@/components/technologist/FormulationRecipeBuilder'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormNotice } from '@/components/ui/FormNotice'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { useI18n } from '@/context/I18nContext'
import {
  maxBatchesFromStock,
  recipeDryBatchKg,
  recipeTotalBatchKg,
} from '@/lib/formulations/calc'
import { emptyFormulationRecipe } from '@/lib/formulations/init'
import { syncFormulationRecipeWarehouse } from '@/lib/formulations/warehouseSync'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import { formulationCategoryLabel, formulationColorLabel } from '@/lib/formulations/types'
import { colorVariantToProductColor } from '@/lib/formulations/colorMap'
import type { CreateItemRequestInput } from '@/lib/warehouse/itemRequests'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  store: FormulationStore
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  operatorId?: string
  operatorName?: string
  onUpsertRecipe: (r: FormulationRecipe) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onRequestItem: (input: CreateItemRequestInput) => void
}

export function TechnologistRecipesPanel({
  store,
  warehouse,
  categoryNames,
  operatorId,
  operatorName,
  onUpsertRecipe,
  onUpsertWarehouseItem,
  onRequestItem,
}: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<FormulationRecipe | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const balances = useMemo(() => computeAllBalances(warehouse), [warehouse])

  const recipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return store.recipes
      .filter((r) => r.active)
      .filter((r) => {
        if (!q) return true
        return (
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          (r.variantCode?.toLowerCase().includes(q) ?? false)
        )
      })
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [store.recipes, search])

  function openRecipe(r: FormulationRecipe) {
    setSelected({ ...r, components: r.components.map((c) => ({ ...c })) })
  }

  function saveRecipe() {
    if (!selected) return
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

      <Card
        title={t('technologist.recipesPanelTitle')}
        description={t('technologist.recipesPanelHint')}
        actions={
          <Button variant="primary" size="sm" onClick={() => openRecipe(emptyFormulationRecipe(store))}>
            + {t('formulation.add')}
          </Button>
        }
      >
        <input
          className="mb-4 w-full max-w-md rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('formulation.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="overflow-x-auto">
          <table className="fc-table w-full text-sm">
            <thead>
              <tr>
                <th>{t('formulation.col.code')}</th>
                <th>{t('formulation.col.name')}</th>
                <th>{t('formulation.col.category')}</th>
                <th className="text-right">{t('formulation.col.batchKg')}</th>
                <th className="text-right">{t('formulation.col.stockBatches')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recipes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-stone-500">
                    {t('formulation.empty')}
                  </td>
                </tr>
              ) : (
                recipes.map((r) => {
                  const batches = maxBatchesFromStock(r, balances)
                  return (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.code}</td>
                      <td>
                        <p className="font-medium">{r.name}</p>
                        {r.colorVariant && (
                          <ProductColorBadge
                            productColor={colorVariantToProductColor(r.colorVariant)}
                            colorLogo={formulationColorLabel(r.colorVariant, locale)}
                            size="sm"
                          />
                        )}
                      </td>
                      <td>{formulationCategoryLabel(r.category, locale)}</td>
                      <td className="text-right tabular-nums">
                        {recipeDryBatchKg(r)} / {recipeTotalBatchKg(r)}
                      </td>
                      <td
                        className={`text-right tabular-nums font-semibold ${
                          batches != null && batches > 0 ? 'text-teal-800' : 'text-amber-800'
                        }`}
                      >
                        {batches ?? '—'}
                      </td>
                      <td className="text-right">
                        <Button variant="secondary" size="sm" onClick={() => openRecipe(r)}>
                          {t('common.edit')}
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <FormulationRecipeBuilder
          recipe={selected}
          warehouse={warehouse}
          categoryNames={categoryNames}
          operatorId={operatorId}
          operatorName={operatorName}
          onChange={setSelected}
          onClose={() => setSelected(null)}
          onSave={saveRecipe}
          onRequestItem={(input) => {
            onRequestItem(input)
            setNotice(t('technologist.requestItemSent'))
          }}
        />
      )}
    </div>
  )
}
