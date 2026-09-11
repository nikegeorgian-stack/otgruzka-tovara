import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CreateLinkedTaskButton } from '@/components/tasks/CreateLinkedTaskButton'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { draftFromProductionMaterialShortage } from '@/lib/tasks/linkRefs'
import type { WorkTaskDraft } from '@/lib/tasks/types'
import {
  materialRoleLabelKey,
  orderNeedsMaterialPlanning,
  PLANNER_MATERIAL_STATUSES,
} from '@/lib/planner/materialNeeds'
import type { MaterialReserveResult } from '@/lib/planner/materialReserve'
import {
  aggregateItemDemand,
  materialAvailabilityForOrder,
  type MaterialAvailabilityRow,
} from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  preparePlannerReservationHandoff,
  type PlannerHandoffBlockCode,
} from '@/lib/planner/plannerReservationHandoff'
import { formatQty } from '@/lib/warehouse/stock'
import type { StockMovement, WarehouseAccountingState, WarehouseDocument, WarehouseItem } from '@/lib/warehouse/types'
import {
  computeOrderProvisioningStatus,
  isLegacyBareReserveMovement,
  listReservationDocumentsForOrder,
} from '@/lib/warehouse/productionReservations'
import {
  computeLineMaterialBalances,
  type HandoffResult,
  type ProductionMaterialTransferInput,
} from '@/lib/warehouse/productionMaterialHandoff'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'

type Props = {
  orders: ProductionOrder[]
  warehouseItems: WarehouseItem[]
  warehouseMovements: StockMovement[]
  warehouseDocuments?: WarehouseDocument[]
  warehouseLocations?: import('@/lib/warehouse/types').WarehouseLocation[]
  productionLineBindings?: import('@/lib/warehouse/types').ProductionLineLocationBinding[]
  warehouseAccounting?: WarehouseAccountingState[]
  onReserveOrder: (orderId: string) => MaterialReserveResult
  onUnreserveOrder: (orderId: string) => boolean
  onTransferProductionOrderMaterials?: (
    input: ProductionMaterialTransferInput,
  ) => Promise<HandoffResult> | HandoffResult
  onSelectOrder?: (orderId: string) => void
  onOpenWarehouseDocument?: (documentId: string) => void
  access?: AccessStore
  currentUser?: AppUser | null
  onCreateWorkTask?: (draft: WorkTaskDraft) => string
}

function handoffBlockMessage(
  code: PlannerHandoffBlockCode,
  lineId: string,
  technicalDetail?: string,
): string {
  const detail: Record<PlannerHandoffBlockCode, string> = {
    order_not_active: 'производственный заказ не находится в работе',
    forbidden_role: 'нужна активная роль «Кладовщик» или системный администратор',
    reservation_document_mismatch: 'документ не является положительным резервом этого заказа',
    reservation_not_posted: 'документ резерва ещё не проведён',
    reservation_not_positive: 'в документе нет положительного резерва для выдачи',
    reservation_evidence_mismatch: 'строки документа не совпадают с его проводками резерва',
    reservation_already_issued: 'этот документ резерва уже передан на линию',
    reservation_partially_changed: 'остаток резерва меньше точных строк документа; нужна сверка',
    reservation_not_remaining: 'по документу не осталось положительного резерва',
    raw_material_not_configured: 'в заказе не выбрана точная позиция суровья',
    raw_material_line_missing: 'в документе нет строки выбранного суровья',
    raw_material_line_ambiguous: 'в документе несколько строк выбранного суровья; нужна сверка',
    raw_warehouse_missing: 'исходный склад документа отсутствует в справочнике',
    line_binding_not_unique: `для линии ${lineId} должна быть ровно одна привязка`,
    line_binding_invalid: `привязка линии ${lineId} ссылается на отсутствующий склад или участок`,
    warehouse_item_missing: 'одна из позиций документа отсутствует в номенклатуре',
    unlinked_handoff_exists: 'найдена прежняя передача без ссылки на документ резерва; нужна сверка',
  }
  return `${detail[code]}${technicalDetail ? ` (${technicalDetail})` : ''}`
}

