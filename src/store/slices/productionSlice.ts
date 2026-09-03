import { canActivateProductionOrder } from '@/lib/planner/activateGate'
import {
  buildNormSnapshotFromVersion,
  getApprovedRecipeVersion,
} from '@/lib/formulations/recipeApproval'
import { normalizeProductionOrder, normalizePlanner } from '@/lib/planner/init'
import {
  historyNoteForReserve,
  historyNoteForUnreserve,
  reserveOrderMaterialsInStore,
  unreserveOrderMaterialsInStore,
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
import { applyProductionPostToSales } from '@/lib/sales/productionSync'
import type { ProductionRequest } from '@/lib/production/types'
import {
  confirmProductionShiftReport as confirmShiftReportCore,
  confirmShiftReportCorrection as confirmShiftCorrectionCore,
  type ConfirmShiftReportResult,
} from '@/lib/production/shiftReports'
import {
  captureLegacyNormSnapshot,
} from '@/lib/formulations/recipeApproval'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { warehouseTransactionGroupId } from '@/lib/cloud/transactionGroups'
import {
  reallocateProductionReservation,
  syncReservationAfterOrderChange,
  type ProductionReservationResult,
  type ReallocateReservationInput,
} from '@/lib/warehouse/productionReservations'
import type { StoreSliceDeps } from '../storeApi'

export function createProductionSlice({ setStore, getActor }: StoreSliceDeps) {
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
      const groupId = warehouseTransactionGroupId({
        kind: 'production_reservation_adjustment',
        sourceId: normalized.id,
        revision: `upsert:${normalized.updatedAt}`,
      })
      setStore(
        (s) => {
          const prev = s.production.planner.orders.find((o) => o.id === normalized.id)
          const exists = Boolean(prev)
          const orders = exists
            ? s.production.planner.orders.map((o) =>
                o.id === normalized.id ? normalized : o,
              )
            : [...s.production.planner.orders, normalized]
          let warehouse = s.warehouse
          if (
            prev &&
            (prev.status === 'active' ||
              prev.status === 'paused' ||
              normalized.status === 'cancelled')
          ) {
            const actor = actorFromGetter(getActor)
            const synced = syncReservationAfterOrderChange(warehouse, prev, normalized, {
              actor: actor.actorId
                ? { id: actor.actorId, name: actor.actorName }
                : undefined,
              transactionGroupId: groupId,
            })
            warehouse = synced.store
          }
          return {
            ...s,
            warehouse,
            production: {
              ...s.production,
              planner: normalizePlanner({ ...s.production.planner, orders }),
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation_adjustment',
          transactionGroupLabel: 'Корректировка резерва производственного заказа',
        },
      )
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
      recordSliceExplicitDelete('production.planner.orders', id, actorFromGetter(getActor))
      const groupId = warehouseTransactionGroupId({
        kind: 'production_reservation_release',
        sourceId: id,
        revision: 'remove',
      })
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === id)
          let warehouse = s.warehouse
          if (order) {
            const actor = actorFromGetter(getActor)
            const released = unreserveOrderMaterialsInStore(order, warehouse, {
              actor: actor.actorId
                ? { id: actor.actorId, name: actor.actorName }
                : undefined,
              transactionGroupId: groupId,
              reason: 'order_removed',
            })
            warehouse = released.store
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
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation_release',
          transactionGroupLabel: 'Освобождение резерва при удалении заказа',
        },
      )
    },

    activateProductionOrder(id: string): { ok: boolean; messageKey?: string } {
      let result: { ok: boolean; messageKey?: string } = {
        ok: false,
        messageKey: 'planner.material.noOrder',
      }
      const groupId = warehouseTransactionGroupId({
        kind: 'production_reservation',
        sourceId: id,
        revision: 'activate',
      })
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === id)
          if (!order) return s

          const gate = canActivateProductionOrder(order, s.formulations)
          if (!gate.ok) {
            result = { ok: false, messageKey: gate.messageKey }
            return s
          }

          // P1B — freeze recipe norm snapshot from approved version if missing
          let recipeNormSnapshot = order.recipeNormSnapshot
          if (!recipeNormSnapshot && order.formulationRecipeId) {
            const approved = getApprovedRecipeVersion(
              s.formulations,
              order.formulationRecipeId,
            )
            if (approved) {
              recipeNormSnapshot = buildNormSnapshotFromVersion(approved)
            }
          }

          const seq = s.production.planner.nextOrderSeq
          const year = new Date().getFullYear()
          const actor = actorFromGetter(getActor)
          const orderNumber = order.orderNumber || formatOrderNumber(year, seq)
          const base = {
            ...order,
            orderNumber,
            status: 'active' as const,
            ...(recipeNormSnapshot ? { recipeNormSnapshot } : {}),
          }
          const dayPlans =
            base.planMode === 'even' || !base.dayPlans.length
              ? generateEvenDayPlans(base)
              : base.dayPlans
          let activated = normalizeProductionOrder({
            ...base,
            dayPlans,
            history: [
              ...order.history,
              {
                id: newId(),
                at: new Date().toISOString(),
                type: 'activated' as const,
                message: `Заказ активирован, план на ${dayPlans.length} дн.`,
              },
            ],
            updatedAt: new Date().toISOString(),
          })

          const reserved = reserveOrderMaterialsInStore(activated, s.warehouse, {
            actor: actor.actorId
              ? { id: actor.actorId, name: actor.actorName }
              : undefined,
            transactionGroupId: groupId,
          })
          if (reserved.result.ok && reserved.result.lines.some((l) => l.reserved > 0)) {
            const note = historyNoteForReserve(reserved.result.lines)
            activated = normalizeProductionOrder({
              ...activated,
              history: [
                ...activated.history,
                {
                  id: newId(),
                  at: new Date().toISOString(),
                  type: 'note' as const,
                  message: note,
                },
              ],
              updatedAt: new Date().toISOString(),
            })
          } else if (!reserved.result.ok && reserved.result.messageKey) {
            activated = normalizeProductionOrder({
              ...activated,
              history: [
                ...activated.history,
                {
                  id: newId(),
                  at: new Date().toISOString(),
                  type: 'note' as const,
                  message: `Резерв не выполнен: ${reserved.result.messageKey}`,
                },
              ],
              updatedAt: new Date().toISOString(),
            })
          }

          const orders = s.production.planner.orders.map((o) =>
            o.id === id ? activated : o,
          )
          result = { ok: true }
          return {
            ...s,
            warehouse: reserved.store,
            production: {
              ...s.production,
              planner: {
                orders,
                nextOrderSeq: seq + 1,
              },
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation',
          transactionGroupLabel: 'Активация заказа + резерв материалов',
        },
      )
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
      recordSliceExplicitDelete('production.requests', id, actorFromGetter(getActor))
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
          s.packagingRecipes,
          s.formulations.recipes,
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
        let next = {
          ...s,
          warehouse: post.store,
          production: {
            ...s.production,
            requests,
            planner: { ...s.production.planner, orders },
          },
        }
        next = applyProductionPostToSales(next, updated)
        return next
      }, {
        origin: 'user',
        atomic: true,
        transactionGroupId: warehouseTransactionGroupId({
          kind: 'production_request',
          sourceId: id,
          revision: 'post',
        }),
        transactionGroupKind: 'production_request',
        transactionGroupLabel: 'Проведение заявки производства',
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
      const groupId = warehouseTransactionGroupId({
        kind: 'production_reservation',
        sourceId: orderId,
        revision: 'manual-reserve',
      })
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === orderId)
          if (!order) return s
          const actor = actorFromGetter(getActor)
          const out = reserveOrderMaterialsInStore(order, s.warehouse, {
            actor: actor ? { id: actor.actorId, name: actor.actorName } : undefined,
            transactionGroupId: groupId,
          })
          result = out.result
          if (!out.result.ok) return s
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
                      message: historyNoteForReserve(out.result.lines),
                    },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : o,
          )
          return {
            ...s,
            warehouse: out.store,
            production: {
              ...s.production,
              planner: { ...s.production.planner, orders },
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation',
          transactionGroupLabel: 'Резерв материалов производственного заказа',
        },
      )
      return result
    },

    unreserveProductionOrderMaterials(orderId: string): boolean {
      let done = false
      const groupId = warehouseTransactionGroupId({
        kind: 'production_reservation_release',
        sourceId: orderId,
        revision: 'manual-release',
      })
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === orderId)
          if (!order) return s
          const actor = actorFromGetter(getActor)
          const out = unreserveOrderMaterialsInStore(order, s.warehouse, {
            actor: actor ? { id: actor.actorId, name: actor.actorName } : undefined,
            transactionGroupId: groupId,
            reason: 'manual_unreserve',
          })
          if (!out.result.ok && !out.result.documentId) return s
          done = true
          const note = historyNoteForUnreserve(order)
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
            warehouse: out.store,
            production: {
              ...s.production,
              planner: { ...s.production.planner, orders },
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation_release',
          transactionGroupLabel: 'Освобождение резерва производственного заказа',
        },
      )
      return done
    },

    reallocateProductionOrderReservation(
      input: ReallocateReservationInput,
    ): ProductionReservationResult {
      let result: ProductionReservationResult = {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: 'planner.material.noOrder',
      }
      const groupId =
        input.idempotencyKey ||
        warehouseTransactionGroupId({
          kind: 'production_reservation_reallocation',
          sourceId: `${input.sourceProductionOrderId}->${input.targetProductionOrderId}`,
          revision: '1',
        })
      setStore(
        (s) => {
          const source = s.production.planner.orders.find(
            (o) => o.id === input.sourceProductionOrderId,
          )
          const target = s.production.planner.orders.find(
            (o) => o.id === input.targetProductionOrderId,
          )
          if (!source || !target) return s
          const out = reallocateProductionReservation(s.warehouse, source, target, {
            ...input,
            idempotencyKey: groupId,
          })
          result = out.result
          if (!out.result.ok) return s
          return { ...s, warehouse: out.store }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_reservation_reallocation',
          transactionGroupLabel: 'Перераспределение резерва материалов',
        },
      )
      return result
    },

    confirmProductionShiftReport(input: {
      report: import('@/lib/production/shiftReports').ConfirmShiftReportInput['report']
      productionOrderId: string
      idempotencyKey: string
      emergencyReason?: string
    }): ConfirmShiftReportResult {
      let result: ConfirmShiftReportResult = {
        ok: false,
        error: 'unknown',
      }
      const groupId = warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: input.productionOrderId,
        revision: input.idempotencyKey,
      })
      const actor = actorFromGetter(getActor)
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === input.productionOrderId)
          if (!order) {
            result = { ok: false, error: 'planner.material.noOrder' }
            return s
          }
          const out = confirmShiftReportCore(s.production, s.warehouse, {
            report: input.report,
            productionOrder: order,
            actor: {
              id: actor.actorId,
              name: actor.actorName,
              roleId: s.access.users.find((u) => u.id === actor.actorId)?.roleId,
            },
            access: s.access,
            appScope: s,
            idempotencyKey: input.idempotencyKey,
            transactionGroupId: groupId,
            emergencyReason: input.emergencyReason,
          })
          result = out.result
          if (!out.result.ok) return s
          return {
            ...s,
            production: out.production,
            warehouse: out.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_shift_report',
          transactionGroupLabel: 'Сменный производственный отчёт',
        },
      )
      return result
    },

    confirmProductionShiftReportCorrection(input: {
      originalReportId: string
      correctionReason: string
      report: import('@/lib/production/shiftReports').ConfirmShiftReportInput['report']
      productionOrderId: string
      idempotencyKey: string
      emergencyReason?: string
    }): ConfirmShiftReportResult {
      let result: ConfirmShiftReportResult = { ok: false, error: 'unknown' }
      const groupId = warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: `${input.productionOrderId}::corr::${input.originalReportId}`,
        revision: input.idempotencyKey,
      })
      const actor = actorFromGetter(getActor)
      setStore(
        (s) => {
          const order = s.production.planner.orders.find((o) => o.id === input.productionOrderId)
          if (!order) {
            result = { ok: false, error: 'planner.material.noOrder' }
            return s
          }
          const out = confirmShiftCorrectionCore(s.production, s.warehouse, {
            report: input.report,
            productionOrder: order,
            actor: {
              id: actor.actorId,
              name: actor.actorName,
              roleId: s.access.users.find((u) => u.id === actor.actorId)?.roleId,
            },
            access: s.access,
            appScope: s,
            idempotencyKey: input.idempotencyKey,
            transactionGroupId: groupId,
            emergencyReason: input.emergencyReason,
            originalReportId: input.originalReportId,
            correctionReason: input.correctionReason,
          })
          result = out.result
          if (!out.result.ok) return s
          return {
            ...s,
            production: out.production,
            warehouse: out.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_shift_report',
          transactionGroupLabel: 'Исправление сменного отчёта',
        },
      )
      return result
    },

    captureLegacyRecipeNormOnOrder(
      orderId: string,
      reason: string,
    ): { ok: true } | { ok: false; error: string } {
      let result: { ok: true } | { ok: false; error: string } = { ok: false, error: 'unknown' }
      const actor = actorFromGetter(getActor)
      setStore((s) => {
        const order = s.production.planner.orders.find((o) => o.id === orderId)
        if (!order?.formulationRecipeId) {
          result = { ok: false, error: 'planner.material.noOrder' }
          return s
        }
        const recipe = s.formulations.recipes.find((r) => r.id === order.formulationRecipeId)
        if (!recipe) {
          result = { ok: false, error: 'formulations.recipe.errNotFound' }
          return s
        }
        const user = s.access.users.find((u) => u.id === actor.actorId)
        const captured = captureLegacyNormSnapshot(
          recipe,
          { id: actor.actorId, name: actor.actorName, roleId: user?.roleId },
          reason,
          (id) => {
            const item = s.warehouse.items.find((i) => i.id === id)
            return item
              ? { code: item.internalCode, name: item.name, unit: item.unit }
              : undefined
          },
        )
        if ('error' in captured) {
          result = { ok: false, error: captured.error }
          return s
        }
        result = { ok: true }
        return {
          ...s,
          production: {
            ...s.production,
            planner: {
              ...s.production.planner,
              orders: s.production.planner.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...o,
                      recipeNormSnapshot: captured.snapshot,
                      updatedAt: new Date().toISOString(),
                      history: [
                        ...o.history,
                        {
                          id: newId(),
                          at: new Date().toISOString(),
                          type: 'note' as const,
                          message: `Зафиксирована исходная норма (legacy): ${reason}`,
                        },
                      ],
                    }
                  : o,
              ),
            },
          },
        }
      })
      return result
    },
  }
}
