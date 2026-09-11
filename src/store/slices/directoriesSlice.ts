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
  componentsFromLegacyRecipe,
  createDraftRecipeVersion,
  listRecipeVersions,
  updateDraftRecipeVersion,
  validateRecipeBomForVersion,
} from '@/lib/formulations/recipeApproval'
import {
  assertCanApproveRecipe,
  assertCanEditRecipe,
  assertCanSubmitRecipe,
  type RecipeSessionActor,
} from '@/lib/formulations/recipeAuth'
import {
  normalizeBoxRecipe,
  normalizePackagingRecipe,
  normalizePackagingRecipeStore,
} from '@/lib/packaging/init'
import type { BoxRecipe, PackagingRecipe } from '@/lib/packaging/types'
import { actorAuditFields } from './actorAuditFields'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import type { StoreSliceDeps } from '../storeApi'
import { isG5MasterDataActive } from '@/lib/planner/g5Activation'

export function createDirectoriesSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)
  const recipeSession = (): RecipeSessionActor => {
    const a = getActor?.()
    return { id: a?.id, name: a?.name, login: a?.login }
  }

  /**
   * Private reducer for an already-authorized recipe upsert.
   * Not exported — callers must go through upsertFormulationRecipe (auth gate).
   */
  function applyAuthorizedFormulationRecipeUpsert(
    s: import('@/lib/types').AppStore,
    normalized: FormulationRecipe,
  ): import('@/lib/types').AppStore {
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
  }

  const slice = {
    async upsertCounterparty(entry: Counterparty) {
      const normalized = normalizeCounterparty({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })

      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const role = normalized.role
          const run = async (commandType: 'masterdata.customer.upsert' | 'masterdata.supplier.upsert') => {
            const conf = await executeG5Command({
              idempotencyKey: `g5-cp-${commandType}-${normalized.id}-${normalized.updatedAt}`,
              commandType,
              command: {
                id: normalized.id,
                code: normalized.code,
                name: normalized.name,
                active: normalized.active,
              },
            })
            if (!conf.ok) {
              throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
            }
            return conf.data
          }
          let ack =
            role === 'supplier'
              ? await run('masterdata.supplier.upsert')
              : await run('masterdata.customer.upsert')
          if (role === 'both') {
            ack = { ...ack, ...(await run('masterdata.supplier.upsert')) }
          }
          setStore((s) => mirrorG5Ack(s, ack), { origin: 'system' })
          return
        }
      }

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

    async removeCounterparty(id: string) {
      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const cp = getStore().counterparties.items.find((c) => c.id === id)
          const role = cp?.role
          const run = async (commandType: 'masterdata.customer.archive' | 'masterdata.supplier.archive') => {
            const conf = await executeG5Command({
              idempotencyKey: `g5-cp-archive-${commandType}-${id}-${Date.now()}`,
              commandType,
              command: { id },
            })
            if (!conf.ok) {
              throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
            }
            return conf.data
          }
          let ack =
            role === 'supplier'
              ? await run('masterdata.supplier.archive')
              : await run('masterdata.customer.archive')
          if (role === 'both') {
            ack = { ...ack, ...(await run('masterdata.supplier.archive')) }
          }
          setStore((s) => mirrorG5Ack(s, ack), { origin: 'system' })
          return
        }
      }

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

    async upsertFinishedProduct(entry: FinishedProduct) {
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

      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const conf = await executeG5Command({
            idempotencyKey: `g5-fp-${normalized.id}-${normalized.updatedAt}`,
            commandType: 'masterdata.product.upsert',
            command: {
              id: normalized.id,
              code: normalized.code,
              name: normalized.name,
              active: normalized.active,
              warehouseItemId: normalized.warehouseItemId,
              formulationRecipeId: normalized.defaultFormulationRecipeId,
              packagingBomId: normalized.defaultPackagingRecipeId,
            },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

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

    async removeFinishedProduct(id: string) {
      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const conf = await executeG5Command({
            idempotencyKey: `g5-fp-archive-${id}-${Date.now()}`,
            commandType: 'masterdata.product.archive',
            command: { id },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

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

    async upsertPackagingRecipe(entry: PackagingRecipe) {
      const normalized = normalizePackagingRecipe({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })

      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const { packagingRecipeToBomComponents } = await import('@/lib/planner/g5PackagingBom')
          const store = getStore()
          const finishedProductId =
            String(
              (entry as PackagingRecipe & { finishedProductId?: string }).finishedProductId ?? '',
            ).trim() ||
            store.finishedProducts.items.find((p) => p.defaultPackagingRecipeId === normalized.id)
              ?.id
          const components = packagingRecipeToBomComponents(
            entry as PackagingRecipe & {
              components?: Array<{
                itemId: string
                quantity: number
                unit: string
                warehouseItemId?: string
                conversionFactor?: number
                wasteFactor?: number
                note?: string
              }>
            },
          )
          const conf = await executeG5Command({
            idempotencyKey: `g5-bom-${normalized.id}-${normalized.updatedAt}`,
            commandType: 'masterdata.bom.upsert',
            command: {
              id: normalized.id,
              packagingBomId: normalized.id,
              code: normalized.code,
              name: normalized.name,
              active: normalized.active,
              finishedProductId,
              baseOutputQty: 1,
              components: components.map((c) => ({
                itemId: c.itemId,
                warehouseItemId: c.warehouseItemId ?? c.itemId,
                quantity: c.quantity,
                qty: c.quantity,
                unit: c.unit,
                ...(c.conversionFactor != null ? { conversionFactor: c.conversionFactor } : {}),
                ...(c.wasteFactor != null ? { wasteFactor: c.wasteFactor } : {}),
                ...(c.note ? { note: c.note } : {}),
              })),
            },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

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

    async approvePackagingBom(id: string) {
      if (!isG5MasterDataActive(getStore())) {
        throw new Error('g5.error.masterdata_inactive')
      }
      const { isG5WebPath, g5MasterdataBomApprove, mirrorG5AckIfOk } = await import(
        '@/lib/planner/g5ServerClient'
      )
      if (!isG5WebPath()) {
        throw new Error('g5.error.use_g5_gateway')
      }
      const conf = await g5MasterdataBomApprove({
        idempotencyKey: `g5-bom-approve-${id}-${Date.now()}`,
        command: { id, packagingBomId: id },
      })
      if (!conf.ok) {
        throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
      }
      setStore((s) => {
        const next = mirrorG5AckIfOk(s, conf)
        return next ?? s
      }, { origin: 'system' })
    },

    async removePackagingRecipe(id: string) {
      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, executeG5Command, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const conf = await executeG5Command({
            idempotencyKey: `g5-bom-archive-${id}-${Date.now()}`,
            commandType: 'masterdata.bom.archive',
            command: { id },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }
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

    /**
     * Authorized create/update of a formulation recipe row.
     * Uses the same recipeAuth decision as draft version create/submit.
     */
    upsertFormulationRecipe(
      entry: FormulationRecipe,
    ): { ok: true } | { ok: false; error: string } {
      const session = recipeSession()
      let result: { ok: true } | { ok: false; error: string } = {
        ok: false,
        error: 'unknown',
      }
      const normalized = normalizeFormulationRecipe({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const auth = assertCanEditRecipe(s.access, session)
        if (!auth.ok) {
          result = { ok: false, error: auth.error }
          return s
        }
        result = { ok: true }
        return applyAuthorizedFormulationRecipeUpsert(s, normalized)
      })
      return result
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
      sourceRecipeUpdatedAt?: string
    }): { ok: true; versionId: string } | { ok: false; error: string } {
      let result: { ok: true; versionId: string } | { ok: false; error: string } = {
        ok: false,
        error: 'unknown',
      }
      const session = recipeSession()
      setStore((s) => {
        const auth = assertCanEditRecipe(s.access, session)
        if (!auth.ok) {
          result = { ok: false, error: auth.error }
          return s
        }
        const out = createDraftRecipeVersion(s.formulations, {
          ...input,
          // Preserve authenticated session identity (Firebase UID), not remapped store id.
          actor: { id: session.id, name: session.name ?? auth.user.displayName },
        })
        if ('error' in out) {
          result = { ok: false, error: out.error }
          return s
        }
        const next = { ...s, formulations: out.store }
        if (!listRecipeVersions(next.formulations, input.recipeId).some((v) => v.id === out.version.id)) {
          result = { ok: false, error: 'formulations.recipe.errNotFound' }
          return s
        }
        result = { ok: true, versionId: out.version.id }
        return next
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
      const session = recipeSession()
      setStore((s) => {
        const auth = assertCanEditRecipe(s.access, session)
        if (!auth.ok) {
          result = { ok: false, error: auth.error }
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
      const session = recipeSession()
      setStore((s) => {
        const auth = assertCanApproveRecipe(s.access, session, opts)
        if (!auth.ok) {
          result = { ok: false, error: auth.error }
          return s
        }
        const out = approveRecipeVersion(
          s.formulations,
          versionId,
          {
            id: session.id,
            name: session.name ?? auth.user.displayName,
            roleId: auth.user.roleId,
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
          by: session.id,
          byName: session.name ?? auth.user.displayName,
        })
      })
      return result
    },

    /**
     * Create a draft version from the current legacy recipe row and optionally approve it.
     * Used by technologist UI (submit / approve path).
     */
    submitFormulationRecipeVersion(
      recipeId: string,
      opts?: { approve?: boolean; reason?: string },
    ): { ok: true; versionId: string; approved: boolean } | { ok: false; error: string } {
      const s0 = getStore()
      const session = recipeSession()
      const submitAuth = assertCanSubmitRecipe(s0.access, session)
      if (!submitAuth.ok) return { ok: false, error: submitAuth.error }

      const recipe = s0.formulations.recipes.find((r) => r.id === recipeId)
      if (!recipe) return { ok: false, error: 'formulations.recipe.errNotFound' }

      const bom = validateRecipeBomForVersion(recipe)
      if (!bom.ok) return { ok: false, error: bom.error }

      const itemsById = new Map(s0.warehouse.items.map((i) => [i.id, i]))
      const components = componentsFromLegacyRecipe(recipe, (id) => {
        const item = itemsById.get(id)
        return item
          ? {
              code: item.sku?.trim() || item.internalCode,
              name: item.name,
              unit: item.unit,
            }
          : undefined
      })
      const stockLineCount = recipe.components.filter(
        (c) => !(c.isWater === true || c.name?.trim().toLowerCase() === 'вода'),
      ).length
      const versionStockCount = components.filter((c) => !c.isWater).length
      if (versionStockCount !== stockLineCount || versionStockCount === 0) {
        return { ok: false, error: 'formulations.recipe.errComponents' }
      }

      const draft = slice.createDraftFormulationRecipeVersion({
        recipeId,
        components,
        normBase: 'per_batch',
        batchSize: bom.batchSize,
        note: opts?.approve ? 'submit+approve' : 'submit-for-review',
        sourceRecipeUpdatedAt: recipe.updatedAt,
      })
      if (!draft.ok) return draft

      const after = getStore()
      if (
        !listRecipeVersions(after.formulations, recipeId).some((v) => v.id === draft.versionId)
      ) {
        return { ok: false, error: 'formulations.recipe.errNotFound' }
      }

      if (!opts?.approve) {
        return { ok: true, versionId: draft.versionId, approved: false }
      }
      const approved = slice.approveFormulationRecipeVersion(draft.versionId, {
        reason: opts.reason,
      })
      if (!approved.ok) {
        return { ok: false, error: approved.error }
      }
      return { ok: true, versionId: draft.versionId, approved: true }
    },
  }
  return slice
}
