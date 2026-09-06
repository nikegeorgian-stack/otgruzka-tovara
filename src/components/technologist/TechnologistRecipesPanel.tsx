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
import {
  canApproveRecipeVersion,
  getApprovedRecipeVersion,
  listRecipeVersions,
} from '@/lib/formulations/recipeApproval'
import { syncFormulationRecipeWarehouse } from '@/lib/formulations/warehouseSync'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import { formulationCategoryLabel, formulationColorLabel } from '@/lib/formulations/types'
import { colorVariantToProductColor } from '@/lib/formulations/colorMap'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { CreateItemRequestInput } from '@/lib/warehouse/itemRequests'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  store: FormulationStore
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  operatorId?: string
  operatorName?: string
  currentUser?: AppUser | null
  access?: AccessStore | null
  onUpsertRecipe: (r: FormulationRecipe) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onRequestItem: (input: CreateItemRequestInput) => void
  onSubmitRecipeVersion: (
    recipeId: string,
    opts?: { approve?: boolean; reason?: string },
  ) => { ok: true; versionId: string; approved: boolean } | { ok: false; error: string }
  onApproveRecipeVersion: (
    versionId: string,
    opts?: { reason?: string },
  ) => { ok: true } | { ok: false; error: string }
}

export function TechnologistRecipesPanel({
  store,
  warehouse,
  categoryNames,
  operatorId,
  operatorName,
  currentUser,
  access,
  onUpsertRecipe,
  onUpsertWarehouseItem,
  onRequestItem,
  onSubmitRecipeVersion,
  onApproveRecipeVersion,
}: Props) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<FormulationRecipe | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const balances = useMemo(() => computeAllBalances(warehouse), [warehouse])
  const canApprove = canApproveRecipeVersion(currentUser ?? null, access)

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
    setError(null)
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

  function submitVersion(recipeId: string, approve: boolean) {
    setError(null)
    const result = onSubmitRecipeVersion(recipeId, {
      approve,
      reason: approve && currentUser?.roleId === 'sysadmin' ? 'R2.9 emergency approve' : undefined,
    })
    if (!result.ok) {
      setError(t(result.error) !== result.error ? t(result.error) : result.error)
      return
    }
    setNotice(
      result.approved
        ? t('formulation.versionApproved')
        : t('formulation.versionSubmitted'),
    )
  }

  function approveDraft(versionId: string) {
    setError(null)
    const result = onApproveRecipeVersion(versionId, {
      reason: currentUser?.roleId === 'sysadmin' ? 'R2.9 emergency approve' : undefined,
    })
    if (!result.ok) {
      setError(t(result.error) !== result.error ? t(result.error) : result.error)
      return
    }
    setNotice(t('formulation.versionApproved'))
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}

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
                <th>{t('formulation.col.version')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recipes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-stone-500">
                    {t('formulation.empty')}
                  </td>
                </tr>
              ) : (
                recipes.map((r) => {
                  const batches = maxBatchesFromStock(r, balances)
                  const approved = getApprovedRecipeVersion(store, r.id)
                  const drafts = listRecipeVersions(store, r.id).filter((v) => v.status === 'draft')
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
                      <td className="text-xs">
                        {approved ? (
                          <span className="text-teal-800">
                            v{approved.versionNumber} ✓ {t('formulation.versionStatus.approved')}
                          </span>
                        ) : drafts.length > 0 ? (
                          <span className="text-amber-800">
                            {t('formulation.versionStatus.draft')} (v{drafts[0]!.versionNumber})
                          </span>
                        ) : (
                          <span className="text-stone-500">{t('formulation.versionStatus.none')}</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button variant="secondary" size="sm" onClick={() => openRecipe(r)}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => submitVersion(r.id, false)}
                          >
                            {t('formulation.submitVersion')}
                          </Button>
                          {canApprove && (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => submitVersion(r.id, true)}
                              >
                                {t('formulation.approveVersion')}
                              </Button>
                              {drafts[0] && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => approveDraft(drafts[0]!.id)}
                                >
                                  {t('formulation.approveDraft')}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
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
