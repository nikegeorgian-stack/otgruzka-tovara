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
  confirmProductionPackagingReport as confirmPackagingReportCore,
  confirmPackagingReportCorrection as confirmPackagingReportCorrectionCore,
  listAvailableWipAtPackaging,
  nextPackagingReportNumber,
  type ConfirmPackagingReportInput,
  type ProductionPackagingReport,
} from '@/lib/production/packagingReports'
import { listPendingQcLots, type FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import {
  applyRejectTransferToScrap,
  releaseFinishedGoodsLot,
  applyServerQcReleaseMirror,
  rejectFinishedGoodsLot,
  requestRegrade,
  startQcReview as startQcReviewCore,
  type ApplyRejectTransferInput,
  type ReleaseFinishedGoodsLotInput,
  type RejectFinishedGoodsLotInput,
  type RequestRegradeInput,
} from '@/lib/production/qcRelease'
import type {
  QcAttachmentStorageAdapter,
  QcAttachmentUploadInput,
  QcLotAttachment,
} from '@/lib/production/qcAttachments'
import { resolveQcAttachmentAdapter } from '@/lib/production/qcAttachments'
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

function upsertReportById<T extends { id: string }>(rows: T[] | undefined, row: T): T[] {
  const list = rows ? [...rows] : []
  const idx = list.findIndex((item) => item.id === row.id)
  if (idx >= 0) {
    list[idx] = row
    return list
  }
  return [...list, row]
}

let qcAttachmentAdapter: QcAttachmentStorageAdapter = resolveQcAttachmentAdapter()

export function setQcAttachmentAdapterForTests(adapter?: QcAttachmentStorageAdapter) {
  qcAttachmentAdapter = adapter ?? resolveQcAttachmentAdapter()
}

export function createProductionSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
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
      // Draft create/edit only touches production.planner.orders — do not stamp a
      // warehouse::production_reservation_adjustment atomic group (R29L: that
      // mislabel caused domain_conflict banners on every planner Save / Activate).
      const prevSnap = getStore().production.planner.orders.find((o) => o.id === order.id)
      const needsReservationAdjustment =
        Boolean(prevSnap) &&
        (prevSnap!.status === 'active' ||
          prevSnap!.status === 'paused' ||
          order.status === 'cancelled')
      const groupId = needsReservationAdjustment
        ? warehouseTransactionGroupId({
            kind: 'production_reservation_adjustment',
            sourceId: order.id,
            revision: `upsert:${order.updatedAt || Date.now()}`,
          })
        : undefined
      setStore(
        (s) => {
          const year = new Date().getFullYear()
          let nextSeq = Math.max(1, Number(s.production.planner.nextOrderSeq) || 1)
          for (const o of s.production.planner.orders) {
            const m = o.orderNumber?.match(/ЗП-(\d{4})-(\d+)/)
            if (m && Number(m[1]) === year) {
              nextSeq = Math.max(nextSeq, Number(m[2]) + 1)
            }
          }
          const hadNumber = Boolean(order.orderNumber?.trim())
          const assignedNumber = hadNumber
            ? order.orderNumber!.trim()
            : formatOrderNumber(year, nextSeq)
          const bumpedSeq = hadNumber ? nextSeq : nextSeq + 1

          const normalized = normalizeProductionOrder({
            ...order,
            orderNumber: assignedNumber,
            updatedAt: new Date().toISOString(),
            createdAt: order.createdAt || new Date().toISOString(),
          })
          const prev = s.production.planner.orders.find((o) => o.id === normalized.id)
          const exists = Boolean(prev)
          const orders = exists
            ? s.production.planner.orders.map((o) =>
                o.id === normalized.id ? normalized : o,
              )
            : [...s.production.planner.orders, normalized]
          let warehouse = s.warehouse
          if (
            groupId &&
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
              planner: normalizePlanner({
                ...s.production.planner,
                orders,
                nextOrderSeq: Math.max(bumpedSeq, s.production.planner.nextOrderSeq ?? 1),
              }),
            },
          }
        },
        needsReservationAdjustment && groupId
          ? {
              origin: 'user',
              atomic: true,
              transactionGroupId: groupId,
              transactionGroupKind: 'production_reservation_adjustment',
              transactionGroupLabel: 'Корректировка резерва производственного заказа',
            }
          : { origin: 'user' },
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

    async activateProductionOrder(id: string): Promise<{ ok: boolean; messageKey?: string; error?: string }> {
      const { isG3WebAuthoritativePath, g3ProductionCommand, mirrorG3Ack, isG3ProductionDomainActive } =
        await import('@/lib/production/g3ServerClient')
      if (
        isG3WebAuthoritativePath() &&
        isG3ProductionDomainActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const order = getStore().production.planner.orders.find((o) => o.id === id)
        if (!order) return { ok: false, messageKey: 'planner.material.noOrder' }
        // Ensure draft exists on critical store then confirm
        const draftKey = `g3-order-draft-${id}`
        const draft = await g3ProductionCommand({
          idempotencyKey: draftKey,
          commandType: 'production.order.draft.save',
          command: {
            orderId: id,
            orderNumber: order.orderNumber,
            finishedProductId: order.finishedProductId,
            formulationRecipeId: order.formulationRecipeId,
            lineId: order.lineId,
            totalQtyMp: order.totalQtyMp,
            startDate: order.startDate,
            endDate: order.endDate,
            productName: order.productName,
            customer: order.customer,
            category: order.category,
            priority: order.priority,
          },
        })
        if (!draft.ok) return { ok: false, error: draft.error, messageKey: draft.error }
        const rawWarehouseId =
          getStore().warehouse.accountingByWarehouse?.[0]?.warehouseId ||
          getStore().warehouse.locations?.[0]?.id ||
          ''
        const conf = await g3ProductionCommand({
          idempotencyKey: `g3-order-confirm-${id}`,
          commandType: 'production.order.confirm',
          command: { orderId: id, rawWarehouseId },
        })
        if (!conf.ok) return { ok: false, error: conf.error, messageKey: conf.error }
        setStore((s) => {
          const mirrored = mirrorG3Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            productionActive: true,
          })
          const orders = s.production.planner.orders.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status: 'active' as const,
                  recipeNormSnapshot: (
                    conf.data.production?.orders as Array<{ id: string; recipeNormSnapshot?: unknown }> | undefined
                  )?.find((x) => x.id === id)?.recipeNormSnapshot as typeof o.recipeNormSnapshot,
                }
              : o,
          )
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
              planner: { ...s.production.planner, orders },
            },
          }
        })
        return { ok: true }
      }

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

          const year = new Date().getFullYear()
          let nextSeq = Math.max(1, Number(s.production.planner.nextOrderSeq) || 1)
          for (const o of s.production.planner.orders) {
            const m = o.orderNumber?.match(/ЗП-(\d{4})-(\d+)/)
            if (m && Number(m[1]) === year) {
              nextSeq = Math.max(nextSeq, Number(m[2]) + 1)
            }
          }
          const hadNumber = Boolean(order.orderNumber?.trim())
          const orderNumber = hadNumber
            ? order.orderNumber!.trim()
            : formatOrderNumber(year, nextSeq)
          const bumpedSeq = hadNumber ? nextSeq : nextSeq + 1
          const actor = actorFromGetter(getActor)
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
              planner: normalizePlanner({
                ...s.production.planner,
                orders,
                nextOrderSeq: Math.max(bumpedSeq, s.production.planner.nextOrderSeq ?? 1),
              }),
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

    async confirmProductionShiftReport(input: {
      report: import('@/lib/production/shiftReports').ConfirmShiftReportInput['report']
      productionOrderId: string
      idempotencyKey: string
      emergencyReason?: string
    }): Promise<ConfirmShiftReportResult> {
      const { isG3WebAuthoritativePath, g3ProductionCommand, mirrorG3Ack, isG3ProductionDomainActive } =
        await import('@/lib/production/g3ServerClient')
      if (
        isG3WebAuthoritativePath() &&
        isG3ProductionDomainActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const order = getStore().production.planner.orders.find((o) => o.id === input.productionOrderId)
        if (!order) return { ok: false, error: 'planner.material.noOrder' }
        const materialLines = input.report.materialLines ?? []
        const conf = await g3ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'production.shift.confirm',
          command: {
            orderId: input.productionOrderId,
            lineId: input.report.lineId,
            shiftDate: input.report.shiftDate,
            shiftSlot: input.report.shift,
            outputMp: input.report.outputM2,
            outputRolls: input.report.rollCount ?? 0,
            actualInputs: materialLines.map((l) => ({
              itemId: l.itemId,
              quantity: l.actualInputQty,
              deviationReason: l.deviationReason,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate,
            })),
            wasteLines: (input.report.wasteLines ?? []).map((w) => ({
              itemId: w.itemId,
              quantity: w.quantity,
              reason: w.comment || w.reasonCode,
              unit: w.unitSnapshot,
            })),
            semiFinishedItemId: input.report.semiFinishedItemId,
            packLocationId: input.report.packagingLocationId,
            reportKey: input.idempotencyKey,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let reportOut: import('@/lib/production/shiftReports').ProductionShiftReport | undefined
        setStore((s) => {
          const mirrored = mirrorG3Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
          })
          const g3Reports = (conf.data.production?.shiftReports ?? []) as Array<
            import('@/lib/production/shiftReports').ProductionShiftReport & { id: string }
          >
          reportOut = g3Reports.find((r) => r.id === conf.data.reportId) ?? g3Reports[g3Reports.length - 1]
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
              shiftReports: [
                ...(s.production.shiftReports ?? []),
                ...(reportOut && !(s.production.shiftReports ?? []).some((r) => r.id === reportOut!.id)
                  ? [reportOut]
                  : []),
              ],
            },
          }
        })
        return { ok: true, report: reportOut }
      }
      if (
        isG3WebAuthoritativePath() &&
        !isG3ProductionDomainActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const { G3_PRODUCTION_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
        return { ok: false, error: G3_PRODUCTION_INACTIVE }
      }

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

    async confirmProductionShiftReportCorrection(input: {
      originalReportId: string
      correctionReason: string
      report: import('@/lib/production/shiftReports').ConfirmShiftReportInput['report']
      productionOrderId: string
      idempotencyKey: string
      emergencyReason?: string
    }): Promise<ConfirmShiftReportResult> {
      const { isG3WebAuthoritativePath, g3ProductionCommand, mirrorG3Ack, isG3ProductionDomainActive } =
        await import('@/lib/production/g3ServerClient')
      if (
        isG3WebAuthoritativePath() &&
        isG3ProductionDomainActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const materialLines = input.report.materialLines ?? []
        const conf = await g3ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'production.shift.confirmCorrection',
          command: {
            originalReportId: input.originalReportId,
            correctionReason: input.correctionReason,
            emergencyReason: input.emergencyReason,
            orderId: input.productionOrderId,
            lineId: input.report.lineId,
            shiftDate: input.report.shiftDate,
            shiftSlot: input.report.shift,
            outputMp: input.report.outputM2,
            outputRolls: input.report.rollCount ?? 0,
            actualInputs: materialLines.map((l) => ({
              itemId: l.itemId,
              quantity: l.actualInputQty,
              deviationReason: l.deviationReason,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate,
            })),
            wasteLines: (input.report.wasteLines ?? []).map((w) => ({
              itemId: w.itemId,
              quantity: w.quantity,
              reason: w.comment || w.reasonCode,
              unit: w.unitSnapshot,
            })),
            semiFinishedItemId: input.report.semiFinishedItemId,
            packLocationId: input.report.packagingLocationId,
            reportKey: input.idempotencyKey,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let reportOut: import('@/lib/production/shiftReports').ProductionShiftReport | undefined
        setStore((s) => {
          const mirrored = mirrorG3Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
          })
          const g3Reports = (conf.data.production?.shiftReports ?? []) as Array<
            import('@/lib/production/shiftReports').ProductionShiftReport & { id: string }
          >
          reportOut = g3Reports.find((r) => r.id === conf.data.reportId) ?? g3Reports[g3Reports.length - 1]
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
              shiftReports: [
                ...(s.production.shiftReports ?? []).map((r) =>
                  r.id === input.originalReportId
                    ? { ...r, correctedAt: new Date().toISOString() }
                    : r,
                ),
                ...(reportOut &&
                !(s.production.shiftReports ?? []).some((r) => r.id === reportOut!.id)
                  ? [reportOut]
                  : []),
              ],
            },
          }
        })
        return { ok: true, report: reportOut }
      }

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

    upsertPackagingReport(report: Omit<
      ProductionPackagingReport,
      | 'status'
      | 'createdAt'
      | 'updatedAt'
      | 'confirmedAt'
      | 'confirmedBy'
      | 'confirmedByName'
      | 'fgReceiptDocumentId'
      | 'finishedGoodsLotId'
      | 'transactionGroupId'
    > & { id?: string; number?: string }): string {
      let reportId = report.id ?? crypto.randomUUID()
      setStore((s) => {
        const reports = s.production.packagingReports ?? []
        const now = new Date().toISOString()
        const existing = reports.find((r) => r.id === reportId)
        if (existing && (existing.status === 'confirmed' || existing.status === 'cancelled')) {
          reportId = existing.id
          return s
        }
        const next: ProductionPackagingReport = {
          ...(existing ?? {}),
          ...report,
          id: reportId,
          number:
            report.number ??
            existing?.number ??
            nextPackagingReportNumber(reports, report.shiftDate ?? now.slice(0, 10)),
          status: 'draft',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          transactionGroupId: existing?.transactionGroupId,
        }
        return {
          ...s,
          production: {
            ...s.production,
            packagingReports: upsertReportById(reports, next),
          },
        }
      })
      return reportId
    },

    async confirmPackagingReport(
      input: ConfirmPackagingReportInput,
    ): Promise<ReturnType<typeof confirmPackagingReportCore>['result']> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      const g4Active = isG4PackagingQcActive(
        getStore().production as unknown as Record<string, unknown>,
      )
      if (isG4WebAuthoritativePath() && g4Active) {
        const report = input.report
        const conf = await g4ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'packaging.report.confirm',
          command: {
            productionOrderId: report.productionOrderId,
            orderId: report.productionOrderId,
            lineId: report.lineId ?? 'pack',
            reportDate: report.shiftDate,
            date: report.shiftDate,
            shiftSlot: report.shift === 'night' ? 'night' : 'day',
            finishedProductId: report.finishedProductId,
            warehouseItemId: report.warehouseItemId,
            packagingLocationId: report.packagingLocationId,
            outputM2: report.outputM2,
            outputMp: report.outputM2,
            outputRolls: report.rollCount ?? 0,
            wipLines: report.wipLines ?? [],
            materialLines: report.materialLines ?? [],
            batchNo: report.batchNo,
            reportKey: input.idempotencyKey,
            emergencyReason: input.emergencyReason,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let result: ReturnType<typeof confirmPackagingReportCore>['result'] = { ok: true }
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          const reportId = conf.data.reportId ?? conf.data.finishedGoodsLotId
          const reports = (mirrored.production.packagingReports ?? []) as ProductionPackagingReport[]
          const lots = (mirrored.production.finishedGoodsLots ?? []) as FinishedGoodsLot[]
          const confirmedReport =
            reports.find((r) => r.id === reportId || r.idempotencyKey === input.idempotencyKey) ??
            reports.find((r) => r.id === conf.data.reportId)
          const lot =
            lots.find((l) => l.id === conf.data.finishedGoodsLotId) ??
            lots.find((l) => l.packagingReportId === confirmedReport?.id)
          result = {
            ok: true,
            idempotent: conf.data.idempotent,
            report: confirmedReport,
            lot,
          }
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return result
      }
      if (isG4WebAuthoritativePath() && !g4Active) {
        const { G4_PACKAGING_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
        return { ok: false, error: G4_PACKAGING_INACTIVE }
      }

      let result: ReturnType<typeof confirmPackagingReportCore>['result'] = { ok: false, error: 'unknown' }
      const groupId =
        input.transactionGroupId ??
        `warehouse::production_packaging_report::${input.report.id ?? input.idempotencyKey}::${input.idempotencyKey}`
      setStore(
        (s) => {
          const out = confirmPackagingReportCore(s.production, s.warehouse, {
            ...input,
            transactionGroupId: groupId,
          })
          result = out.result
          if (!out.result.ok) return s
          const packagingReports = upsertReportById(
            s.production.packagingReports ?? [],
            out.result.report!,
          )
          const finishedGoodsLots = upsertReportById(
            s.production.finishedGoodsLots ?? [],
            out.result.lot!,
          )
          return {
            ...s,
            production: {
              ...out.production,
              packagingReports,
              finishedGoodsLots,
            },
            warehouse: out.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_packaging_report',
          transactionGroupLabel: 'Отчёт упаковки',
        },
      )
      return result
    },

    async confirmPackagingReportCorrection(
      input: ConfirmPackagingReportInput,
    ): Promise<ReturnType<typeof confirmPackagingReportCorrectionCore>['result']> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      const g4Active = isG4PackagingQcActive(
        getStore().production as unknown as Record<string, unknown>,
      )
      if (isG4WebAuthoritativePath() && g4Active) {
        const report = input.report
        const conf = await g4ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'packaging.report.confirmCorrection',
          command: {
            originalReportId: report.correctsReportId,
            correctsReportId: report.correctsReportId,
            correctionReason: report.correctionReason,
            reason: report.correctionReason,
            emergencyReason: input.emergencyReason ?? report.correctionReason,
            productionOrderId: report.productionOrderId,
            orderId: report.productionOrderId,
            lineId: report.lineId ?? 'pack',
            reportDate: report.shiftDate,
            date: report.shiftDate,
            shiftSlot: report.shift === 'night' ? 'night' : 'day',
            finishedProductId: report.finishedProductId,
            warehouseItemId: report.warehouseItemId,
            packagingLocationId: report.packagingLocationId,
            outputM2: report.outputM2,
            outputMp: report.outputM2,
            outputRolls: report.rollCount ?? 0,
            wipLines: report.wipLines ?? [],
            materialLines: report.materialLines ?? [],
            batchNo: report.batchNo,
            reportKey: input.idempotencyKey,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let result: ReturnType<typeof confirmPackagingReportCorrectionCore>['result'] = { ok: true }
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          const reports = (mirrored.production.packagingReports ?? []) as ProductionPackagingReport[]
          const lots = (mirrored.production.finishedGoodsLots ?? []) as FinishedGoodsLot[]
          const confirmedReport =
            reports.find((r) => r.id === conf.data.reportId || r.idempotencyKey === input.idempotencyKey)
          const lot =
            lots.find((l) => l.id === conf.data.finishedGoodsLotId) ??
            lots.find((l) => l.packagingReportId === confirmedReport?.id)
          result = {
            ok: true,
            idempotent: conf.data.idempotent,
            report: confirmedReport,
            lot,
          }
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return result
      }
      if (isG4WebAuthoritativePath() && !g4Active) {
        const { G4_PACKAGING_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
        return { ok: false, error: G4_PACKAGING_INACTIVE }
      }

      let result: ReturnType<typeof confirmPackagingReportCorrectionCore>['result'] = {
        ok: false,
        error: 'unknown',
      }
      const groupId =
        input.transactionGroupId ??
        `warehouse::production_packaging_report::${input.report.id ?? input.idempotencyKey}::correction::${input.idempotencyKey}`
      setStore(
        (s) => {
          const out = confirmPackagingReportCorrectionCore(s.production, s.warehouse, {
            ...input,
            transactionGroupId: groupId,
          })
          result = out.result
          if (!out.result.ok) return s
          const packagingReports = upsertReportById(
            s.production.packagingReports ?? [],
            out.result.report!,
          )
          const finishedGoodsLots = upsertReportById(
            s.production.finishedGoodsLots ?? [],
            out.result.lot!,
          )
          return {
            ...s,
            production: {
              ...out.production,
              packagingReports,
              finishedGoodsLots,
            },
            warehouse: out.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_packaging_report',
          transactionGroupLabel: 'Корректировка отчёта упаковки',
        },
      )
      return result
    },

    listPendingQcLots(): FinishedGoodsLot[] {
      return listPendingQcLots(getStore().production.finishedGoodsLots)
    },

    listAvailableWipForPackaging(packagingLocationId: string) {
      return listAvailableWipAtPackaging(
        getStore().production,
        getStore().warehouse,
        packagingLocationId,
      )
    },

    async startQcReview(lotId: string): Promise<void> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      const g4Active = isG4PackagingQcActive(
        getStore().production as unknown as Record<string, unknown>,
      )
      if (isG4WebAuthoritativePath() && g4Active) {
        const conf = await g4ProductionCommand({
          idempotencyKey: `g4-qc-review-${lotId}`,
          commandType: 'qc.review.start',
          command: { lotId, finishedGoodsLotId: lotId },
        })
        if (!conf.ok) return
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return
      }
      if (isG4WebAuthoritativePath() && !g4Active) {
        return
      }
      setStore((s) => {
        const lots = s.production.finishedGoodsLots ?? []
        const nextLots = lots.map((lot) => (lot.id === lotId ? startQcReviewCore(lot) : lot))
        if (nextLots === lots) return s
        return {
          ...s,
          production: {
            ...s.production,
            finishedGoodsLots: nextLots,
          },
        }
      })
    },

    async upsertQcAttachment(input: QcAttachmentUploadInput): Promise<QcLotAttachment> {
      const attachment = await qcAttachmentAdapter.upload(input)
      setStore(
        (s) => {
          const nextAttachments = upsertReportById(s.production.qcAttachments ?? [], attachment)
          const nextLots = (s.production.finishedGoodsLots ?? []).map((lot) => {
            if (lot.id !== attachment.lotId) return lot
            if (attachment.documentKind === 'passport') {
              return { ...lot, passportAttachmentId: attachment.id, updatedAt: new Date().toISOString() }
            }
            if (attachment.documentKind === 'protocol') {
              return { ...lot, protocolAttachmentId: attachment.id, updatedAt: new Date().toISOString() }
            }
            return lot
          })
          return {
            ...s,
            production: {
              ...s.production,
              qcAttachments: nextAttachments,
              finishedGoodsLots: nextLots,
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: `warehouse::qc_release::${attachment.lotId}::attach:${attachment.id}`,
          transactionGroupKind: 'qc_release',
          transactionGroupLabel: 'Вложение QC',
        },
      )
      return attachment
    },

    async releaseFinishedGoodsLot(
      input: ReleaseFinishedGoodsLotInput,
    ): Promise<ReturnType<typeof releaseFinishedGoodsLot>['result']> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      const g4Active = isG4PackagingQcActive(
        getStore().production as unknown as Record<string, unknown>,
      )
      if (isG4WebAuthoritativePath() && g4Active) {
        const conf = await g4ProductionCommand({
          idempotencyKey: `g4-qc-release-${input.lotId}`,
          commandType: 'qc.release',
          command: {
            lotId: input.lotId,
            finishedGoodsLotId: input.lotId,
            passportAttachmentId: input.attachments?.passportAttachmentId,
            protocolAttachmentId: input.attachments?.protocolAttachmentId,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let result: ReturnType<typeof releaseFinishedGoodsLot>['result'] = { ok: true }
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          const lots = (mirrored.production.finishedGoodsLots ?? []) as FinishedGoodsLot[]
          const lot = lots.find((l) => l.id === input.lotId || l.id === conf.data.finishedGoodsLotId)
          result = { ok: true, lot }
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return result
      }
      if (isG4WebAuthoritativePath() && !g4Active) {
        const { G4_PACKAGING_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
        return { ok: false, error: G4_PACKAGING_INACTIVE }
      }

      const groupId = `warehouse::qc_release::${input.lotId}::release`
      let result: ReturnType<typeof releaseFinishedGoodsLot>['result'] = { ok: false, error: 'unknown' }
      setStore(
        (s) => {
          const out = releaseFinishedGoodsLot(s.production, {
            ...input,
            access: input.access ?? s.access,
          })
          result = out.result
          if (!out.result.ok || !out.result.lot) return s
          return {
            ...s,
            production: {
              ...s.production,
              finishedGoodsLots: upsertReportById(s.production.finishedGoodsLots ?? [], out.result.lot),
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'qc_release',
          transactionGroupLabel: 'QC выпуск партии',
        },
      )
      return result
    },

    mirrorServerQcRelease(input: {
      lotId: string
      decisionId: string
      decisionRevision?: number
      decidedByUid?: string
      decidedAt?: string
    }) {
      const groupId = `warehouse::qc_release::${input.lotId}::server-mirror`
      let lot: FinishedGoodsLot | undefined
      setStore(
        (s) => {
          const out = applyServerQcReleaseMirror(s.production, input)
          lot = out.lot
          if (!out.lot) return s
          return {
            ...s,
            production: {
              ...s.production,
              finishedGoodsLots: upsertReportById(s.production.finishedGoodsLots ?? [], out.lot),
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'qc_release',
          transactionGroupLabel: 'QC выпуск (server ack)',
        },
      )
      return { ok: Boolean(lot), lot }
    },

    async requestRegrade(
      input: RequestRegradeInput,
    ): Promise<ReturnType<typeof requestRegrade>['result']> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      if (
        isG4WebAuthoritativePath() &&
        isG4PackagingQcActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const conf = await g4ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'qc.regrade',
          command: {
            lotId: input.lotId,
            finishedGoodsLotId: input.lotId,
            targetFinishedProductId: input.targetFinishedProductId,
            targetWarehouseItemId: input.targetWarehouseItemId,
            reason: input.reason,
            regradeReason: input.reason,
            quantity: input.quantity,
            batchNo: input.batchNo,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let result: ReturnType<typeof requestRegrade>['result'] = { ok: true }
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          const lots = (mirrored.production.finishedGoodsLots ?? []) as FinishedGoodsLot[]
          const originalLot = lots.find((l) => l.id === input.lotId)
          const newLot =
            lots.find((l) => l.originalLotId === input.lotId) ??
            lots.find((l) => l.id === conf.data.finishedGoodsLotId)
          result = { ok: true, originalLot, newLot }
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return result
      }
      if (
        isG4WebAuthoritativePath() &&
        !isG4PackagingQcActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const { G4_PACKAGING_INACTIVE } = await import('@/lib/cloud/authoritativeWebGates')
        return { ok: false, error: G4_PACKAGING_INACTIVE }
      }

      const groupId = `warehouse::qc_regrade::${input.lotId}::${input.idempotencyKey}`
      let result: ReturnType<typeof requestRegrade>['result'] = { ok: false, error: 'unknown' }
      setStore(
        (s) => {
          const out = requestRegrade(s.production, s.warehouse, {
            ...input,
            access: input.access ?? s.access,
          })
          result = out.result
          if (!out.result.ok || !out.result.originalLot || !out.result.newLot) return s
          return {
            ...s,
            production: {
              ...out.production,
              finishedGoodsLots: upsertReportById(
                out.production.finishedGoodsLots ?? [],
                out.result.newLot,
              ),
            },
            warehouse: out.warehouse ?? s.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'qc_regrade',
          transactionGroupLabel: 'QC переоценка партии',
        },
      )
      return result
    },

    async rejectFinishedGoodsLot(
      input: RejectFinishedGoodsLotInput,
    ): Promise<ReturnType<typeof rejectFinishedGoodsLot>['result']> {
      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      if (
        isG4WebAuthoritativePath() &&
        isG4PackagingQcActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const conf = await g4ProductionCommand({
          idempotencyKey: `g4-qc-reject-${input.lotId}`,
          commandType: 'qc.reject',
          command: {
            lotId: input.lotId,
            finishedGoodsLotId: input.lotId,
            reason: input.reason,
            rejectReason: input.reason,
          },
        })
        if (!conf.ok) return { ok: false, error: conf.error || conf.message }
        let result: ReturnType<typeof rejectFinishedGoodsLot>['result'] = { ok: true }
        setStore((s) => {
          const mirrored = mirrorG4Ack(s.warehouse, s.production as unknown as Record<string, unknown>, {
            warehouse: conf.data.warehouse,
            production: conf.data.production,
            criticalRevision: conf.data.criticalRevision,
            packagingQcActive: conf.data.packagingQcActive ?? true,
            productionActive: conf.data.productionActive,
          })
          const lots = (mirrored.production.finishedGoodsLots ?? []) as FinishedGoodsLot[]
          const lot = lots.find((l) => l.id === input.lotId || l.id === conf.data.finishedGoodsLotId)
          result = { ok: true, lot }
          return {
            ...s,
            warehouse: mirrored.warehouse,
            production: {
              ...s.production,
              ...(mirrored.production as typeof s.production),
            },
          }
        })
        return result
      }

      const groupId = `warehouse::qc_reject_transfer::${input.lotId}::reject`
      let result: ReturnType<typeof rejectFinishedGoodsLot>['result'] = { ok: false, error: 'unknown' }
      setStore(
        (s) => {
          const out = rejectFinishedGoodsLot(s.production, {
            ...input,
            access: input.access ?? s.access,
          })
          result = out.result
          if (!out.result.ok || !out.result.lot) return s
          return {
            ...s,
            production: {
              ...s.production,
              finishedGoodsLots: upsertReportById(s.production.finishedGoodsLots ?? [], out.result.lot),
            },
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'qc_reject_transfer',
          transactionGroupLabel: 'QC отклонение партии',
        },
      )
      return result
    },

    applyRejectTransferToScrap(input: ApplyRejectTransferInput) {
      const groupId = `warehouse::qc_reject_transfer::${input.lotId}::scrap`
      let result: ReturnType<typeof applyRejectTransferToScrap>['result'] = { ok: false, error: 'unknown' }
      setStore(
        (s) => {
          const out = applyRejectTransferToScrap(s.production, s.warehouse, input)
          result = out.result
          if (!out.result.ok || !out.result.lot) return s
          return {
            ...s,
            production: {
              ...out.production,
              finishedGoodsLots: upsertReportById(out.production.finishedGoodsLots ?? [], out.result.lot),
            },
            warehouse: out.warehouse,
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'qc_reject_transfer',
          transactionGroupLabel: 'QC в брак',
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
