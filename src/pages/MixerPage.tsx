import { useMemo, useState } from 'react'
import { FormulationCubeLabelModal } from '@/components/technologist/FormulationCubeLabelModal'
import { FormulationMixerPanel } from '@/components/technologist/FormulationMixerPanel'
import { TechnologistRoomClimateWidget } from '@/components/technologist/TechnologistRoomClimateWidget'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { useI18n } from '@/context/I18nContext'
import type { PostBatchMixInput, PostBatchMixResult } from '@/lib/formulations/batch'
import { formatMixDate } from '@/lib/formulations/cubeLabel'
import type { FormulationBatchRun, FormulationStore } from '@/lib/formulations/types'
import { formulationColorLabel } from '@/lib/formulations/types'
import type { RoomClimateRecord, TechnologistQcStore } from '@/lib/technologist/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  formulations: FormulationStore
  technologistQc: TechnologistQcStore
  warehouse: WarehouseStore
  brigades: string[]
  operatorId?: string
  operatorName?: string
  allowNegativeStock?: boolean
  site?: string
  webUserName?: string
  webMixerMode?: boolean
  onPostBatch: (input: PostBatchMixInput) => PostBatchMixResult
  onCompleteMixTask: (taskId: string, batchRunId: string, doneByName?: string) => void
  onAddRoomClimateReading: (entry: Omit<RoomClimateRecord, 'id' | 'createdAt'>) => void
  onRemoveRoomClimateReading?: (id: string) => void
}

export function MixerPage({
  formulations,
  technologistQc,
  warehouse,
  brigades,
  operatorId,
  operatorName,
  allowNegativeStock = false,
  site,
  webUserName,
  webMixerMode = false,
  onPostBatch,
  onCompleteMixTask,
  onAddRoomClimateReading,
  onRemoveRoomClimateReading,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [labelRun, setLabelRun] = useState<FormulationBatchRun | null>(null)

  const recipeById = useMemo(
    () => new Map(formulations.recipes.map((r) => [r.id, r])),
    [formulations.recipes],
  )

  const openTasks = useMemo(
    () =>
      (formulations.mixTasks ?? [])
        .filter((task) => task.status === 'open')
        .sort(
          (a, b) =>
            (a.priority ?? 99) - (b.priority ?? 99) ||
            a.plannedDate.localeCompare(b.plannedDate) ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [formulations.mixTasks],
  )

  const doneTasks = useMemo(
    () =>
      (formulations.mixTasks ?? [])
        .filter((task) => task.status === 'done')
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
        .slice(0, 12),
    [formulations.mixTasks],
  )

  const selectedTask = useMemo(
    () => openTasks.find((task) => task.id === selectedTaskId) ?? null,
    [openTasks, selectedTaskId],
  )

  function handleBatchPosted(run: FormulationBatchRun) {
    if (selectedTask) {
      onCompleteMixTask(selectedTask.id, run.id, operatorName)
      setSelectedTaskId(null)
    }
    setLabelRun(run)
  }

  const defaultWarehouseId = warehouse.locations[0]?.id

  return (
    <PageLayout>
      <PageHeader
        badge={t('mixer.badge')}
        title={
          webMixerMode && webUserName ? tf('mixer.welcome', { name: webUserName }) : t('mixer.title')
        }
        subtitle={t('mixer.subtitle')}
      />

      <Card title={t('mixer.inbox.title')} description={t('mixer.inbox.hint')}>
        {openTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('mixer.inbox.empty')}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {openTasks.map((task) => {
              const active = task.id === selectedTaskId
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTaskId(active ? null : task.id)}
                  className={`rounded-sm border px-3 py-2 text-left transition ${
                    active
                      ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-400'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-stone-500">{task.taskNumber}</span>
                    <span className="text-xs text-stone-500">{task.plannedDate}</span>
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-stone-800">
                    {task.recipeCode} — {task.recipeName}
                    {task.colorVariant
                      ? ` · ${formulationColorLabel(task.colorVariant, locale)}`
                      : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {tf('mixer.task.suggestVol', { vol: task.targetVolumeL })}
                    {task.lineId ? ` · ${tf('mixer.line', { line: task.lineId })}` : ''}
                    {task.brigade ? ` · ${task.brigade}` : ''}
                  </div>
                  {task.note && (
                    <div className="mt-0.5 truncate text-xs text-stone-400">{task.note}</div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <div className="mt-4">
        <FormulationMixerPanel
          key={selectedTask?.id ?? 'free'}
          formulations={formulations}
          warehouse={warehouse}
          brigades={brigades}
          operatorId={operatorId}
          operatorName={operatorName}
          allowNegativeStock={allowNegativeStock}
          onPostBatch={onPostBatch}
          onBatchPosted={handleBatchPosted}
          initialRecipeId={selectedTask?.recipeId}
          initialVolumeL={selectedTask?.targetVolumeL}
          initialWarehouseId={selectedTask?.warehouseId ?? defaultWarehouseId}
          initialBrigade={selectedTask?.brigade}
          taskBadge={selectedTask?.taskNumber}
        />
      </div>

      {doneTasks.length > 0 && (
        <Card
          className="mt-4"
          title={t('mixer.done.title')}
          description={t('mixer.done.hint')}
        >
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('mixer.task.col.number')}</th>
                  <th>{t('technologist.col.recipe')}</th>
                  <th className="text-right">{t('technologist.col.volume')}</th>
                  <th>{t('mixer.done.at')}</th>
                </tr>
              </thead>
              <tbody>
                {doneTasks.map((task) => (
                  <tr key={task.id}>
                    <td className="font-mono text-xs">{task.taskNumber}</td>
                    <td>
                      <div className="font-medium">{task.recipeCode}</div>
                      <div className="text-xs text-stone-500">{task.recipeName}</div>
                    </td>
                    <td className="text-right tabular-nums">{task.targetVolumeL} л</td>
                    <td>{task.doneAt ? formatMixDate(task.doneAt.slice(0, 10), locale) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {labelRun && (
        <FormulationCubeLabelModal
          run={labelRun}
          site={site}
          warehouseName={warehouse.locations.find((l) => l.id === labelRun.warehouseId)?.name}
          labelText={
            labelRun.labelSnapshot?.labelText ?? recipeById.get(labelRun.recipeId)?.labelText
          }
          onClose={() => setLabelRun(null)}
        />
      )}

      <TechnologistRoomClimateWidget
        records={technologistQc.roomClimateLog}
        operatorName={operatorName}
        onFix={onAddRoomClimateReading}
        onRemove={onRemoveRoomClimateReading}
      />
    </PageLayout>
  )
}
