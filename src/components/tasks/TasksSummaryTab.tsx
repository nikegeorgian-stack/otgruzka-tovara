import { useMemo, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { taskAssigneeUserIds } from '@/lib/tasks/assignees'
import { boardTitle } from '@/lib/tasks/init'
import type { TasksStore, WorkTask } from '@/lib/tasks/types'
import { taskDisplayLabel } from '@/lib/tasks/taskNumber'

type Props = {
  tasksStore: TasksStore
  boardIds: string[]
  onOpenTask: (task: WorkTask) => void
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysOpen(task: WorkTask): number {
  const start = new Date(task.createdAt).getTime()
  return Math.floor((Date.now() - start) / 86400000)
}

export function TasksSummaryTab({ tasksStore, boardIds, onOpenTask }: Props) {
  const { t } = useI18n()
  const [boardFilter, setBoardFilter] = useState<string>('all')

  const scopedTasks = useMemo(
    () =>
      tasksStore.tasks.filter(
        (t) =>
          t.status === 'open' &&
          (boardIds.includes(t.boardId) || boardIds.length === 0),
      ),
    [tasksStore.tasks, boardIds],
  )

  const boards = useMemo(
    () =>
      tasksStore.boards.filter(
        (b) => boardIds.includes(b.id) && b.columnIds.length > 0,
      ),
    [tasksStore.boards, boardIds],
  )

  const filtered = useMemo(() => {
    if (boardFilter === 'all') return scopedTasks
    return scopedTasks.filter((t) => t.boardId === boardFilter)
  }, [scopedTasks, boardFilter])

  const overdue = filtered.filter((t) => t.dueDate && t.dueDate < todayIso())
  const unassigned = filtered.filter((t) => taskAssigneeUserIds(t).length === 0)
  const stale = filtered.filter((t) => daysOpen(t) > 7)

  const rows = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => {
          const ao = a.dueDate && a.dueDate < todayIso() ? 0 : 1
          const bo = b.dueDate && b.dueDate < todayIso() ? 0 : 1
          if (ao !== bo) return ao - bo
          return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
        })
        .slice(0, 50),
    [filtered],
  )

  return (
    <div className="space-y-4" data-coach="tasks:summary">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('tasks.summary.overdue')} value={String(overdue.length)} tone="warn" />
        <KpiCard label={t('tasks.summary.unassigned')} value={String(unassigned.length)} />
        <KpiCard label={t('tasks.summary.stale')} value={String(stale.length)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-stone-400">
          {t('tasks.summary.boardFilter')}:
        </span>
        <select
          className="fc-input text-sm"
          value={boardFilter}
          onChange={(e) => setBoardFilter(e.target.value)}
        >
          <option value="all">{t('tasks.summary.allBoards')}</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-auto rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">{t('tasks.summary.colTask')}</th>
              <th className="px-3 py-2">{t('tasks.summary.colBoard')}</th>
              <th className="px-3 py-2">{t('tasks.card.dueDate')}</th>
              <th className="px-3 py-2">{t('tasks.summary.colDays')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-stone-500">
                  {t('tasks.summary.empty')}
                </td>
              </tr>
            ) : (
              rows.map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer border-t border-stone-100 hover:bg-sky-50/50"
                  onClick={() => onOpenTask(task)}
                >
                  <td className="px-3 py-2 font-medium">{taskDisplayLabel(task)}</td>
                  <td className="px-3 py-2 text-stone-600">
                    {boardTitle(tasksStore, task.boardId)}
                  </td>
                  <td className="px-3 py-2 text-stone-600">{task.dueDate ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-500">{daysOpen(task)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
