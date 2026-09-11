/**
 * PHASE P1B — shift production report UI (confirm / read-only / correction).
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { ProductionOrder } from '@/lib/planner/types'
import { collectApprovedImpregnationLineInputs } from '@/lib/production/impregnationLineInput'
import {
  canConfirmShiftReport,
  canCorrectShiftReport,
  canCreateShiftReport,
  computeNormQtyForOutput,
  deviationPct,
  isShiftReportImmutable,
  type ProductionShiftReport,
  type ShiftMaterialActualLine,
} from '@/lib/production/shiftReports'
import type { ProductionLineId, ProductionShift, ProductionStore } from '@/lib/production/types'
import { computeLineMaterialBalances } from '@/lib/warehouse/productionMaterialHandoff'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'
import {
  resolveShiftWasteRouting,
  SHIFT_WASTE_EPSILON,
} from '@/lib/warehouse/productionShiftConsumption'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { AppStore } from '@/lib/types'
import { ProductionShiftReportPrintPreview } from '@/components/production/ProductionShiftReportPrintPreview'
import {
  buildShiftReportPrintModel,
  withCorrectsReportNumber,
} from '@/lib/production/shiftReportPrint'

type Props = {
  orders: ProductionOrder[]
  production: ProductionStore
  warehouse: WarehouseStore
  access: AccessStore
  currentUser: AppUser | null
  appScope: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>
  onConfirm: (input: {
    report: Omit<
      ProductionShiftReport,
      'id' | 'number' | 'status' | 'createdAt' | 'updatedAt' | 'confirmedAt'
    >
    productionOrderId: string
    idempotencyKey: string
  }) =>
    | { ok: boolean; error?: string; report?: ProductionShiftReport }
    | Promise<{ ok: boolean; error?: string; report?: ProductionShiftReport }>
  onCorrect: (input: {
    originalReportId: string
    correctionReason: string
    report: Omit<
      ProductionShiftReport,
      'id' | 'number' | 'status' | 'createdAt' | 'updatedAt' | 'confirmedAt'
    >
    productionOrderId: string
    idempotencyKey: string
  }) =>
    | { ok: boolean; error?: string; report?: ProductionShiftReport }
    | Promise<{ ok: boolean; error?: string; report?: ProductionShiftReport }>
}

export function ProductionShiftReportPanel({
  orders,
  production,
  warehouse,
  access,
  currentUser,
  appScope,
  onConfirm,
  onCorrect,
}: Props) {
  const { t } = useI18n()
  const [orderId, setOrderId] = useState('')
  const [lineId, setLineId] = useState<ProductionLineId>('1')
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [shift, setShift] = useState<ProductionShift>('day')
  const [outputM2, setOutputM2] = useState(0)
  const [rollCount, setRollCount] = useState(0)
  const [actualInput, setActualInput] = useState(0)
  const [impregnationDecisionId, setImpregnationDecisionId] = useState('')
  const [impregnationInput, setImpregnationInput] = useState(0)
  const [wasteQty, setWasteQty] = useState(0)
  const [deviationReason, setDeviationReason] = useState('')
  const [wasteReason, setWasteReason] = useState('')
  const [conversionReason, setConversionReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [viewReportId, setViewReportId] = useState<string | null>(null)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')
  const [printModel, setPrintModel] = useState<
    import('@/lib/production/shiftReportPrint').ShiftReportPrintModel | null
  >(null)

  const activeOrders = useMemo(
    () =>
      orders.filter(
          (o) => o.status === 'active' && Boolean(o.recipeNormSnapshot?.contentHash),
      ),
    [orders],
  )
  const order = activeOrders.find((o) => o.id === orderId)
  const authoritativeOrder = (
    (production as ProductionStore & { g3Orders?: Array<Record<string, unknown>> }).g3Orders ?? []
  ).find((candidate) => String(candidate.id ?? '').trim() === orderId)
  const canonicalLineageRequired =
    Number(authoritativeOrder?.wipContractVersion ?? order?.wipContractVersion) >= 1
  const reports = production.shiftReports ?? []
  const viewReport = viewReportId ? reports.find((r) => r.id === viewReportId) : undefined

  const lineRoute = useMemo(
    () => resolveProductionLineLocation(warehouse, lineId),
    [warehouse, lineId],
  )

  const lineBalances = useMemo(() => {
    if (!order || !lineRoute.ok) return []
    return computeLineMaterialBalances(warehouse, {
      productionOrderId: order.id,
      productionWarehouseId: lineRoute.productionWarehouseId,
      productionLocationId: lineRoute.productionLocationId,
      lineId,
    })
  }, [warehouse, order, lineId, lineRoute])

  const approvedImpregnationInputs = useMemo(() => {
    if (!order || !lineRoute.ok) return []
    return collectApprovedImpregnationLineInputs({
      production,
      warehouse,
      order,
      productionWarehouseId: lineRoute.productionWarehouseId,
      productionLocationId: lineRoute.productionLocationId,
    })
  }, [lineRoute, order, production, warehouse])
  const selectedImpregnation = approvedImpregnationInputs.find(
    (input) => input.decisionId === impregnationDecisionId,
  )

  const primaryItemId = order?.rawMaterialItemId || lineBalances[0]?.itemId
  const primaryItem = warehouse.items.find((item) => item.id === primaryItemId)
  const rawBalances = lineBalances
    .filter((balance) => balance.itemId === primaryItemId && balance.remainingQty > 0)
    .sort(
      (left, right) =>
        String(left.expiryDate ?? '9999-12-31').localeCompare(
          String(right.expiryDate ?? '9999-12-31'),
        ) || String(left.batchNo ?? '').localeCompare(String(right.batchNo ?? '')),
    )
  const rawAvailable = rawBalances.reduce((sum, balance) => sum + balance.remainingQty, 0)
  const snapshot = order?.recipeNormSnapshot
  const normInfo =
    snapshot && primaryItemId
      ? computeNormQtyForOutput(snapshot, primaryItemId, outputM2)
      : undefined
  const expectedM2 =
    order?.m2PerRoll && rollCount > 0 ? rollCount * order.m2PerRoll : undefined
  const convPct =
    expectedM2 != null && expectedM2 > 0 ? deviationPct(outputM2, expectedM2) : 0

  const canMaster = canCreateShiftReport(currentUser)
  const canLine = order
    ? canConfirmShiftReport(appScope, currentUser, lineId, access)
    : false
  const canCorr = canCorrectShiftReport(currentUser)

  function buildMaterialLines(): {
    materialLines: ShiftMaterialActualLine[]
    wasteLines: ProductionShiftReport['wasteLines']
  } {
    if (!primaryItemId || !primaryItem) {
      return { materialLines: [], wasteLines: [] }
    }
    if (!canonicalLineageRequired) {
      if (!normInfo) return { materialLines: [], wasteLines: [] }
      const balance = rawBalances[0]
      const effectiveWasteQty = wasteQty > SHIFT_WASTE_EPSILON ? wasteQty : 0
      return {
        materialLines: [
          {
            lineId: crypto.randomUUID(),
            itemId: primaryItemId,
            itemCodeSnapshot: primaryItem.internalCode,
            itemNameSnapshot: primaryItem.name,
            unitSnapshot: normInfo.unitSnapshot,
            normQty: normInfo.normQty,
            normSource: 'recipe',
            actualInputQty: actualInput,
            wasteQty: effectiveWasteQty,
            processConsumedQty: Math.max(0, actualInput - effectiveWasteQty),
            deviationQty: actualInput - normInfo.normQty,
            deviationPct: deviationPct(actualInput, normInfo.normQty),
            tolerancePct: normInfo.tolerancePct,
            deviationReason: deviationReason || undefined,
            batchNo: balance?.batchNo,
            expiryDate: balance?.expiryDate,
          },
        ],
        wasteLines:
          effectiveWasteQty > SHIFT_WASTE_EPSILON
            ? [
                {
                  lineId: crypto.randomUUID(),
                  itemId: primaryItemId,
                  batchNo: balance?.batchNo,
                  expiryDate: balance?.expiryDate,
                  quantity: effectiveWasteQty,
                  unitSnapshot: normInfo.unitSnapshot,
                  reasonCode: wasteReason || 'process_waste',
                  comment: wasteReason,
                },
              ]
            : [],
      }
    }
    if (!selectedImpregnation) return { materialLines: [], wasteLines: [] }
    let rawRemaining = actualInput
    let wasteRemaining = wasteQty > SHIFT_WASTE_EPSILON ? wasteQty : 0
    const materialLines: ShiftMaterialActualLine[] = []
    const wasteLines: ProductionShiftReport['wasteLines'] = []
    for (const balance of rawBalances) {
      if (rawRemaining <= SHIFT_WASTE_EPSILON) break
      const quantity = Math.min(rawRemaining, balance.remainingQty)
      const lineWaste = Math.min(wasteRemaining, quantity)
      const lineIdValue = crypto.randomUUID()
      materialLines.push({
        lineId: lineIdValue,
        itemId: primaryItemId,
        itemCodeSnapshot: primaryItem.internalCode,
        itemNameSnapshot: primaryItem.name,
        unitSnapshot: primaryItem.unit,
        normQty: quantity,
        normSource: 'fact_only',
        actualInputQty: quantity,
        wasteQty: lineWaste,
        processConsumedQty: quantity - lineWaste,
        deviationQty: 0,
        deviationPct: 0,
        tolerancePct: 0,
        deviationReason: deviationReason || undefined,
        batchNo: balance.batchNo,
        expiryDate: balance.expiryDate,
      })
      if (lineWaste > SHIFT_WASTE_EPSILON) {
        wasteLines.push({
          lineId: crypto.randomUUID(),
          itemId: primaryItemId,
          batchNo: balance.batchNo,
          expiryDate: balance.expiryDate,
          quantity: lineWaste,
          unitSnapshot: primaryItem.unit,
          reasonCode: wasteReason || 'process_waste',
          comment: wasteReason,
        })
      }
      rawRemaining -= quantity
      wasteRemaining -= lineWaste
    }

    const impregnationItem = warehouse.items.find(
      (item) => item.id === selectedImpregnation.outputWarehouseItemId,
    )
    if (impregnationItem && impregnationInput > SHIFT_WASTE_EPSILON) {
      materialLines.push({
        lineId: crypto.randomUUID(),
        itemId: selectedImpregnation.outputWarehouseItemId,
        itemCodeSnapshot: impregnationItem.internalCode,
        itemNameSnapshot: impregnationItem.name,
        unitSnapshot: selectedImpregnation.unitSnapshot,
        normQty: impregnationInput,
        normSource: 'fact_only',
        actualInputQty: impregnationInput,
        wasteQty: 0,
        processConsumedQty: impregnationInput,
        deviationQty: 0,
        deviationPct: 0,
        tolerancePct: 0,
        batchNo: selectedImpregnation.batchNo,
        batchRunId: selectedImpregnation.batchRunId,
      })
    }
    return { materialLines, wasteLines }
  }

  async function handleConfirm() {
    setNotice(null)
    if (
      !order ||
      !snapshot ||
      !primaryItemId ||
      !primaryItem ||
      actualInput <= SHIFT_WASTE_EPSILON ||
      actualInput > rawAvailable + SHIFT_WASTE_EPSILON ||
      outputM2 <= SHIFT_WASTE_EPSILON ||
      wasteQty > actualInput + SHIFT_WASTE_EPSILON ||
      (canonicalLineageRequired &&
        (!selectedImpregnation ||
          impregnationInput <= SHIFT_WASTE_EPSILON ||
          impregnationInput > selectedImpregnation.availableQuantity + SHIFT_WASTE_EPSILON))
    ) {
      setNotice(t('production.shift.errSetup'))
      return
    }
    const pack = resolveProductionLineLocation(warehouse, 'pack')
    const line = resolveProductionLineLocation(warehouse, lineId)
    if (!pack.ok || !line.ok || !order.semiFinishedItemId) {
      setNotice(t('production.shift.errSetup'))
      return
    }
    const { materialLines, wasteLines } = buildMaterialLines()
    if (!materialLines.length || (wasteQty > SHIFT_WASTE_EPSILON && !wasteReason.trim())) {
      setNotice(t('production.shift.errSetup'))
      return
    }
    const wasteRouting = resolveShiftWasteRouting(
      warehouse,
      wasteLines,
      warehouse.scrapLocationId,
      line,
    )
    if (!wasteRouting.ok) {
      setNotice(t(wasteRouting.error))
      return
    }
    const reportBase = {
      productionOrderId: order.id,
      lineId,
      shiftDate,
      shift,
      recipeNormSnapshot: snapshot,
      productionWarehouseId: line.productionWarehouseId,
      productionLocationId: line.productionLocationId,
      packagingWarehouseId: pack.productionWarehouseId,
      packagingLocationId: pack.productionLocationId,
      scrapLocationId: wasteRouting.scrapLocationId,
      materialLines,
      wasteLines: wasteRouting.wasteLines,
      outputM2,
      rollCount,
      m2PerRollSnapshot: order.m2PerRoll,
      conversionTolerancePct: 5,
      conversionDeviationReason: conversionReason || undefined,
      semiFinishedItemId: order.semiFinishedItemId,
      semiFinishedUnitSnapshot: warehouse.items.find(
        (item) => item.id === order.semiFinishedItemId,
      )?.unit,
      wipContractVersion: canonicalLineageRequired ? (1 as const) : undefined,
      ...(selectedImpregnation
        ? {
            impregnationQcDecisionId: selectedImpregnation.decisionId,
            batchRunId: selectedImpregnation.batchRunId,
          }
        : {}),
      idempotencyKey: canonicalLineageRequired
        ? `shift:${order.id}:${lineId}:${shiftDate}:${shift}:${outputM2}:${actualInput}:${selectedImpregnation!.batchRunId}:${impregnationInput}`
        : `shift:${order.id}:${lineId}:${shiftDate}:${shift}:${outputM2}:${actualInput}`,
    }

    if (correctionMode && viewReport) {
      const res = await onCorrect({
        originalReportId: viewReport.id,
        correctionReason,
        productionOrderId: order.id,
        idempotencyKey: `${reportBase.idempotencyKey}:corr:${crypto.randomUUID()}`,
        report: reportBase,
      })
      setNotice(res.ok ? t('production.shift.corrected') : t(res.error || 'production.shift.errGeneric'))
      if (res.ok) {
        setCorrectionMode(false)
        setViewReportId(null)
      }
      return
    }

    const res = await onConfirm({
      productionOrderId: order.id,
      idempotencyKey: reportBase.idempotencyKey,
      report: reportBase,
    })
    setNotice(res.ok ? t('production.shift.confirmed') : t(res.error || 'production.shift.errGeneric'))
    if (res.ok && res.report) setViewReportId(res.report.id)
  }

  if (viewReport && isShiftReportImmutable(viewReport) && !correctionMode) {
    return (
      <div className="space-y-3 rounded-lg border border-[var(--fc-border)] bg-[var(--fc-surface)] p-4">
        <h3 className="text-sm font-semibold">{t('production.shift.title')}</h3>
        {notice && <FormNotice type="info" message={notice} />}
        <p className="text-xs text-[var(--fc-muted)]">{t('production.shift.readOnly')}</p>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.shift.number')}</dt>
            <dd>{viewReport.number}</dd>
          </div>
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.date')}</dt>
            <dd>{viewReport.shiftDate}</dd>
          </div>
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.line')}</dt>
            <dd>{viewReport.lineId}</dd>
          </div>
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.shift.outputM2')}</dt>
            <dd>{viewReport.outputM2}</dd>
          </div>
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.shift.rolls')}</dt>
            <dd>{viewReport.rollCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--fc-muted)]">{t('production.shift.master')}</dt>
            <dd>{viewReport.responsibleNameSnapshot || '—'}</dd>
          </div>
        </dl>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">{t('production.shift.item')}</th>
              <th>{t('production.shift.norm')}</th>
              <th>{t('production.shift.fact')}</th>
              <th>{t('production.shift.deviation')}</th>
              <th>{t('production.shift.waste')}</th>
            </tr>
          </thead>
          <tbody>
            {viewReport.materialLines.map((l) => (
              <tr key={l.lineId} className="border-b border-[var(--fc-border)]/60">
                <td className="py-1">{l.itemNameSnapshot || l.itemId}</td>
                <td>{l.normSource === 'fact_only' ? '—' : l.normQty.toFixed(3)}</td>
                <td>{l.actualInputQty.toFixed(3)}</td>
                <td>
                  {l.normSource === 'fact_only'
                    ? '—'
                    : `${l.deviationQty.toFixed(3)} (${l.deviationPct.toFixed(1)}%)`}
                </td>
                <td>{l.wasteQty.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setViewReportId(null)}>
            {t('production.shift.newReport')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const orderForPrint = orders.find((o) => o.id === viewReport.productionOrderId)
              const model = withCorrectsReportNumber(
                buildShiftReportPrintModel(viewReport, {
                  order: orderForPrint,
                  warehouse,
                }),
                reports,
                viewReport.correctsReportId,
              )
              setPrintModel(model)
            }}
          >
            {t('production.shift.print')}
          </Button>
          {canCorr && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const orderForCorrection = orders.find(
                  (candidate) => candidate.id === viewReport.productionOrderId,
                )
                const decisionForCorrection = (production.impregnationQcDecisions ?? []).find(
                  (candidate) =>
                    (candidate.id ?? candidate.decisionId) ===
                    viewReport.impregnationQcDecisionId,
                )
                const impregnationLine = decisionForCorrection
                  ? viewReport.materialLines.find(
                      (line) => line.itemId === decisionForCorrection.outputWarehouseItemId,
                    )
                  : undefined
                setCorrectionMode(true)
                setOrderId(viewReport.productionOrderId)
                setLineId(viewReport.lineId)
                setShiftDate(viewReport.shiftDate)
                setShift(viewReport.shift)
                setOutputM2(viewReport.outputM2)
                setRollCount(viewReport.rollCount)
                setActualInput(
                  viewReport.materialLines
                    .filter((line) => line.itemId === orderForCorrection?.rawMaterialItemId)
                    .reduce((sum, line) => sum + line.actualInputQty, 0),
                )
                setImpregnationDecisionId(viewReport.impregnationQcDecisionId ?? '')
                setImpregnationInput(impregnationLine?.actualInputQty ?? 0)
                setWasteQty(
                  (viewReport.wasteLines ?? []).reduce((sum, line) => sum + line.quantity, 0),
                )
              }}
            >
              {t('production.shift.createCorrection')}
            </Button>
          )}
        </div>
        {printModel && (
          <ProductionShiftReportPrintPreview
            model={printModel}
            onClose={() => setPrintModel(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--fc-border)] bg-[var(--fc-surface)] p-4">
      <h3 className="text-sm font-semibold">
        {correctionMode ? t('production.shift.correctionTitle') : t('production.shift.title')}
      </h3>
      {notice && <FormNotice type={notice.includes('err') || /ошиб|fail|error/i.test(notice) ? 'error' : 'success'} message={notice} />}
      {!canMaster && (
        <p className="text-xs text-amber-700">{t('production.shift.errForbidden')}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs">
          {t('production.shift.order')}
          <select
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={orderId}
            onChange={(e) => {
              const nextOrderId = e.target.value
              const nextOrder = activeOrders.find((candidate) => candidate.id === nextOrderId)
              setOrderId(nextOrderId)
              if (nextOrder) setLineId(nextOrder.lineId)
              setImpregnationDecisionId('')
              setImpregnationInput(0)
            }}
          >
            <option value="">{t('production.shift.pickOrder')}</option>
            {activeOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} · {o.productName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          {t('production.line')}
          <select
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={lineId}
            onChange={(e) => {
              setLineId(e.target.value as ProductionLineId)
              setImpregnationDecisionId('')
              setImpregnationInput(0)
            }}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label className="text-xs">
          {t('production.date')}
          <input
            type="date"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
          />
        </label>
        <label className="text-xs">
          {t('production.shift.shift')}
          <select
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={shift}
            onChange={(e) => setShift(e.target.value as ProductionShift)}
          >
            <option value="day">{t('production.shift.day')}</option>
            <option value="night">{t('production.shift.night')}</option>
          </select>
        </label>
        <label className="text-xs">
          {t('production.shift.outputM2')}
          <input
            type="number"
            min={0}
            step="0.01"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={outputM2 || ''}
            onChange={(e) => setOutputM2(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs">
          {t('production.shift.rolls')}
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={rollCount || ''}
            onChange={(e) => setRollCount(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs">
          {t('production.shift.rawActualInput')}
          <input
            type="number"
            min={0}
            step="0.001"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={actualInput || ''}
            onChange={(e) => setActualInput(Number(e.target.value) || 0)}
          />
        </label>
        {canonicalLineageRequired && (
          <>
            <label className="text-xs">
              {t('production.shift.impregnationBatch')}
              <select
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={impregnationDecisionId}
                onChange={(event) => {
                  setImpregnationDecisionId(event.target.value)
                  setImpregnationInput(0)
                }}
                data-testid="production-shift-impregnation-batch"
              >
                <option value="">{t('production.shift.pickImpregnationBatch')}</option>
                {approvedImpregnationInputs.map((input) => (
                  <option key={input.decisionId} value={input.decisionId}>
                    {input.batchNo} · {input.availableQuantity.toFixed(3)} {input.unitSnapshot}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t('production.shift.impregnationActualInput')}
              <input
                type="number"
                min={0}
                max={selectedImpregnation?.availableQuantity}
                step="0.001"
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={impregnationInput || ''}
                onChange={(event) => setImpregnationInput(Number(event.target.value) || 0)}
                disabled={!selectedImpregnation}
                data-testid="production-shift-impregnation-quantity"
              />
            </label>
          </>
        )}
        <label className="text-xs">
          {t('production.shift.waste')}
          <input
            type="number"
            min={0}
            step="0.001"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={wasteQty || ''}
            onChange={(e) => setWasteQty(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      {canonicalLineageRequired && order && lineRoute.ok && approvedImpregnationInputs.length === 0 && (
        <FormNotice type="info" message={t('production.shift.errImpregnationQcRequired')} />
      )}
      {selectedImpregnation && (
        <p className="text-xs text-[var(--fc-muted)]" data-testid="production-shift-qc-lineage">
          {t('production.shift.qcLineage')}: {selectedImpregnation.decisionKey} ·{' '}
          {selectedImpregnation.batchReceiptDocumentId}
        </p>
      )}

      {(normInfo || (order && canonicalLineageRequired)) && (
        <div className="rounded border border-dashed border-[var(--fc-border)] p-2 text-xs">
          {normInfo ? (
            <>
              <p>
                {t('production.shift.norm')}: {normInfo.normQty.toFixed(3)}{' '}
                {normInfo.unitSnapshot} (±{normInfo.tolerancePct}%)
              </p>
              <p>
                {t('production.shift.deviation')}:{' '}
                {(actualInput - normInfo.normQty).toFixed(3)} (
                {deviationPct(actualInput, normInfo.normQty).toFixed(1)}%)
              </p>
            </>
          ) : (
            <p>{t('production.shift.factOnlyInputs')}</p>
          )}
          {expectedM2 != null && (
            <p>
              {t('production.shift.expectedM2')}: {expectedM2.toFixed(2)} · Δ {convPct.toFixed(1)}%
            </p>
          )}
          <p>
            {t('production.shift.atLine')}:{' '}
            {lineBalances
              .filter((b) => b.remainingQty > 0)
              .map((b) => `${b.itemId.slice(0, 8)}… ${b.remainingQty} (${b.batchNo || '—'})`)
              .join('; ') || '—'}
          </p>
          {selectedImpregnation && (
            <p>
              {t('production.shift.impregnationAtLine')}:{' '}
              {selectedImpregnation.availableQuantity.toFixed(3)}{' '}
              {selectedImpregnation.unitSnapshot} ({selectedImpregnation.batchNo})
            </p>
          )}
        </div>
      )}

      <label className="block text-xs">
        {t('production.shift.deviationReason')}
        <input
          className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          value={deviationReason}
          onChange={(e) => setDeviationReason(e.target.value)}
        />
      </label>
      {wasteQty > 0 && (
        <label className="block text-xs">
          {t('production.shift.wasteReason')}
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={wasteReason}
            onChange={(e) => setWasteReason(e.target.value)}
          />
        </label>
      )}
      <label className="block text-xs">
        {t('production.shift.conversionReason')}
        <input
          className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          value={conversionReason}
          onChange={(e) => setConversionReason(e.target.value)}
        />
      </label>
      {correctionMode && (
        <label className="block text-xs">
          {t('production.shift.correctionReason')}
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
          />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!canMaster || (!canLine && currentUser?.roleId === 'workshop_master')}
          onClick={handleConfirm}
        >
          {correctionMode ? t('production.shift.confirmCorrection') : t('production.shift.confirm')}
        </Button>
        {reports.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const last = reports.filter((r) => r.status === 'confirmed').at(-1)
              if (last) {
                setViewReportId(last.id)
                setCorrectionMode(false)
              }
            }}
          >
            {t('production.shift.viewLast')}
          </Button>
        )}
      </div>
    </div>
  )
}
