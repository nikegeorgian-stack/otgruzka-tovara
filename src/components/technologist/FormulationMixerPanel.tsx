import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { planFormulationBatch, type PostBatchMixResult } from '@/lib/formulations/batch'
import { recipeTotalBatchKg } from '@/lib/formulations/calc'
import { formulationRecipeDisplayName } from '@/lib/formulations/warehouseSync'
import type { FormulationBatchRun, FormulationStore } from '@/lib/formulations/types'
import { formulationColorLabel } from '@/lib/formulations/types'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  formulations: FormulationStore
  warehouse: WarehouseStore
  brigades: string[]
  operatorId?: string
  operatorName?: string
  allowNegativeStock?: boolean
  onPostBatch: (input: {
    recipeId: string
    targetVolumeL: number
    warehouseId: string
    mixedAt: string
    mixedBy: string
    mixedByName: string
    shiftBrigade?: string
    shiftNote?: string
    comment?: string
  }) => PostBatchMixResult
  onBatchPosted: (run: FormulationBatchRun) => void
  /** Пред-заполнение из задания на замес (интерфейс миксера) */
  initialRecipeId?: string
  initialVolumeL?: number
  initialWarehouseId?: string
  initialBrigade?: string
  /** Подпись активного задания (например, номер ЗД-…) */
  taskBadge?: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function FormulationMixerPanel({
  formulations,
  warehouse,
  brigades,
  operatorId,
  operatorName,
  allowNegativeStock = false,
  onPostBatch,
  onBatchPosted,
  initialRecipeId,
  initialVolumeL,
  initialWarehouseId,
  initialBrigade,
  taskBadge,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const recipes = useMemo(
    () =>
      formulations.recipes
        .filter((r) => r.active)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [formulations.recipes],
  )

  const [recipeId, setRecipeId] = useState(initialRecipeId ?? recipes[0]?.id ?? '')
  const [targetVolumeL, setTargetVolumeL] = useState(
    initialVolumeL != null && initialVolumeL > 0 ? String(initialVolumeL) : '',
  )
  const [warehouseId, setWarehouseId] = useState(
    initialWarehouseId ?? warehouse.locations[0]?.id ?? '',
  )
  const [mixedAt, setMixedAt] = useState(todayIso)
  const [shiftBrigade, setShiftBrigade] = useState(initialBrigade ?? brigades[0] ?? '')
  const [shiftNote, setShiftNote] = useState('')
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null,
  )

  const recipe = recipes.find((r) => r.id === recipeId)
  const defaultVolume = recipe ? String(Math.round(recipeTotalBatchKg(recipe))) : '1000'
  const volumeL = Number(targetVolumeL || defaultVolume) || 0

  const balances = useMemo(
    () => computeAllBalances(warehouse, warehouseId || undefined),
    [warehouse, warehouseId],
  )

  const plan = useMemo(() => {
    if (!recipe || volumeL <= 0) return null
    return planFormulationBatch(recipe, warehouse, volumeL, warehouseId || undefined, {
      allowNegativeStock,
    })
  }, [recipe, warehouse, volumeL, warehouseId, allowNegativeStock])

  async function handlePost() {
    if (!recipe || !operatorId || !operatorName || !plan?.mixAllowed) return
    if (
      !plan.stockOk &&
      allowNegativeStock &&
      plan.stockShortages.length > 0 &&
      !(await confirm({ message: `${t('technologist.mixNegativeConfirm')}\n\n${plan.stockShortages.join('\n')}`, danger: true }))
    ) {
      return
    }
    const result = onPostBatch({
      recipeId: recipe.id,
      targetVolumeL: volumeL,
      warehouseId,
      mixedAt,
      mixedBy: operatorId,
      mixedByName: operatorName,
      shiftBrigade: shiftBrigade || undefined,
      shiftNote: shiftNote.trim() || undefined,
      comment: comment.trim() || undefined,
    })
    if (!result.ok) {
      setNotice({ type: 'error', message: result.error })
      return
    }
    setNotice({ type: 'success', message: t('technologist.mixSuccess') })
    onBatchPosted(result.run)
  }

  return (
    <div className="space-y-4">
      {notice && (
        <FormNotice
          type={notice.type}
          message={notice.message}
          onDismiss={() => setNotice(null)}
        />
      )}

      {taskBadge && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {tf('mixer.activeTask', { task: taskBadge })}
        </div>
      )}

      <Card title={t('technologist.mixerTitle')} description={t('technologist.mixerHint')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormField label={t('technologist.field.recipe')}>
            <select
              className="fc-input"
              value={recipeId}
              onChange={(e) => {
                setRecipeId(e.target.value)
                const r = recipes.find((x) => x.id === e.target.value)
                if (r) setTargetVolumeL(String(Math.round(recipeTotalBatchKg(r))))
              }}
            >
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('technologist.field.volume')}>
            <Input
              type="number"
              min={1}
              step={1}
              value={targetVolumeL || defaultVolume}
              onChange={(e) => setTargetVolumeL(e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-stone-500">
              {tf('technologist.field.volumeHint', { base: defaultVolume })}
            </span>
          </FormField>

          <FormField label={t('technologist.field.warehouse')}>
            <select
              className="fc-input"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {warehouse.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('technologist.field.mixDate')}>
            <Input type="date" value={mixedAt} onChange={(e) => setMixedAt(e.target.value)} />
          </FormField>

          <FormField label={t('technologist.field.brigade')}>
            <select
              className="fc-input"
              value={shiftBrigade}
              onChange={(e) => setShiftBrigade(e.target.value)}
            >
              <option value="">—</option>
              {brigades.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('technologist.field.shiftNote')}>
            <Input
              value={shiftNote}
              onChange={(e) => setShiftNote(e.target.value)}
              placeholder={t('technologist.field.shiftNotePh')}
            />
          </FormField>

          <FormField label={t('technologist.field.comment')} className="lg:col-span-2">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </FormField>
        </div>
      </Card>

      {recipe && plan && (
        <Card title={t('technologist.planTitle')}>
          <div className="mb-3 text-sm text-stone-600">
            <span className="font-medium text-ink">
              {formulationRecipeDisplayName(recipe)}
            </span>
            {recipe.grammageGsm && <span className="ml-2">· {recipe.grammageGsm} г/м²</span>}
            {recipe.colorVariant && (
              <span className="ml-2">
                · {formulationColorLabel(recipe.colorVariant, locale)}
              </span>
            )}
            <span className="ml-2">
              · {t('technologist.scale')}: ×{plan.scaleFactor.toFixed(3)}
            </span>
          </div>

          {!plan.stockOk && plan.blockingShortages.length > 0 && (
            <FormNotice type="error" message={plan.blockingShortages.join(' · ')} />
          )}
          {!plan.stockOk && plan.stockShortages.length > 0 && (
            <FormNotice
              type={allowNegativeStock ? 'info' : 'error'}
              message={
                allowNegativeStock
                  ? `${t('technologist.stockShortageWarning')} ${plan.stockShortages.join(' · ')}`
                  : plan.stockShortages.join(' · ')
              }
            />
          )}
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('technologist.col.component')}</th>
                  <th className="text-right">{t('technologist.col.consume')}</th>
                  <th className="text-right">{t('technologist.col.stock')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((line) => {
                  const avail = balances.get(line.warehouseItemId)?.available ?? 0
                  const ok = avail >= line.consumeKg
                  return (
                    <tr key={line.componentId}>
                      <td>{line.name}</td>
                      <td className="text-right tabular-nums">
                        {formatQty(line.consumeKg)} кг
                      </td>
                      <td
                        className={`text-right tabular-nums ${ok ? 'text-teal-800' : 'text-red-700 font-medium'}`}
                      >
                        {formatQty(avail)}
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-teal-50/50 font-medium">
                  <td>{t('technologist.output')}</td>
                  <td className="text-right tabular-nums">
                    {formatQty(plan.outputKg)} кг ≈ {formatQty(plan.outputKg)} л
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Button
              variant="primary"
              disabled={!plan.mixAllowed || !operatorId}
              onClick={handlePost}
            >
              {t('technologist.postMix')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
