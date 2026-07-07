import { normalizeCounterparty, normalizeCounterpartyStore } from '@/lib/counterparties/init'
import type { Counterparty } from '@/lib/counterparties/types'
import { appendAudit } from '@/lib/audit'
import {
  normalizeFinishedProduct,
  normalizeFinishedProductStore,
} from '@/lib/finishedProducts/init'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { withRegisteredGrammage } from '@/lib/formulations/grammages'
import {
  normalizeFormulationRecipe,
  normalizeFormulationStore,
} from '@/lib/formulations/init'
import type { FormulationRecipe } from '@/lib/formulations/types'
import {
  normalizePackagingRecipe,
  normalizePackagingRecipeStore,
} from '@/lib/packaging/init'
import type { PackagingRecipe } from '@/lib/packaging/types'
import type { StoreSliceDeps } from '../storeApi'

export function createDirectoriesSlice({ setStore }: StoreSliceDeps) {
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
        })
        return next
      })
    },

    removeCounterparty(id: string) {
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
          })
        }
        return next
      })
    },

    upsertFinishedProduct(entry: FinishedProduct) {
      const normalized = normalizeFinishedProduct({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.finishedProducts.items.some((p) => p.id === normalized.id)
        const items = exists
          ? s.finishedProducts.items.map((p) => (p.id === normalized.id ? normalized : p))
          : [...s.finishedProducts.items, normalized]
        const nextCode = exists ? s.finishedProducts.nextCode : s.finishedProducts.nextCode + 1
        let next = {
          ...s,
          finishedProducts: normalizeFinishedProductStore({ items, nextCode }),
        }
        next = appendAudit(next, {
          action: 'finished_product_upsert',
          detail: `${exists ? 'Изменена' : 'Создана'} ГП: ${normalized.name} (${normalized.code})`,
        })
        return next
      })
    },

    removeFinishedProduct(id: string) {
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
          packagingRecipes: normalizePackagingRecipeStore({ items, nextCode }),
        }
      })
    },

    removePackagingRecipe(id: string) {
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
  }
}
