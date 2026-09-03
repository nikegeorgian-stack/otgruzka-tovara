import { normalizeCounterparty, normalizeCounterpartyStore } from '@/lib/counterparties/init'
import type { Counterparty } from '@/lib/counterparties/types'
import { appendAudit } from '@/lib/audit'
import { withSuggestedLocalizedNames } from '@/lib/i18n/localizedNames'
import {
  normalizeFinishedProduct,
  normalizeFinishedProductStore,
} from '@/lib/finishedProducts/init'
import { withRegisteredFinishedCatalog } from '@/lib/finishedProducts/catalog'
import type { FinishedProduct, FinishedProductStore } from '@/lib/finishedProducts/types'
import { withRegisteredGrammage } from '@/lib/formulations/grammages'
import {
  normalizeFormulationRecipe,
  normalizeFormulationStore,
} from '@/lib/formulations/init'
import type { FormulationRecipe } from '@/lib/formulations/types'
import {
  approveRecipeVersion,
  canEditRecipeDraft,
  createDraftRecipeVersion,
  RECIPE_EDIT_FORBIDDEN,
  updateDraftRecipeVersion,
} from '@/lib/formulations/recipeApproval'
import {
  normalizeBoxRecipe,
  normalizePackagingRecipe,
  normalizePackagingRecipeStore,
} from '@/lib/packaging/init'
import type { BoxRecipe, PackagingRecipe } from '@/lib/packaging/types'
import { actorAuditFields } from './actorAuditFields'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import type { StoreSliceDeps } from '../storeApi'

