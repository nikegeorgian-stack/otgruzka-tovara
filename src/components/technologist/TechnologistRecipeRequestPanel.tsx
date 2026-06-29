import { useMemo, useState } from 'react'
import { QuickFormulationRecipeDialog } from '@/components/technologist/QuickFormulationRecipeDialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { FormulationRecipe, FormulationStore, FormulationComponent } from '@/lib/formulations/types'
import { syncFormulationRecipeWarehouse } from '@/lib/formulations/warehouseSync'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  draftFormulationRecipeFromOrder,
  ordersNeedingFormulationRecipe,
  recipesMatchingGsm,
} from '@/lib/planner/recipeRequests'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  plannerOrders: ProductionOrder[]
  formulationStore: FormulationStore
  recipes: FormulationRecipe[]
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  onAssignRecipe: (orderId: string, recipeId: string) => boolean
  onUpsertRecipe: (r: FormulationRecipe) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
}

type BuilderState = {
  order: ProductionOrder
  recipe: FormulationRecipe
}

function RecipeRequestRow({
  order,
  recipes,
  onAssignRecipe,
  onCreateRecipe,
}: {
  order: ProductionOrder
  recipes: FormulationRecipe[]
  onAssignRecipe: (orderId: string, recipeId: string) => boolean
  onCreateRecipe: (order: ProductionOrder) => void
}) {
  const { t, tf } = useI18n()
  const candidates = useMemo(
    () => recipesMatchingGsm(recipes, order.targetGsm),
    [recipes, order.targetGsm],
  )
  const [recipeId, setRecipeId] = useState(candidates[0]?.id ?? '')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  )

  function handleAssign() {
    if (!recipeId) {
      setNotice({
        type: 'error',
        message: t('technologist.recipeRequests.noRecipeSelected'),
      })
      return
    }
    const ok = onAssignRecipe(order.id, recipeId)
    setNotice(
      ok
        ? { type: 'success', message: t('technologist.recipeRequests.assigned') }
        : { type: 'error', message: t('technologist.recipeRequests.failed') },
    )
  }

  return (
    <div className="rounded-sm border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-stone-800">
            {order.orderNumber || '—'} · {order.productName}
          </div>
          <div className="mt-0.5 text-xs text-stone-600">
            {order.customer}
            {order.targetGsm ? ` · ${order.targetGsm} г/м²` : ''}
            {order.startDate
              ? ` · ${tf('technologist.recipeRequests.fromDate', { date: order.startDate })}`
              : ''}
          </div>
          {order.labelNote && (
            <div className="mt-1 text-xs text-stone-500">{order.labelNote}</div>
          )}
        </div>
        <div className="text-right text-xs tabular-nums text-stone-600">
          {tf('technologist.recipeRequests.qtyMp', { qty: order.totalQtyMp })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-500">
          {t('technologist.recipeRequests.pickRecipe')}
          <select
            className="fc-input mt-0.5 min-w-[220px]"
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
          >
            <option value="">{t('technologist.recipeRequests.selectRecipe')}</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
                {r.grammageGsm ? ` (${r.grammageGsm} г/м²)` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={handleAssign}>
          {t('technologist.recipeRequests.assign')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onCreateRecipe(order)}>
          + {t('technologist.recipeRequests.createRecipe')}
        </Button>
      </div>
      {notice && <FormNotice type={notice.type} message={notice.message} />}
    </div>
  )
}

export function TechnologistRecipeRequestPanel({
  plannerOrders,
  formulationStore,
  recipes,
  warehouse,
  categoryNames,
  onAssignRecipe,
  onUpsertRecipe,
  onUpsertWarehouseItem,
}: Props) {
  const { t, locale } = useI18n()
  const [builder, setBuilder] = useState<BuilderState | null>(null)
  const [panelNotice, setPanelNotice] = useState<string | null>(null)

  const pending = useMemo(
    () => ordersNeedingFormulationRecipe(plannerOrders),
    [plannerOrders],
  )

  function openBuilder(order: ProductionOrder) {
    const draft = draftFormulationRecipeFromOrder(formulationStore, order)
    setBuilder({
      order,
      recipe: {
        ...draft,
        components: draft.components.map((c: FormulationComponent) => ({ ...c })),
      },
    })
    setPanelNotice(null)
  }

  function saveBuilder() {
    if (!builder) return
    const { recipe, outputItem } = syncFormulationRecipeWarehouse(
      { ...builder.recipe, updatedAt: new Date().toISOString() },
      warehouse,
      locale,
    )
    onUpsertWarehouseItem(outputItem)
    onUpsertRecipe(recipe)
    const assigned = onAssignRecipe(builder.order.id, recipe.id)
    setBuilder(null)
    setPanelNotice(
      assigned
        ? t('technologist.recipeRequests.createdAndAssigned')
        : t('technologist.recipeRequests.createdOnly'),
    )
  }

  return (
    <>
      <Card
        title={t('technologist.recipeRequests.title')}
        description={t('technologist.recipeRequests.hint')}
      >
        {panelNotice && (
          <FormNotice type="info" message={panelNotice} onDismiss={() => setPanelNotice(null)} />
        )}
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">
            {t('technologist.recipeRequests.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((order) => (
              <RecipeRequestRow
                key={order.id}
                order={order}
                recipes={recipes}
                onAssignRecipe={onAssignRecipe}
                onCreateRecipe={openBuilder}
              />
            ))}
          </div>
        )}
      </Card>

      {builder && (
        <QuickFormulationRecipeDialog
          order={builder.order}
          recipe={builder.recipe}
          formulationStore={formulationStore}
          warehouse={warehouse}
          categoryNames={categoryNames}
          onChange={(recipe) => setBuilder((b) => (b ? { ...b, recipe } : b))}
          onClose={() => setBuilder(null)}
          onSave={saveBuilder}
        />
      )}
    </>
  )
}
