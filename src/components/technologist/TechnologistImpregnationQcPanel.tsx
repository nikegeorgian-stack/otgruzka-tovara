import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import type { FormulationStore } from '@/lib/formulations/types'
import {
  computeImpregnationQc,
  qcStatusLabel,
  resolveImpregnationQcComputed,
  theoreticalNvFromRecipe,
} from '@/lib/technologist/calc'
import {
  impregnationQcDecisionKey,
  isEduManualVisualUiEnabled,
  resolveImpregnationQcDecisionStream,
  type AuthoritativeImpregnationQcDecisionSnapshot,
  type AuthorizeImpregnationQcDecision,
  type ConfirmedImpregnationMixerBatch,
  type ImpregnationQcDecision,
  type ImpregnationQcDecisionMethod,
  type ImpregnationQcRecord,
  type TechnologistQcStore,
} from '@/lib/technologist/types'
import { QcStatusBadge } from './QcStatusBadge'

type Props = {
  store: TechnologistQcStore
  formulations: FormulationStore
  confirmedMixerBatches: ConfirmedImpregnationMixerBatch[]
  authoritativeDecisions?: AuthoritativeImpregnationQcDecisionSnapshot[]
  operatorName?: string
  allowEduManualVisual?: boolean
  onAuthorizeDecision?: AuthorizeImpregnationQcDecision
  onSave: (
    entry: Omit<ImpregnationQcRecord, 'computed' | 'id' | 'createdAt'> & { id?: string },
  ) => void
  onRemove: (id: string) => void
}

type Notice = { type: 'error' | 'success' | 'info'; message: string }

type DisplayRecord = ImpregnationQcRecord & {
  authoritativeDisplayState?: 'current' | 'superseded' | 'missing' | 'unavailable'
}