export function createDirectoriesSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  return {
    upsertCounterparty(entry: Counterparty) {
      const normalized = normalizeCounterparty({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.counterparties.items.some((c) => c.id === normalized.id)
        const items = exists
          ? s.counterparties.items.map((c) => (c.id === normalized.id ? normalized : c))
          : [...s.counterparties.items, normalized]
        const nextCode = exists ? s.counterparties.nextCode : s.counterparties.nextCode + 1
        let next = {
          ...s,
          counterparties: normalizeCounterpartyStore({ items, nextCode }),
        }
        next = appendAudit(next, {
          action: 'counterparty_upsert',
          detail: `${exists ? 'Изменён' : 'Создан'}: ${normalized.name} (${normalized.code})`,
          ...who(),
        })
        return next
      })
    },

    removeCounterparty(id: string) {
      recordSliceExplicitDelete('counterparties.items', id, actorFromGetter(getActor))
      setStore((s) => {
        const cp = s.counterparties.items.find((c) => c.id === id)
        let next = {
          ...s,
          counterparties: {
            ...s.counterparties,
            items: s.counterparties.items.filter((c) => c.id !== id),
          },
          finishedProducts: {
            ...s.finishedProducts,
            items: s.finishedProducts.items.map((p) =>
              p.defaultCounterpartyId === id
                ? { ...p, defaultCounterpartyId: undefined }
                : p,
            ),
          },
          production: {
            ...s.production,
            planner: {
              ...s.production.planner,
              orders: s.production.planner.orders.map((o) =>
                o.counterpartyId === id
                  ? { ...o, counterpartyId: undefined, customer: '' }
                  : o,
              ),
            },
          },
        }
        if (cp) {
          next = appendAudit(next, {
            action: 'counterparty_remove',
            detail: `${cp.name} (${cp.code})`,
            ...who(),
          })
        }
        return next
      })
    },

    upsertFinishedProduct(entry: FinishedProduct) {
      const withNames = withSuggestedLocalizedNames(
        {
          ...entry,
          updatedAt: new Date().toISOString(),
          createdAt: entry.createdAt || new Date().toISOString(),
        },
        undefined,
        'product',
      )
      const normalized = normalizeFinishedProduct(withNames)
      setStore((s) => {
        const exists = s.finishedProducts.items.some((p) => p.id === normalized.id)
        const items = exists
          ? s.finishedProducts.items.map((p) => (p.id === normalized.id ? normalized : p))
          : [...s.finishedProducts.items, normalized]
        const nextCode = exists ? s.finishedProducts.nextCode : s.finishedProducts.nextCode + 1
        const withCatalog = withRegisteredFinishedCatalog(
          {
            ...s.finishedProducts,
            items,
            nextCode,
          },
          normalized,
        )
        let next = {
          ...s,
          finishedProducts: normalizeFinishedProductStore(withCatalog),
        }
        next = appendAudit(next, {
          action: 'finished_product_upsert',
          detail: `${exists ? 'Изменена' : 'Создана'} ГП: ${normalized.name} (${normalized.code})`,
          ...who(),
        })
        return next
      })
    },

    patchFinishedProductCatalog(
      patch: Partial<
        Pick<
          FinishedProductStore,
          'productTypeRegistry' | 'grammageRegistry' | 'rollWidthRegistry' | 'meshCellRegistry'
        >
      >,
    ) {
      setStore((s) => ({
        ...s,
        finishedProducts: normalizeFinishedProductStore({
          ...s.finishedProducts,
          productTypeRegistry: [
            ...(s.finishedProducts.productTypeRegistry ?? []),
            ...(patch.productTypeRegistry ?? []),
          ],
          grammageRegistry: [
            ...(s.finishedProducts.grammageRegistry ?? []),
            ...(patch.grammageRegistry ?? []),
          ],
          rollWidthRegistry: [
            ...(s.finishedProducts.rollWidthRegistry ?? []),
            ...(patch.rollWidthRegistry ?? []),
          ],
          meshCellRegistry: [
            ...(s.finishedProducts.meshCellRegistry ?? []),
            ...(patch.meshCellRegistry ?? []),
          ],
        }),
      }))
    },

    removeFinishedProduct(id: string) {
      recordSliceExplicitDelete('finishedProducts.items', id, actorFromGetter(getActor))
      setStore((s) => {
        const fp = s.finishedProducts.items.find((p) => p.id === id)
        let next = {
          ...s,
          finishedProducts: {
            ...s.finishedProducts,
            items: s.finishedProducts.items.filter((p) => p.id !== id),
          },
          production: {
            ...s.production,
            planner: {
              ...s.production.planner,
              orders: s.production.planner.orders.map((o) =>
                o.finishedProductId === id
                  ? { ...o, finishedProductId: undefined, productName: '' }
                  : o,
              ),
            },
          },
        }
        if (fp) {
          next = appendAudit(next, {
            action: 'finished_product_remove',
            detail: `${fp.name} (${fp.code})`,
            ...who(),
          })
        }
        return next
      })
    },

    upsertPackagingRecipe(entry: PackagingRecipe) {
      const normalized = normalizePackagingRecipe({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.packagingRecipes.items.some((i) => i.id === normalized.id)
        const items = exists
          ? s.packagingRecipes.items.map((i) => (i.id === normalized.id ? normalized : i))
          : [...s.packagingRecipes.items, normalized]
        const nextCode = exists
          ? s.packagingRecipes.nextCode
          : s.packagingRecipes.nextCode + 1
        return {
          ...s,
          packagingRecipes: normalizePackagingRecipeStore({
            ...s.packagingRecipes,
            items,
            nextCode,
          }),
        }
      })
    },

    upsertBoxRecipe(entry: BoxRecipe) {
      const normalized = normalizeBoxRecipe({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const boxes = s.packagingRecipes.boxes ?? []
        const exists = boxes.some((i) => i.id === normalized.id)
        const nextBoxes = exists
          ? boxes.map((i) => (i.id === normalized.id ? normalized : i))
          : [...boxes, normalized]
        const nextBoxCode = exists
          ? (s.packagingRecipes.nextBoxCode ?? 1)
          : (s.packagingRecipes.nextBoxCode ?? 1) + 1
        let next = {
          ...s,
          packagingRecipes: normalizePackagingRecipeStore({
            ...s.packagingRecipes,
            boxes: nextBoxes,
            nextBoxCode,
          }),
        }
        next = appendAudit(next, {
          action: 'directory_change',
          detail: `${exists ? 'Изменён' : 'Создан'} рецепт коробки: ${normalized.name} (${normalized.code})`,
          ...who(),
        })
        return next
      })
    },

    removeBoxRecipe(id: string) {
      recordSliceExplicitDelete('packagingRecipes.boxes', id, actorFromGetter(getActor))
      setStore((s) => {
        const removed = (s.packagingRecipes.boxes ?? []).find((i) => i.id === id)
        let next = {
          ...s,
          packagingRecipes: normalizePackagingRecipeStore({
            ...s.packagingRecipes,
            boxes: (s.packagingRecipes.boxes ?? []).filter((i) => i.id !== id),
          }),
          finishedProducts: {
            ...s.finishedProducts,
            items: s.finishedProducts.items.map((p) =>
              p.defaultBoxRecipeId === id ? { ...p, defaultBoxRecipeId: undefined } : p,
            ),
          },
          production: {
            ...s.production,
            planner: {
              ...s.production.planner,
              orders: s.production.planner.orders.map((o) =>
                o.boxRecipeId === id ? { ...o, boxRecipeId: undefined } : o,
              ),
            },
          },
        }
        if (removed) {
          next = appendAudit(next, {
            action: 'directory_change',
            detail: `Удалён рецепт коробки: ${removed.name} (${removed.code})`,
            ...who(),
          })
        }
        return next
      })
    },

    removePackagingRecipe(id: string) {
      recordSliceExplicitDelete('packagingRecipes.items', id, actorFromGetter(getActor))
      setStore((s) => ({
        ...s,
        packagingRecipes: {
          ...s.packagingRecipes,
          items: s.packagingRecipes.items.filter((i) => i.id !== id),
        },
        production: {
          ...s.production,
          planner: {
            ...s.production.planner,
            orders: s.production.planner.orders.map((o) =>
              o.packagingRecipeId === id ? { ...o, packagingRecipeId: undefined } : o,
            ),
          },
        },
      }))
    },

    upsertFormulationRecipe(entry: FormulationRecipe) {
      const normalized = normalizeFormulationRecipe({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.formulations.recipes.some((i) => i.id === normalized.id)
        const recipes = exists
          ? s.formulations.recipes.map((i) => (i.id === normalized.id ? normalized : i))
          : [...s.formulations.recipes, normalized]
        const nextRecipeCode = exists
          ? s.formulations.nextRecipeCode
          : s.formulations.nextRecipeCode + 1
        return {
          ...s,
          formulations: withRegisteredGrammage(
            normalizeFormulationStore({
              ...s.formulations,
              recipes,
              nextRecipeCode,
            }),
            normalized.grammageGsm,
          ),
        }
      })
    },

    removeFormulationRecipe(id: string) {
      recordSliceExplicitDelete('formulations.recipes', id, actorFromGetter(getActor))
      setStore((s) => ({
        ...s,
        formulations: {
          ...s.formulations,
          recipes: s.formulations.recipes.filter((i) => i.id !== id),
        },
        finishedProducts: {
          ...s.finishedProducts,
          items: s.finishedProducts.items.map((p) =>
            p.defaultFormulationRecipeId === id
              ? { ...p, defaultFormulationRecipeId: undefined }
              : p,
          ),
        },
        production: {
          ...s.production,
          planner: {
            ...s.production.planner,
            orders: s.production.planner.orders.map((o) =>
              o.formulationRecipeId === id ? { ...o, formulationRecipeId: undefined } : o,
            ),
          },
        },
      }))
    },

    createDraftFormulationRecipeVersion(input: {
      recipeId: string
      components: import('@/lib/formulations/recipeApproval').FormulationRecipeVersionComponent[]
      normBase?: import('@/lib/formulations/recipeApproval').RecipeNormBase
      batchSize?: number
      note?: string
    }): { ok: true; versionId: string } | { ok: false; error: string } {
      let result: { ok: true; versionId: string } | { ok: false; error: string } = {
        ok: false,
        error: 'unknown',
      }
      const actor = actorFromGetter(getActor)
      setStore((s) => {
        const user = s.access.users.find((u) => u.id === actor.actorId)
        if (!canEditRecipeDraft(user ?? null)) {
          result = { ok: false, error: RECIPE_EDIT_FORBIDDEN }
          return s
        }
        const out = createDraftRecipeVersion(s.formulations, {
          ...input,
          actor: { id: actor.actorId, name: actor.actorName },
        })
        if ('error' in out) {
          result = { ok: false, error: out.error }
          return s
        }
        result = { ok: true, versionId: out.version.id }
        return { ...s, formulations: out.store }
      })
      return result
    },

    updateDraftFormulationRecipeVersion(
      versionId: string,
      patch: Partial<
        Pick<
          import('@/lib/formulations/recipeApproval').FormulationRecipeVersion,
          'components' | 'normBase' | 'batchSize' | 'note' | 'effectiveFrom' | 'effectiveTo'
        >
      >,
    ): { ok: true } | { ok: false; error: string } {
      let result: { ok: true } | { ok: false; error: string } = { ok: false, error: 'unknown' }
      const actor = actorFromGetter(getActor)
      setStore((s) => {
        const user = s.access.users.find((u) => u.id === actor.actorId)
        if (!canEditRecipeDraft(user ?? null)) {
          result = { ok: false, error: RECIPE_EDIT_FORBIDDEN }
          return s
        }
        const out = updateDraftRecipeVersion(s.formulations, versionId, patch)
        if ('error' in out) {
          result = { ok: false, error: out.error }
          return s
        }
        result = { ok: true }
        return { ...s, formulations: out.store }
      })
      return result
    },

    approveFormulationRecipeVersion(
      versionId: string,
      opts?: { reason?: string },
    ): { ok: true } | { ok: false; error: string } {
      let result: { ok: true } | { ok: false; error: string } = { ok: false, error: 'unknown' }
      const actor = actorFromGetter(getActor)
      setStore((s) => {
        const user = s.access.users.find((u) => u.id === actor.actorId)
        const out = approveRecipeVersion(
          s.formulations,
          versionId,
          {
            id: actor.actorId,
            name: actor.actorName,
            roleId: user?.roleId,
          },
          s.access,
          opts,
        )
        if ('error' in out) {
          result = { ok: false, error: out.error }
          return s
        }
        result = { ok: true }
        const withFormulations = { ...s, formulations: out.store }
        return appendAudit(withFormulations, {
          action: 'directory_change',
          detail: out.auditDetail,
          by: actor.actorId,
          byName: actor.actorName,
        })
      })
      return result
    },
  }
}
