/**
 * PHASE P1B — shift production report UI (confirm / read-only / correction).
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { ProductionOrder } from '@/lib/planner/types'
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
  const reports = production.shiftReports ?? []
  const viewReport = viewReportId ? reports.find((r) => r.id === viewReportId) : undefined

  const lineBalances = useMemo(() => {
    if (!order) return []
    const resolved = resolveProductionLineLocation(warehouse, lineId)
    if (!resolved.ok) return []
    return computeLineMaterialBalances(warehouse, {
      productionOrderId: order.id,
      productionLocationId: resolved.productionLocationId,
    })
  }, [warehouse, order, lineId])

  const primaryItemId = order?.rawMaterialItemId || lineBalances[0]?.itemId
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

  function buildMaterialLines(): ShiftMaterialActualLine[] {
    if (!primaryItemId || !normInfo) return []
    const bal = lineBalances.find((b) => b.itemId === primaryItemId && b.remainingQty > 0)
    const processConsumedQty = Math.max(0, actualInput - wasteQty)
    const devPct = deviationPct(actualInput, normInfo.normQty)
    return [
      {
        lineId: crypto.randomUUID(),
        itemId: primaryItemId,
        unitSnapshot: normInfo.unitSnapshot,
        normQty: normInfo.normQty,
        actualInputQty: actualInput,
        wasteQty,
        processConsumedQty,
        deviationQty: actualInput - normInfo.normQty,
        deviationPct: devPct,
        tolerancePct: normInfo.tolerancePct,
        deviationReason: deviationReason || undefined,
        batchNo: bal?.batchNo,
        expiryDate: bal?.expiryDate,
      },
    ]
  }

  async function handleConfirm() {
    setNotice(null)
    if (!order || !snapshot || !primaryItemId) {
      setNotice(t('production.shift.errSetup'))
      return
    }
    const scrapId = warehouse.scrapLocationId
    const pack = resolveProductionLineLocation(warehouse, 'pack')
    const line = resolveProductionLineLocation(warehouse, lineId)
    if (!scrapId || !pack.ok || !line.ok || !order.semiFinishedItemId) {
      setNotice(t('production.shift.errSetup'))
      return
    }
    const materialLines = buildMaterialLines()
    const reportBase = {
      productionOrderId: order.id,
      lineId,
      shiftDate,
      shift,
      recipeNormSnapshot: snapshot,
      productionLocationId: line.productionLocationId,
      packagingLocationId: pack.productionLocationId,
      scrapLocationId: scrapId,
      materialLines,
      wasteLines:
        wasteQty > 0
          ? [
              {
                lineId: crypto.randomUUID(),
                itemId: primaryItemId,
                batchNo: materialLines[0]?.batchNo,
                expiryDate: materialLines[0]?.expiryDate,
                quantity: wasteQty,
                unitSnapshot: materialLines[0]?.unitSnapshot || 'kg',
                reasonCode: wasteReason || 'process_waste',
                comment: wasteReason,
              },
            ]
          : [],
      outputM2,
      rollCount,
      m2PerRollSnapshot: order.m2PerRoll,
      conversionTolerancePct: 5,
      conversionDeviationReason: conversionReason || undefined,
      semiFinishedItemId: order.semiFinishedItemId,
      idempotencyKey: `shift:${order.id}:${lineId}:${shiftDate}:${shift}:${outputM2}:${actualInput}`,
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
                <td>{l.normQty.toFixed(3)}</td>
                <td>{l.actualInputQty.toFixed(3)}</td>
                <td>
                  {l.deviationQty.toFixed(3)} ({l.deviationPct.toFixed(1)}%)
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
                setCorrectionMode(true)
                setOrderId(viewReport.productionOrderId)
                setLineId(viewReport.lineId)
                setOutputM2(viewReport.outputM2)
                setRollCount(viewReport.rollCount)
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
            onChange={(e) => setOrderId(e.target.value)}
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
            onChange={(e) => setLineId(e.target.value as ProductionLineId)}
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
          {t('production.shift.actualInput')}
          <input
            type="number"
            min={0}
            step="0.001"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            value={actualInput || ''}
            onChange={(e) => setActualInput(Number(e.target.value) || 0)}
          />
        </label>
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

      {normInfo && (
        <div className="rounded border border-dashed border-[var(--fc-border)] p-2 text-xs">
          <p>
            {t('production.shift.norm')}: {normInfo.normQty.toFixed(3)} {normInfo.unitSnapshot} (±
            {normInfo.tolerancePct}%)
          </p>
          <p>
            {t('production.shift.deviation')}:{' '}
            {(actualInput - normInfo.normQty).toFixed(3)} (
            {deviationPct(actualInput, normInfo.normQty).toFixed(1)}%)
          </p>
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
