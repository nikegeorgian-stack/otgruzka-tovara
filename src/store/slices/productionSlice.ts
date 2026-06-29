import { canActivateProductionOrder } from '@/lib/planner/activateGate'
import { normalizeProductionOrder, normalizePlanner } from '@/lib/planner/init'
import {
  applyWarehouseMovements,
  buildReserveMovements,
  buildUnreserveMovements,
  historyNoteForReserve,
  historyNoteForUnreserve,
  reserveOrderMaterialsInStore,
  type MaterialReserveResult,
} from '@/lib/planner/materialReserve'
import {
  generateProductionRequestsFromPlanner,
  linkedOrderIdsFromRequest,
  type GeneratePlannerRequestsOptions,
} from '@/lib/planner/generateRequests'
import {
  formatOrderNumber,
  generateEvenDayPlans,
  recalculateOperationalPlans,
} from '@/lib/planner/plan'
import type { ProductionOrder } from '@/lib/planner/types'
import { newId } from '@/lib/production/files'
import { normalizeProductionRequest } from '@/lib/production/init'
import { postProductionRequestToWarehouse } from '@/lib/production/postToWarehouse'
import type { ProductionRequest } from '@/lib/production/types'
import type { StoreSliceDeps } from '../storeApi'

export function createProductionSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertProductionRequest(entry: ProductionRequest) {
      const normalized = normalizeProductionRequest({
        ...entry,
        updatedAt: new Date().toISOString(),
        createdAt: entry.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.production.requests.some((d) => d.id === normalized.id)
        const requests = exists
          ? s.production.requests.map((d) => (d.id === normalized.id ? normalized : d))
          : [...s.production.requests, normalized]

        let orders = s.production.planner.orders
        if (normalized.status === 'posted') {
          const linkedIds = new Set(linkedOrderIdsFromRequest(normalized))
          if (linkedIds.size) {
            orders = orders.map((o) => {
              if (!linkedIds.has(o.id) || o.recalcMode !== 'auto') return o
              return recalculateOperationalPlans(o, requests)
            })
          }
        }

        return {
          ...s,
          production: {
            ...s.production,
            requests,
            planner: { ...s.production.planner, orders },
          },
        }
      })
    },

    upsertProductionOrder(order: ProductionOrder) {
      const normalized = normalizeProductionOrder({
        ...order,
        updatedAt: new Date().toISOString(),
        createdAt: order.createdAt || new Date().toISOString(),
      })
      setStore((s) => {
        const exists = s.production.planner.orders.some((o) => o.id === normalized.id)
        const orders = exists
          ? s.production.planner.orders.map((o) =>
              o.id === normalized.id ? normalized : o,
            )
          : [...s.production.planner.orders, normalized]
        return {
          ...s,
          production: {
            ...s.production,
            planner: normalizePlanner({ ...s.production.planner, orders }),
          },
        }
      })
    },

    /** Назначить рецептуру пропитки на произв. заказ (технолог) */
    assignProductionOrderFormulationRecipe(
      orderId: string,
      recipeId: string,
      assignedByName?: string,
    ): boolean {
      let ok = false
      setStore((s) => {
        const recipe = s.formulations.recipes.find((r) => r.id === recipeId && r.active)
        if (!recipe) return s
        const order = s.production.planner.orders.find((o) => o.id === orderId)
        if (!order || order.formulationRecipeStatus !== 'requested') return s
        ok = true
        const now = new Date().toISOString()
        const orders = s.production.planner.orders.map((o) =>
          o.id === orderId
            ? normalizeProductionOrder({
                ...o,
                formulationRecipeId: recipe.id,
                formulationRecipeStatus: 'assigned',
                updatedAt: now,
                history: [
                  ...o.history,
                  {
                    id: newId(),
                    at: now,
                    type: 'note' as const,
                    message: `Рецептура ${recipe.code} назначена${assignedByName ? ` (${assignedByName})` : ''}`,
                  },
                ],
              })
            : o,
        )
        return {
          ...s,
          production: {
            ...s.production,
            planner: normalizePlanner({ ...s.production.planner, orders }),
          },
        }
      })
      return ok
    },

    removeProductionOrder(id: string) {
      setStore((s) => {
        const order = s.production.planner.orders.find((o) => o.id === id)
        let warehouse = s.warehouse
        if (order) {
          const unreserve = buildUnreserveMovements(order, warehouse)
          if (unreserve.length) {
            warehouse = applyWarehouseMovements(warehouse, unreserve)
          }
        }
        return {
          ...s,
          warehouse,
          production: {
            ...s.production,
            requests: s.production.requests.map((r) =>
              r.orderId === id ? { ...r, orderId: undefined } : r,
            ),
            planner: {
              ...s.production.planner,
              orders: s.production.planner.orders.filter((o) => o.id !== id),
            },
          },
        }
      })
    },

    activateProductionOrder(id: string): { ok: boolean; messageKey?: string } {
      let result: { ok: boolean; messageKey?: string } = {
        ok: false,
        messageKey: 'planner.material.noOrder',
      }
      setStore((s) => {
        const order = s.production.planner.orders.find((o) => o.id === id)
        if (!order) return s

        const gate = canActivateProductionOrder(order)
        if (!gate.ok) {
          result = { ok: false, messageKey: gate.messageKey }
          return s
        }

        const seq = s.production.planner.nextOrderSeq
        const year = new Date().getFullYear()
        const orders = s.production.planner.orders.map((o) => {
          if (o.id !== id) return o
          const orderNumber = o.orderNumber || formatOrderNumber(year, seq)
          const base = { ...o, orderNumber, status: 'active' as const }
          const dayPlans =
            base.planMode === 'even' || !base.dayPlans.length
              ? generateEvenDayPlans(base)
              : base.dayPlans
          const withPlans = {
            ...base,
            dayPlans,
            history: [
              ...o.history,
              {
                id: newId(),
                at: new Date().toISOString(),
                type: 'activated' as const,
                message: `Заказ активирован, план на ${dayPlans.length} дн.`,
              },
            ],
            updatedAt: new Date().toISOString(),
          }
          return normalizeProductionOrder(withPlans)
        })
        result = { ok: true }
        return {
          ...s,
          production: {
            ...s.production,
            planner: {
              orders,
              nextOrderSeq: orders.some((o) => o.id === id) ? seq + 1 : seq,
            },
          },
        }
      })
      return result
    },

    recalculateProductionOrder(id: string) {
      setStore((s) => {
        const orders = s.production.planner.orders.map((o) => {
          if (o.id !== id) return o
          const updated = recalculateOperationalPlans(o, s.production.requests)
          return {
            ...updated,
            history: [
              ...updated.history,
              {
                id: newId(),
                at: new Date().toISOString(),
                type: 'plan_recalc' as const,
                message: 'Ручной пересчёт оперативного плана',
              },
            ],
          }
        })
        return {
          ...s,
          production: {
            ...s.production,
            planner: { ...s.production.planner, orders },
          },
        }
      })
    },

    removeProductionRequest(id: string) {
      setStore((s) => ({
        ...s,
        production: {
          ...s.production,
          requests: s.production.requests.filter((d) => d.id !== id),
        },
      }))
    },

    postProductionRequest(id: string, postedBy?: string) {
      let result = {
        ok: false as boolean,
        messageKey: 'production.post.unknown' as string | undefined,
      }
      setStore((s) => {
        const req = s.production.requests.find((r) => r.id === id)
        if (!req) return s
        if (req.status === 'posted') {
          result = { ok: false, messageKey: 'production.post.already' }
          return s
        }
        if (req.status !== 'saved') {
          result = { ok: false, messageKey: 'production.post.notSaved' }
          return s
        }

        const post = postProductionRequestToWarehouse(
          s.warehouse,
          req,
          s.production.planner.orders,
          s.finishedProducts.items,
        )
        if (!post.ok) {
          result = { ok: false, messageKey: post.messageKey }
          return s
        }

        const now = new Date().toISOString()
        const updated = normalizeProductionRequest({
          ...req,
          status: 'posted',
          postedAt: now,
          postedBy,
          updatedAt: now,
        })

        const requests = s.production.requests.map((r) =>
          r.id === id ? updated : r,
        )

        let orders = s.production.planner.orders
        const linkedIds = new Set(
          (updated.orderId ? [updated.orderId] : []).concat(
            updated.planSegments.map((seg) => seg.orderId).filter(Boolean) as string[],
          ),
        )
        if (linkedIds.size) {
          orders = orders.map((o) => {
            if (!linkedIds.has(o.id) || o.recalcMode !== 'auto') return o
            return recalculateOperationalPlans(o, requests)
          })
        }

        result = { ok: true, messageKey: undefined }
        return {
          ...s,
          warehouse: post.store,
          production: {
            ...s.production,
            requests,
            planner: { ...s.production.planner, orders },
          },
        }
      })
      return result
    },

    generatePlannerProductionRequests(
      opts: Omit<
        GeneratePlannerRequestsOptions,
        'orders' | 'requests' | 'employees' | 'brigades' | 'monthSheet'
      >,
    ) {
      let result!: ReturnType<typeof generateProductionRequestsFromPlanner>
      setStore((s) => {
        result = generateProductionRequestsFromPlanner({
          ...opts,
          orders: s.production.planner.orders,
          requests: s.production.requests,
          employees: s.employees,
          brigades: s.brigades,
          monthSheet: s.months[opts.date.slice(0, 7)] ?? null,
          packagingRecipes: s.packagingRecipes.items,
          locale: s.settings.locale,
        })
        return {
          ...s,
          production: {
            ...s.production,
            requests: result.requests,
          },
        }
      })
      return result
    },

    reserveProductionOrderMaterials(orderId: string): MaterialReserveResult {
      let result: MaterialReserveResult = {
        ok: false,
        lines: [],
        messageKey: 'planner.material.noOrder',
      }
      setStore((s) => {
        const order = s.production.planner.orders.find((o) => o.id === orderId)
        if (!order) return s
        result = reserveOrderMaterialsInStore(order, s.warehouse)
        if (!result.ok) return s
        const { movements } = buildReserveMovements(order, s.warehouse)
        const warehouse = applyWarehouseMovements(s.warehouse, movements)
        const orders = s.production.planner.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                history: [
                  ...o.history,
                  {
                    id: newId(),
                    at: new Date().toISOString(),
                    type: 'note' as const,
                    message: historyNoteForReserve(result.lines),
                  },
                ],
                updatedAt: new Date().toISOString(),
              }
            : o,
        )
        return {
          ...s,
          warehouse,
          production: {
            ...s.production,
            planner: { ...s.production.planner, orders },
          },
        }
      })
      return result
    },

    unreserveProductionOrderMaterials(orderId: string): boolean {
      let done = false
      setStore((s) => {
        const order = s.production.planner.orders.find((o) => o.id === orderId)
        if (!order) return s
        const movements = buildUnreserveMovements(order, s.warehouse)
        if (!movements.length) return s
        done = true
        const warehouse = applyWarehouseMovements(s.warehouse, movements)
        const note = historyNoteForUnreserve(order, s.warehouse)
        const orders = s.production.planner.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                history: [
                  ...o.history,
                  {
                    id: newId(),
                    at: new Date().toISOString(),
                    type: 'note' as const,
                    message: note,
                  },
                ],
                updatedAt: new Date().toISOString(),
              }
            : o,
        )
        return {
          ...s,
          warehouse,
          production: {
            ...s.production,
            planner: { ...s.production.planner, orders },
          },
        }
      })
      return done
    },
  }
}
