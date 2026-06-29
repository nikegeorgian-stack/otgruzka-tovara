import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { recipeTotalBatchKg } from '@/lib/formulations/calc'
import {
  buildMixTaskSuggestions,
  type MixTaskInput,
  type MixTaskSuggestion,
} from '@/lib/formulations/mixTasks'
import type { FormulationMixTask, FormulationStore } from '@/lib/formulations/types'
import { formulationColorLabel } from '@/lib/formulations/types'
import type { ProductionOrder } from '@/lib/planner/types'

type Props = {
  formulations: FormulationStore
  plannerOrders: ProductionOrder[]
  brigades: string[]
  operatorId?: string
  operatorName?: string
  onCreateMixTask: (input: MixTaskInput) => { ok: boolean; task?: FormulationMixTask }
  onCancelMixTask: (id: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  done: 'bg-teal-100 text-teal-800',
  cancelled: 'bg-stone-200 text-stone-600',
}

export function MixTaskTechnologistPanel({
  formulations,
  plannerOrders,
  brigades,
  operatorId,
  operatorName,
  onCreateMixTask,
  onCancelMixTask,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()

  const recipes = useMemo(
    () => formulations.recipes.filter((r) => r.active).sort((a, b) => a.code.localeCompare(b.code)),
    [formulations.recipes],
  )
  const tasks = useMemo(
    () =>
      [...(formulations.mixTasks ?? [])].sort((a, b) => {
        const order = (s: string) => (s === 'open' ? 0 : s === 'done' ? 1 : 2)
        return (
          order(a.status) - order(b.status) ||
          a.plannedDate.localeCompare(b.plannedDate) ||
          b.createdAt.localeCompare(a.createdAt)
        )
      }),
    [formulations.mixTasks],
  )

  const suggestions = useMemo(
    () =>
      buildMixTaskSuggestions(plannerOrders, formulations.recipes, formulations.mixTasks ?? [], {
        fromDate: todayIso(),
        days: 7,
      }),
    [plannerOrders, formulations.recipes, formulations.mixTasks],
  )

  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '')
  const [volume, setVolume] = useState('')
  const [plannedDate, setPlannedDate] = useState(todayIso)
  const [lineId, setLineId] = useState('')
  const [brigade, setBrigade] = useState('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null)

  const recipe = recipes.find((r) => r.id === recipeId)
  const baseVolume = recipe ? String(Math.round(recipeTotalBatchKg(recipe))) : '1000'

  function createTask(input: MixTaskInput, successKey: string) {
    const res = onCreateMixTask({
      ...input,
      createdBy: operatorId,
      createdByName: operatorName,
    })
    if (res.ok && res.task) {
      setNotice({ type: 'success', message: tf(successKey, { task: res.task.taskNumber }) })
    } else {
      setNotice({ type: 'error', message: t('mixer.task.createError') })
    }
  }

  function handleManualCreate() {
    if (!recipeId) {
      setNotice({ type: 'error', message: t('mixer.task.noRecipe') })
      return
    }
    const vol = Number(volume || baseVolume) || 0
    if (vol <= 0) {
      setNotice({ type: 'error', message: t('mixer.task.badVolume') })
      return
    }
    createTask(
      {
        recipeId,
        targetVolumeL: vol,
        plannedDate,
        lineId: lineId || undefined,
        brigade: brigade || undefined,
        note: note || undefined,
      },
      'mixer.task.created',
    )
    setVolume('')
    setNote('')
  }

  function handleSuggestion(s: MixTaskSuggestion) {
    createTask(
      {
        recipeId: s.recipeId,
        targetVolumeL: s.suggestedVolumeL,
        plannedDate: s.date,
        lineId: s.lineId,
        brigade: s.brigade,
        sourceOrderId: s.orderId,
        sourceDayPlanId: s.dayPlanId,
        note: tf('mixer.task.fromPlanNote', { product: s.productName }),
      },
      'mixer.task.created',
    )
  }

  async function handleCancel(task: FormulationMixTask) {
    const ok = await confirm({
      title: t('mixer.task.cancelConfirmTitle'),
      message: tf('mixer.task.cancelConfirm', { task: task.taskNumber }),
      danger: true,
    })
    if (ok) onCancelMixTask(task.id)
  }

  return (
    <div className="space-y-4">
      {notice && (
        <FormNotice type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <Card title={t('mixer.task.suggestTitle')} description={t('mixer.task.suggestHint')}>
        {suggestions.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('mixer.task.suggestEmpty')}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-3 rounded-sm border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-800">
                    {s.recipeCode} — {s.recipeName}
                    {s.colorVariant ? ` · ${formulationColorLabel(s.colorVariant, locale)}` : ''}
                  </div>
                  <div className="text-xs text-stone-500">
                    {s.date} · {tf('mixer.line', { line: s.lineId })} ·{' '}
                    {tf('mixer.task.plannedMp', { mp: s.plannedMp })} ·{' '}
                    {tf('mixer.task.suggestVol', { vol: s.suggestedVolumeL })}
                  </div>
                  <div className="truncate text-xs text-stone-400">
                    {s.customer} · {s.productName}
                  </div>
                </div>
                <Button size="sm" onClick={() => handleSuggestion(s)}>
                  {t('mixer.task.create')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('mixer.task.manualTitle')} description={t('mixer.task.manualHint')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormField label={t('technologist.field.recipe')}>
            <select
              className="fc-input"
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
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
              value={volume || baseVolume}
              onChange={(e) => setVolume(e.target.value)}
            />
          </FormField>

          <FormField label={t('mixer.task.plannedDate')}>
            <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          </FormField>

          <FormField label={t('mixer.task.line')}>
            <select className="fc-input" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">—</option>
              <option value="1">{tf('mixer.line', { line: '1' })}</option>
              <option value="2">{tf('mixer.line', { line: '2' })}</option>
            </select>
          </FormField>

          <FormField label={t('technologist.field.brigade')}>
            <select className="fc-input" value={brigade} onChange={(e) => setBrigade(e.target.value)}>
              <option value="">—</option>
              {brigades.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label={t('common.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={handleManualCreate}>{t('mixer.task.create')}</Button>
        </div>
      </Card>

      <Card title={t('mixer.task.listTitle')} description={t('mixer.task.listHint')}>
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('mixer.task.listEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('mixer.task.col.number')}</th>
                  <th>{t('technologist.col.recipe')}</th>
                  <th className="text-right">{t('technologist.col.volume')}</th>
                  <th>{t('mixer.task.col.date')}</th>
                  <th>{t('mixer.task.col.line')}</th>
                  <th>{t('technologist.col.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="font-mono text-xs">{task.taskNumber}</td>
                    <td>
                      <div className="font-medium">{task.recipeCode}</div>
                      <div className="text-xs text-stone-500">{task.recipeName}</div>
                    </td>
                    <td className="text-right tabular-nums">{task.targetVolumeL} л</td>
                    <td>{task.plannedDate}</td>
                    <td>{task.lineId ? tf('mixer.line', { line: task.lineId }) : '—'}</td>
                    <td>
                      <span
                        className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${
                          STATUS_CLASS[task.status] ?? ''
                        }`}
                      >
                        {t(`mixer.task.status.${task.status}`)}
                      </span>
                    </td>
                    <td className="text-right">
                      {task.status === 'open' && (
                        <Button variant="secondary" size="sm" onClick={() => handleCancel(task)}>
                          {t('common.cancel')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