function StatusBadge({
  shortage,
  reserved,
  need,
}: {
  shortage: number
  reserved: number
  need: number
}) {
  const { t } = useI18n()
  if (need <= 0) {
    return (
      <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
        {t('planner.material.noNeed')}
      </span>
    )
  }
  if (shortage > 0) {
    return (
      <span className="rounded-sm bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
        {t('planner.material.short')}
      </span>
    )
  }
  if (reserved >= need) {
    return (
      <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
        {t('planner.material.reservedOk')}
      </span>
    )
  }
  return (
    <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
      {t('planner.material.partial')}
    </span>
  )
}

function orderMaterialStatus(rows: MaterialAvailabilityRow[]) {
  const need = rows.reduce((s, r) => s + r.quantity, 0)
  const reserved = rows.reduce((s, r) => s + r.reservedForOrder, 0)
  const shortage = rows.reduce((s, r) => s + r.shortage, 0)
  return { need, reserved, shortage }
}

export function PlannerMaterialsPanel({
  orders,
  warehouseItems,
  warehouseMovements,
  warehouseDocuments = [],
  warehouseLocations = [],
  productionLineBindings = [],
  warehouseAccounting,
  onReserveOrder,
  onUnreserveOrder,
  onTransferProductionOrderMaterials,
  onSelectOrder,
  onOpenWarehouseDocument,
  access,
  currentUser,
  onCreateWorkTask,
}: Props) {
  const { t, tf } = useI18n()
  const [filter, setFilter] = useState<'all' | 'shortage' | 'unreserved'>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingHandoffDocumentId, setPendingHandoffDocumentId] = useState<string | null>(null)
  const [acknowledgedHandoffDocumentIds, setAcknowledgedHandoffDocumentIds] = useState<Set<string>>(
    () => new Set(),
  )
  const inFlightHandoffDocumentIds = useRef(new Set<string>())

  const warehouse = useMemo(
    () => ({
      items: warehouseItems,
      movements: warehouseMovements,
      documents: warehouseDocuments,
      locations: warehouseLocations,
      accountingByWarehouse: warehouseAccounting,
      productionLineBindings,
    }),
    [
      warehouseItems,
      warehouseMovements,
      warehouseDocuments,
      warehouseLocations,
      warehouseAccounting,
      productionLineBindings,
    ],
  )

  const relevantOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          PLANNER_MATERIAL_STATUSES.includes(o.status) && orderNeedsMaterialPlanning(o),
      ),
    [orders],
  )

  const summary = useMemo(
    () => aggregateItemDemand(relevantOrders, warehouse, warehouseItems),
    [relevantOrders, warehouse, warehouseItems],
  )

  const orderRows = useMemo(() => {
    return relevantOrders
      .map((order) => {
        const lines = materialAvailabilityForOrder(order, warehouse, warehouseItems)
        const status = orderMaterialStatus(lines)
        return { order, lines, status }
      })
      .filter(({ status, lines }) => {
        if (!lines.length) return false
        if (filter === 'shortage') return status.shortage > 0
        if (filter === 'unreserved') return status.reserved < status.need
        return true
      })
      .sort((a, b) => b.status.shortage - a.status.shortage || a.order.orderNumber.localeCompare(b.order.orderNumber, 'ru'))
  }, [relevantOrders, warehouse, warehouseItems, filter])

  function handleReserve(orderId: string) {
    const res = onReserveOrder(orderId)
    if (res.messageKey) {
      setNotice(
        res.ok
          ? t(res.messageKey)
          : tf(res.messageKey, res.messageVars ?? {}),
      )
    }
  }

  function handleUnreserve(orderId: string) {
    if (onUnreserveOrder(orderId)) {
      setNotice(t('planner.material.unreserved'))
    } else {
      setNotice(t('planner.material.noReserve'))
    }
  }

  async function handleMaterialHandoff(
    order: ProductionOrder,
    reservationDocument: WarehouseDocument,
  ) {
    const prepared = preparePlannerReservationHandoff({
      order,
      reservationDocument,
      warehouseItems,
      warehouseMovements,
      warehouseDocuments,
      warehouseLocations,
      productionLineBindings,
      warehouseAccounting,
      currentUser,
    })
    if (!prepared.ok) {
      setNotice(
        `Выдача ${reservationDocument.number} заблокирована: ${handoffBlockMessage(prepared.code, order.lineId, prepared.detail)}.`,
      )
      return
    }
    if (!onTransferProductionOrderMaterials) {
      setNotice(
        `Выдача ${reservationDocument.number} заблокирована: authoritative-команда передачи недоступна.`,
      )
      return
    }
    if (
      acknowledgedHandoffDocumentIds.has(reservationDocument.id) ||
      inFlightHandoffDocumentIds.current.has(reservationDocument.id)
    ) {
      setNotice(`Выдача ${reservationDocument.number}: команда уже отправлена.`)
      return
    }

    inFlightHandoffDocumentIds.current.add(reservationDocument.id)
    setPendingHandoffDocumentId(reservationDocument.id)
    setNotice(`Выдача ${reservationDocument.number}: ожидается authoritative-подтверждение.`)
    try {
      const result = await onTransferProductionOrderMaterials(prepared.input)
      if (!result.ok) {
        setNotice(
          `Выдача ${reservationDocument.number} отклонена: ${result.error || 'authoritative_ack_missing'}.`,
        )
        return
      }
      setAcknowledgedHandoffDocumentIds((current) => {
        const next = new Set(current)
        next.add(reservationDocument.id)
        return next
      })
      const effectCount = result.documentIds?.length ?? (result.documentId ? 1 : 0)
      setNotice(
        `Выдача ${reservationDocument.number} подтверждена${
          result.idempotent ? ' без повторной проводки' : ''
        }: документов ${effectCount}.`,
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unexpected_error'
      setNotice(`Выдача ${reservationDocument.number} не выполнена: ${detail}.`)
    } finally {
      inFlightHandoffDocumentIds.current.delete(reservationDocument.id)
      setPendingHandoffDocumentId((current) =>
        current === reservationDocument.id ? null : current,
      )
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-sky-200/80 bg-sky-50/40 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold">{t('planner.material.hintTitle')}</p>
        <p className="mt-1 text-xs text-sky-800/90">{t('planner.material.hintBody')}</p>
      </div>

      {notice && (
        <p className="rounded-sm border border-grid bg-white px-3 py-2 text-sm text-stone-700">
          {notice}
          <button
            type="button"
            className="ml-2 text-xs text-stone-400 hover:text-stone-600"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </p>
      )}

      {summary.length > 0 && (
        <section className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <h3 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {t('planner.material.summaryTitle')}
          </h3>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('planner.material.colItem')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colNeed')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colReserved')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colAvailable')}</th>
                <th className="px-3 py-2 text-right">{t('planner.material.colShort')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr
                  key={row.itemId}
                  className={`border-t border-grid ${row.shortage > 0 ? 'bg-red-50/50' : ''}`}
                >
                  <td className="px-3 py-2 font-medium">{row.itemName}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {formatQty(row.totalNeed)} {row.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-amber-800">
                    {formatQty(row.totalReserved)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {row.available == null ? '—' : formatQty(row.available)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                      row.shortage > 0 ? 'text-red-700' : 'text-stone-400'
                    }`}
                  >
                    {row.shortage > 0 ? formatQty(row.shortage) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-stone-400">
          {t('planner.material.filter')}:
        </span>
        {(
          [
            ['all', 'planner.material.filterAll'],
            ['shortage', 'planner.material.filterShort'],
            ['unreserved', 'planner.material.filterUnreserved'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
              filter === id
                ? 'border-accent bg-accent text-white'
                : 'border-grid bg-white text-stone-600 hover:bg-paper-dark'
            }`}
            onClick={() => setFilter(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {orderRows.length === 0 ? (
        <p className="rounded-sm border border-dashed border-grid bg-white p-8 text-center text-sm text-stone-500">
          {t('planner.material.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {orderRows.map(({ order, lines, status }) => (
            <section
              key={order.id}
              className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid bg-stone-50/80 px-4 py-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="text-left font-semibold text-ink hover:text-accent"
                    onClick={() => onSelectOrder?.(order.id)}
                  >
                    {order.orderNumber} · {order.productName}
                  </button>
                  <p className="text-xs text-stone-500">
                    {t(`planner.status.${order.status}`)} · {formatQty(order.totalQtyMp)} п.м ·{' '}
                    {t(
                      `planner.material.provisioning.${computeOrderProvisioningStatus(order, warehouse)}`,
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge {...status} />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleReserve(order.id)}
                    disabled={!lines.some((l) => l.canReserve > 0)}
                  >
                    {t('planner.material.reserveBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleUnreserve(order.id)}
                    disabled={status.reserved <= 0}
                  >
                    {t('planner.material.unreserveBtn')}
                  </Button>
                  {status.shortage > 0 && access && currentUser && onCreateWorkTask ? (
                    <CreateLinkedTaskButton
                      draft={draftFromProductionMaterialShortage({
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        productName: order.productName,
                        createdBy: currentUser.id,
                        createdByName: currentUser.displayName,
                      })}
                      access={access}
                      currentUser={currentUser}
                      onCreate={onCreateWorkTask}
                      labelKey="tasks.link.materialShortage"
                    />
                  ) : null}
                </div>
              </div>
              {(() => {
                const loc = resolveProductionLineLocation(
                  warehouse as import('@/lib/warehouse/types').WarehouseStore,
                  order.lineId,
                )
                if (!loc.ok) {
                  return (
                    <div className="border-b border-grid bg-stone-50 px-4 py-2 text-xs text-amber-800">
                      {t('warehouse.handoff.setupHint')}
                    </div>
                  )
                }
                const atLine = computeLineMaterialBalances(
                  warehouse as import('@/lib/warehouse/types').WarehouseStore,
                  {
                    productionOrderId: order.id,
                    productionWarehouseId: loc.productionWarehouseId,
                    productionLocationId: loc.productionLocationId,
                    lineId: order.lineId,
                  },
                )
                if (!atLine.length) return null
                return (
                  <div className="border-b border-grid bg-sky-50/50 px-4 py-2 text-xs text-stone-700">
                    {atLine.map((row) => {
                      const name =
                        warehouseItems.find((i) => i.id === row.itemId)?.name ?? row.itemId
                      return (
                        <div key={`${row.itemId}-${row.batchNo ?? ''}`} className="flex flex-wrap gap-3">
                          <span className="font-medium">{name}</span>
                          <span>
                            {t('planner.material.issuedToLine')}: {formatQty(row.transferredQty)}
                          </span>
                          <span>
                            {t('planner.material.atLine')}: {formatQty(row.remainingQty)}
                          </span>
                          <span>
                            {t('planner.material.returned')}: {formatQty(row.returnedQty)}
                          </span>
                          {row.batchNo ? <span>партия {row.batchNo}</span> : null}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              {(() => {
                const docs = listReservationDocumentsForOrder(
                  { documents: warehouseDocuments },
                  order.id,
                )
                const legacy = warehouseMovements.some(
                  (m) =>
                    m.productionOrderId === order.id && isLegacyBareReserveMovement(m),
                )
                if (!docs.length && !legacy) return null
                return (
                  <div className="border-b border-grid bg-amber-50/40 px-4 py-2 text-xs text-stone-700">
                    <p className="font-semibold">{t('planner.material.docsTitle')}:</p>
                    <div className="mt-2 space-y-2">
                      {docs.map((document) => {
                        const prepared = preparePlannerReservationHandoff({
                          order,
                          reservationDocument: document,
                          warehouseItems,
                          warehouseMovements,
                          warehouseDocuments,
                          warehouseLocations,
                          productionLineBindings,
                          warehouseAccounting,
                          currentUser,
                        })
                        const acknowledged = acknowledgedHandoffDocumentIds.has(document.id)
                        const pending = pendingHandoffDocumentId === document.id
                        const anotherPending =
                          pendingHandoffDocumentId != null && !pending
                        const unavailable = !onTransferProductionOrderMaterials
                        const blockedDetail = !prepared.ok
                          ? handoffBlockMessage(prepared.code, order.lineId, prepared.detail)
                          : unavailable
                            ? 'authoritative-команда передачи недоступна'
                            : anotherPending
                              ? 'ожидается подтверждение другой передачи'
                              : null
                        const warehouseName = warehouseLocations.find(
                          (location) => location.id === document.warehouseId,
                        )?.name
                        const buttonDone =
                          acknowledged ||
                          (!prepared.ok && prepared.code === 'reservation_already_issued')
                        return (
                          <div
                            key={document.id}
                            className="rounded-sm border border-amber-200 bg-white/80 px-3 py-2"
                            data-testid={`planner-reservation-handoff-${document.id}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <button
                                  type="button"
                                  className="font-semibold underline hover:text-accent"
                                  onClick={() => onOpenWarehouseDocument?.(document.id)}
                                >
                                  {document.number}
                                  {document.reservationReason
                                    ? ` (${document.reservationReason})`
                                    : ''}
                                </button>
                                <span className="ml-2 text-stone-500">
                                  склад: {warehouseName ?? 'не найден'} · строк:{' '}
                                  {document.lines.filter((line) => line.quantity > 0).length}
                                  {prepared.ok ? ` · к выдаче: ${formatQty(prepared.quantity)}` : ''}
                                </span>
                              </div>
                              <Button
                                variant={buttonDone ? 'success' : 'secondary'}
                                size="sm"
                                data-testid={`planner-handoff-submit-${document.id}`}
                                data-command-type="production.material.issueToLine"
                                data-reservation-document-id={document.id}
                                disabled={
                                  !prepared.ok ||
                                  unavailable ||
                                  pendingHandoffDocumentId != null ||
                                  acknowledged
                                }
                                onClick={() => void handleMaterialHandoff(order, document)}
                              >
                                {pending
                                  ? 'Передаётся…'
                                  : buttonDone
                                    ? 'Передано на линию'
                                    : 'Передать на линию'}
                              </Button>
                            </div>
                            {blockedDetail ? (
                              <p
                                className="mt-1 text-[11px] text-amber-900"
                                data-testid={`planner-handoff-block-${document.id}`}
                              >
                                Выдача заблокирована: {blockedDetail}.
                              </p>
                            ) : prepared.ok ? (
                              <p className="mt-1 text-[11px] text-stone-500">
                                Линия {order.lineId} · передаётся только выбранное суровьё; коробки и
                                палеты остаются в резерве упаковки.
                              </p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    {legacy ? (
                      <p className="mt-2 text-amber-800">{t('planner.material.legacyBare')}</p>
                    ) : null}
                  </div>
                )
              })()}
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-stone-400">
                  <tr>
                    <th className="px-3 py-1.5">{t('planner.material.colType')}</th>
                    <th className="px-3 py-1.5">{t('planner.material.colItem')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colNeed')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colReserved')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colAvailable')}</th>
                    <th className="px-3 py-1.5 text-right">{t('planner.material.colShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={`${line.role}-${line.itemId}`}
                      className={`border-t border-grid/60 ${line.shortage > 0 ? 'bg-red-50/40' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-xs text-stone-500">
                        {t(materialRoleLabelKey(line.role))}
                      </td>
                      <td className="px-3 py-1.5">{line.itemName}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {formatQty(line.quantity)} {line.unit}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-amber-800">
                        {formatQty(line.reservedForOrder)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {line.available == null ? '—' : formatQty(line.available)}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono text-xs ${
                          line.shortage > 0 ? 'font-semibold text-red-700' : 'text-stone-400'
                        }`}
                      >
                        {line.shortage > 0 ? formatQty(line.shortage) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