function num(value: string): number | undefined {
  const parsed = parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function decisionLabel(decision: ImpregnationQcDecision | undefined): string {
  if (decision === 'approved') return 'Допущено'
  if (decision === 'rejected') return 'Отклонено'
  return 'Историческая запись'
}

export function TechnologistImpregnationQcPanel({
  store,
  formulations,
  confirmedMixerBatches,
  authoritativeDecisions,
  operatorName,
  allowEduManualVisual = false,
  onAuthorizeDecision,
  onSave,
  onRemove,
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const [batchRunId, setBatchRunId] = useState('')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [controlledAt, setControlledAt] = useState('')
  const [operators, setOperators] = useState('')
  const [visualOk, setVisualOk] = useState(true)
  const [m0, setM0] = useState('')
  const [m1, setM1] = useState('')
  const [m2, setM2] = useState('')
  const [viscositySec, setViscositySec] = useState('')
  const [viscosityTempC, setViscosityTempC] = useState('')
  const [theoreticalNv, setTheoreticalNv] = useState('')
  const [tolerance, setTolerance] = useState(String(store.settings.defaultNvTolerancePp))
  const [controllerName, setControllerName] = useState('')
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState<ImpregnationQcDecision | ''>('')
  const [decisionMethod, setDecisionMethod] =
    useState<ImpregnationQcDecisionMethod>('measured')
  const [decisionReason, setDecisionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const selectedBatch = confirmedMixerBatches.find((batch) => batch.batchRunId === batchRunId)
  const selectedRecipe = selectedBatch
    ? formulations.recipes.find((recipe) => recipe.id === selectedBatch.recipeId)
    : undefined
  const decisionStream = useMemo(
    () =>
      selectedBatch && authoritativeDecisions
        ? resolveImpregnationQcDecisionStream(authoritativeDecisions, selectedBatch)
        : null,
    [authoritativeDecisions, selectedBatch],
  )
  const currentDecision = decisionStream?.ok ? decisionStream.current : null
  const nextDecisionRevision = decisionStream?.ok ? decisionStream.nextRevision : 1
  const currentDecisionId = decisionStream?.ok ? decisionStream.currentDecisionId : undefined
  const manualVisualEnabled = isEduManualVisualUiEnabled(
    import.meta.env.VITE_FIREBASE_PROJECT_ID,
    allowEduManualVisual,
  )

  function selectBatch(nextBatchRunId: string) {
    setBatchRunId(nextBatchRunId)
    setNotice(null)
    setDecision('')
    setDecisionReason('')
    const batch = confirmedMixerBatches.find((candidate) => candidate.batchRunId === nextBatchRunId)
    if (!batch) {
      setManufacturedAt('')
      setTheoreticalNv('')
      return
    }
    setManufacturedAt(batch.mixedAt?.slice(0, 10) ?? '')
    const recipe = formulations.recipes.find((candidate) => candidate.id === batch.recipeId)
    const theoretical = recipe ? theoreticalNvFromRecipe(recipe) : null
    setTheoreticalNv(theoretical != null ? String(theoretical) : '')
  }

  const live = useMemo(
    () =>
      computeImpregnationQc({
        gravimetric: { m0: num(m0), m1: num(m1), m2: num(m2) },
        theoreticalNvPct: num(theoreticalNv),
        nvTolerancePp: num(tolerance) ?? store.settings.defaultNvTolerancePp,
      }),
    [m0, m1, m2, theoreticalNv, tolerance, store.settings.defaultNvTolerancePp],
  )

  const trimmedDecisionReason = decisionReason.trim()
  const decisionReady = (() => {
    if (!authoritativeDecisions) return false
    if (!decisionStream?.ok) return false
    if (currentDecision && !currentDecisionId) return false
    if (!decision) return false
    if (currentDecision && !trimmedDecisionReason) return false
    if (decision === 'rejected' && !trimmedDecisionReason) return false
    if (decisionMethod === 'measured') {
      // Browser calculations are useful for review, but cannot authorize a
      // measured release until the server owns and verifies immutable lab
      // evidence. A measured rejection is still safe and remains available.
      return decision !== 'approved'
    }
    if (!manualVisualEnabled) return false
    return decision === 'approved' ? visualOk && Boolean(trimmedDecisionReason) : true
  })()
  const canSubmit = Boolean(
    selectedBatch && onAuthorizeDecision && authoritativeDecisions && decisionReady && !submitting,
  )

  const blockReason = (() => {
    if (!onAuthorizeDecision) return 'Authoritative QC-команда недоступна. Решение не будет сохранено.'
    if (!authoritativeDecisions) {
      return 'Authoritative история решений не загружена. Обновите данные перед проводкой.'
    }
    if (confirmedMixerBatches.length === 0) {
      return 'Нет подтверждённого замеса с полной связью заказ → линия → складские документы.'
    }
    if (!selectedBatch) return 'Выберите подтверждённую партию из списка.'
    if (decisionStream && !decisionStream.ok) {
      return `История authoritative-решений партии некорректна: ${decisionStream.error}.`
    }
    if (currentDecision && !currentDecisionId) {
      return 'У действующего authoritative-решения отсутствует стабильный ID.'
    }
    if (!decision) return 'Выберите отдельное решение: допустить или отклонить.'
    if (currentDecision && !trimmedDecisionReason) {
      return `Версия ${nextDecisionRevision} заменяет действующее решение; укажите причину замены.`
    }
    if (decision === 'rejected' && !trimmedDecisionReason) {
      return 'Для отклонения укажите причину.'
    }
    if (decisionMethod === 'measured' && decision === 'approved') {
      return live.status !== 'pass'
        ? 'Измеренный допуск возможен только при лабораторном статусе «норма».'
        : 'Измеренный допуск ожидает серверный источник лабораторных доказательств.'
    }
    if (decisionMethod === 'edu_manual_visual' && !manualVisualEnabled) {
      return 'Учебный визуальный допуск разрешён только в изолированном staging.'
    }
    if (decisionMethod === 'edu_manual_visual' && decision === 'approved' && !visualOk) {
      return 'Для учебного визуального допуска подтвердите визуальный контроль.'
    }
    if (
      decisionMethod === 'edu_manual_visual' &&
      decision === 'approved' &&
      !trimmedDecisionReason
    ) {
      return 'Для учебного визуального допуска укажите явное основание.'
    }
    return ''
  })()

  async function submitDecision() {
    if (!canSubmit || !selectedBatch || !decision || !onAuthorizeDecision) return
    setSubmitting(true)
    setNotice(null)
    try {
      const decisionKey = impregnationQcDecisionKey(
        selectedBatch.batchRunId,
        nextDecisionRevision,
      )
      const result = await onAuthorizeDecision({
        decisionKey,
        decisionRevision: nextDecisionRevision,
        productionOrderId: selectedBatch.productionOrderId,
        productionLineId: selectedBatch.productionLineId,
        batchRunId: selectedBatch.batchRunId,
        batchReceiptDocumentId: selectedBatch.batchReceiptDocumentId,
        outputWarehouseItemId: selectedBatch.outputWarehouseItemId,
        labStatus: live.status,
        decision,
        decisionMethod,
        visualOk,
        reason: trimmedDecisionReason || undefined,
        sourceQcRecordId: `technologist-impregnation:${selectedBatch.batchRunId}`,
        supersedesDecisionId: currentDecisionId,
        supersessionReason: currentDecision ? trimmedDecisionReason : undefined,
      })
      if (!result.ok) {
        setNotice({ type: 'error', message: result.error })
        return
      }
      const acknowledgementMatches =
        Boolean(String(result.decisionId ?? '').trim()) &&
        result.decisionKey === decisionKey &&
        result.decisionRevision === nextDecisionRevision &&
        result.decision === decision &&
        result.labStatus === live.status &&
        result.decisionMethod === decisionMethod &&
        result.productionOrderId === selectedBatch.productionOrderId &&
        result.productionLineId === selectedBatch.productionLineId &&
        result.batchRunId === selectedBatch.batchRunId &&
        result.batchNo === selectedBatch.batchNo &&
        result.batchIssueDocumentId === selectedBatch.batchIssueDocumentId &&
        result.batchReceiptDocumentId === selectedBatch.batchReceiptDocumentId &&
        result.outputWarehouseItemId === selectedBatch.outputWarehouseItemId &&
        Math.abs(result.outputQuantity - selectedBatch.outputQuantity) <= 1e-9 &&
        result.effective === true &&
        result.lineReady === (decision === 'approved') &&
        result.supersedesDecisionId === currentDecisionId &&
        result.supersessionReason === (currentDecision ? trimmedDecisionReason : undefined) &&
        !result.supersededByDecisionId &&
        /^[a-f0-9]{64}$/.test(String(result.commandFingerprint ?? '')) &&
        Boolean(String(result.actorUid ?? '').trim()) &&
        Boolean(String(result.decidedAt ?? '').trim()) &&
        Number.isInteger(result.criticalRevision) &&
        result.criticalRevision > 0
      if (!acknowledgementMatches) {
        setNotice({ type: 'error', message: 'impregnation_qc_ack_mismatch' })
        return
      }

      onSave({
        id: result.decisionId,
        recipeId: selectedBatch.recipeId || undefined,
        recipeCode: selectedBatch.recipeCode || selectedRecipe?.code,
        batchNumber: result.batchNo,
        batchRunId: result.batchRunId,
        batchIssueDocumentId: result.batchIssueDocumentId,
        batchReceiptDocumentId: result.batchReceiptDocumentId,
        productionOrderId: result.productionOrderId,
        productionLineId: result.productionLineId,
        outputWarehouseItemId: result.outputWarehouseItemId,
        outputQuantity: result.outputQuantity,
        manufacturedAt: manufacturedAt || undefined,
        controlledAt: controlledAt || undefined,
        operators: operators || undefined,
        visualOk,
        gravimetric: { m0: num(m0), m1: num(m1), m2: num(m2) },
        viscositySec: num(viscositySec),
        viscosityTempC: num(viscosityTempC),
        theoreticalNvPct: num(theoreticalNv),
        nvTolerancePp: num(tolerance) ?? store.settings.defaultNvTolerancePp,
        controllerName: controllerName || operatorName,
        note: note || undefined,
        labStatus: result.labStatus,
        decision: result.decision,
        decisionMethod: result.decisionMethod,
        decisionReason: trimmedDecisionReason || undefined,
        decisionRevision: result.decisionRevision,
        effective: result.effective,
        supersedesDecisionId: result.supersedesDecisionId,
        supersessionReason: result.supersessionReason,
        supersededByDecisionId: result.supersededByDecisionId,
        supersededAt: result.supersededAt,
        authoritativeDecisionId: result.decisionId,
        authoritativeDecisionKey: result.decisionKey,
        authoritativeCommandFingerprint: result.commandFingerprint,
        authoritativeActorUid: result.actorUid,
        authoritativeDecidedAt: result.decidedAt,
        authoritativeCriticalRevision: result.criticalRevision,
      })
      setNotice({
        type: 'success',
        message: result.idempotent
          ? 'Решение уже было подтверждено сервером; повторная проводка не создана.'
          : 'Решение подтверждено authoritative state.',
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'impregnation_qc_command_failed',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const rows = useMemo<DisplayRecord[]>(() => {
    const localRows = store.impregnationQc
    if (!authoritativeDecisions) {
      return [...localRows]
        .map((record) => ({
          ...record,
          authoritativeDisplayState: record.authoritativeDecisionId
            ? ('unavailable' as const)
            : undefined,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }

    const authoritativeIds = new Set(
      authoritativeDecisions
        .map((row) => String(row.id ?? row.decisionId ?? '').trim())
        .filter(Boolean),
    )
    const authoritativeRows: DisplayRecord[] = authoritativeDecisions.map((row) => {
      const decisionId = String(row.id ?? row.decisionId ?? row.decisionKey).trim()
      const local = localRows.find(
        (record) => record.authoritativeDecisionId === decisionId,
      )
      const batch = confirmedMixerBatches.find(
        (candidate) => candidate.batchRunId === row.batchRunId,
      )
      const fallback: ImpregnationQcRecord = {
        id: decisionId,
        recipeId: batch?.recipeId,
        recipeCode: batch?.recipeCode,
        batchNumber: row.batchNo,
        gravimetric: {},
        nvTolerancePp: store.settings.defaultNvTolerancePp,
        computed: {
          nvPct: null,
          absDeviationPp: null,
          relDeviation: null,
          status: row.labStatus,
        },
        createdAt: row.decidedAt ?? '',
      }
      return {
        ...fallback,
        ...local,
        id: decisionId,
        batchNumber: row.batchNo,
        batchRunId: row.batchRunId,
        batchIssueDocumentId: row.batchIssueDocumentId,
        batchReceiptDocumentId: row.batchReceiptDocumentId,
        productionOrderId: row.productionOrderId,
        productionLineId: row.productionLineId,
        outputWarehouseItemId: row.outputWarehouseItemId,
        outputQuantity: row.outputQuantity,
        visualOk: row.visualOk ?? local?.visualOk,
        labStatus: row.labStatus,
        decision: row.decision,
        decisionMethod: row.decisionMethod,
        decisionReason: row.reason ?? row.supersessionReason ?? local?.decisionReason,
        decisionRevision: row.decisionRevision,
        effective: row.effective,
        supersedesDecisionId: row.supersedesDecisionId,
        supersessionReason: row.supersessionReason,
        supersededByDecisionId: row.supersededByDecisionId,
        supersededAt: row.supersededAt,
        authoritativeDecisionId: decisionId,
        authoritativeDecisionKey: row.decisionKey,
        authoritativeCommandFingerprint:
          row.commandFingerprint ?? local?.authoritativeCommandFingerprint,
        authoritativeActorUid: row.actorUid ?? local?.authoritativeActorUid,
        authoritativeDecidedAt: row.decidedAt ?? local?.authoritativeDecidedAt,
        authoritativeDisplayState:
          row.effective === false || row.supersededByDecisionId ? 'superseded' : 'current',
      }
    })
    const localOnly = localRows
      .filter(
        (record) =>
          !record.authoritativeDecisionId ||
          !authoritativeIds.has(record.authoritativeDecisionId),
      )
      .map<DisplayRecord>((record) => ({
        ...record,
        authoritativeDisplayState: record.authoritativeDecisionId ? 'missing' : undefined,
      }))
    return [...authoritativeRows, ...localOnly].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }, [authoritativeDecisions, confirmedMixerBatches, store.impregnationQc, store.settings.defaultNvTolerancePp])

  return (
    <div className="space-y-4">
      <Card title={t('technologist.qc.impreg.title')} description={t('technologist.qc.impreg.hint')}>
        <div className="mb-4 space-y-2">
          {notice && (
            <FormNotice
              type={notice.type}
              message={notice.message}
              onDismiss={() => setNotice(null)}
            />
          )}
          {!onAuthorizeDecision && <FormNotice type="error" message={blockReason} />}
          {onAuthorizeDecision && confirmedMixerBatches.length === 0 && (
            <FormNotice type="info" message={blockReason} />
          )}
          {selectedBatch && currentDecision && (
            <FormNotice
              type="info"
              message={`Действует версия ${Number(currentDecision.decisionRevision) || 1}: ${decisionLabel(currentDecision.decision)}. Новое решение будет версией ${nextDecisionRevision}.`}
            />
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField label="Подтверждённая партия миксера">
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={batchRunId}
              onChange={(event) => selectBatch(event.target.value)}
              data-testid="impregnation-qc-batch-select"
            >
              <option value="">—</option>
              {confirmedMixerBatches.map((batch) => (
                <option key={batch.batchRunId} value={batch.batchRunId}>
                  {batch.batchNo} · {batch.recipeCode || batch.recipeName} · ЗП{' '}
                  {batch.productionOrderNumber} · линия {batch.productionLineId}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('technologist.qc.impreg.recipe')}>
            <Input
              value={selectedBatch ? `${selectedBatch.recipeCode} · ${selectedBatch.recipeName}` : ''}
              readOnly
              disabled
            />
          </FormField>
          <FormField label={t('technologist.qc.impreg.batchNo')}>
            <Input value={selectedBatch?.batchNo ?? ''} readOnly disabled />
          </FormField>
          <FormField label="Производственный заказ / линия">
            <Input
              value={
                selectedBatch
                  ? `${selectedBatch.productionOrderNumber} · ${selectedBatch.productionLineId}`
                  : ''
              }
              readOnly
              disabled
            />
          </FormField>
          <FormField label={t('technologist.qc.impreg.mfgDate')}>
            <Input type="date" value={manufacturedAt} readOnly disabled />
          </FormField>
          <FormField label={t('technologist.qc.impreg.controlDate')}>
            <Input type="date" value={controlledAt} onChange={(e) => setControlledAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.operators')}>
            <Input value={operators} onChange={(e) => setOperators(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.controller')}>
            <Input value={controllerName} onChange={(e) => setControllerName(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FormField label="m0">
            <Input value={m0} onChange={(e) => setM0(e.target.value)} />
          </FormField>
          <FormField label="m1">
            <Input value={m1} onChange={(e) => setM1(e.target.value)} />
          </FormField>
          <FormField label="m2">
            <Input value={m2} onChange={(e) => setM2(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('technologist.qc.impreg.theoreticalNv')}>
            <Input value={theoreticalNv} onChange={(e) => setTheoreticalNv(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.tolerance')}>
            <Input value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.viscositySec')}>
            <Input value={viscositySec} onChange={(e) => setViscositySec(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.viscosityTemp')}>
            <Input value={viscosityTempC} onChange={(e) => setViscosityTempC(e.target.value)} />
          </FormField>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visualOk} onChange={(e) => setVisualOk(e.target.checked)} />
          {t('technologist.qc.impreg.visualOk')}
        </label>

        <FormField className="mt-3" label={t('technologist.field.comment')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        <div className="mt-4 grid gap-2 rounded-sm bg-stone-50 p-3 text-sm md:grid-cols-4">
          <div>
            NV: <strong>{live.nvPct != null ? `${live.nvPct}%` : '—'}</strong>
          </div>
          <div>
            {t('technologist.qc.impreg.deviation')}:{' '}
            <strong>{live.absDeviationPp != null ? `${live.absDeviationPp} п.п.` : '—'}</strong>
          </div>
          <div>
            {t('technologist.qc.impreg.relDeviation')}:{' '}
            <strong>{live.relDeviation != null ? `${(live.relDeviation * 100).toFixed(1)}%` : '—'}</strong>
          </div>
          <div className="flex items-center gap-2">
            Лабораторный статус:{' '}
            <QcStatusBadge status={live.status} label={qcStatusLabel(live.status, locale)} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FormField label="Решение">
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as ImpregnationQcDecision | '')
              }
              data-testid="impregnation-qc-decision"
            >
              <option value="">—</option>
              <option value="approved">Допустить на линию</option>
              <option value="rejected">Отклонить</option>
            </select>
          </FormField>
          <FormField label="Основание решения">
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={decisionMethod}
              onChange={(event) =>
                setDecisionMethod(event.target.value as ImpregnationQcDecisionMethod)
              }
            >
              <option value="measured">Измеренный лабораторный контроль</option>
              {manualVisualEnabled && (
                <option value="edu_manual_visual">Учебный ручной визуальный допуск</option>
              )}
            </select>
          </FormField>
          <FormField
            label="Причина / ответственное основание"
            hint={
              decisionMethod === 'edu_manual_visual' || decision === 'rejected'
                || Boolean(currentDecision)
                ? 'Обязательно'
                : undefined
            }
          >
            <Input
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              data-testid="impregnation-qc-decision-reason"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <Button
            onClick={() => void submitDecision()}
            disabled={!canSubmit}
            data-testid="impregnation-qc-submit"
          >
            {submitting ? 'Подтверждение…' : 'Подтвердить решение'}
          </Button>
          {!canSubmit && blockReason && (
            <span className="ml-3 text-xs text-stone-500">{blockReason}</span>
          )}
        </div>
      </Card>

      <Card title={t('technologist.qc.journal')}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('technologist.qc.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('technologist.qc.impreg.recipe')}</th>
                  <th>Партия / ЗП / линия</th>
                  <th>{t('technologist.qc.impreg.controlDate')}</th>
                  <th className="text-right">NV</th>
                  <th>Лаборатория</th>
                  <th>Решение</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => {
                  const computed = resolveImpregnationQcComputed(record)
                  const labStatus = record.labStatus ?? computed.status
                  return (
                    <tr key={record.id}>
                      <td>{record.recipeCode || '—'}</td>
                      <td>
                        <div>{record.batchNumber || '—'}</div>
                        {(record.productionOrderId || record.productionLineId) && (
                          <div className="text-xs text-stone-500">
                            {record.productionOrderId || '—'} · линия {record.productionLineId || '—'}
                          </div>
                        )}
                      </td>
                      <td>{record.controlledAt || record.manufacturedAt || '—'}</td>
                      <td className="text-right font-mono">{computed.nvPct ?? '—'}%</td>
                      <td>
                        <QcStatusBadge
                          status={labStatus}
                          label={qcStatusLabel(labStatus, locale)}
                        />
                      </td>
                      <td>
                        <span
                          className={
                            record.decision === 'approved'
                              ? 'font-medium text-emerald-700'
                              : record.decision === 'rejected'
                                ? 'font-medium text-red-700'
                                : 'text-stone-500'
                          }
                        >
                          {decisionLabel(record.decision)}
                        </span>
                        {record.authoritativeDecisionId && (
                          <div className="text-xs text-stone-500">
                            v{Number(record.decisionRevision) || 1}
                            {record.authoritativeDisplayState === 'current' && ' · действует'}
                            {record.authoritativeDisplayState === 'superseded' && ' · заменено'}
                            {record.authoritativeDisplayState === 'missing' &&
                              ' · отсутствует в authoritative state'}
                            {record.authoritativeDisplayState === 'unavailable' &&
                              ' · authoritative state не загружен'}
                          </div>
                        )}
                        {record.decisionReason && (
                          <div className="max-w-xs text-xs text-stone-500">
                            {record.decisionReason}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        {record.authoritativeDecisionId ? (
                          <span className="text-xs text-stone-500">Только чтение</span>
                        ) : (
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={async () => {
                              if (
                                await confirm({
                                  message: t('technologist.qc.deleteConfirm'),
                                  danger: true,
                                })
                              ) {
                                onRemove(record.id)
                              }
                            }}
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
