import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { taskAssigneeProgress, taskHasAssignee } from '@/lib/tasks/assignees'
import { boardTitle } from '@/lib/tasks/init'
import type { TasksStore, WorkTask } from '@/lib/tasks/types'
import { taskDisplayLabel } from '@/lib/tasks/taskNumber'

type Props = {
  tasksStore: TasksStore
  userId: string
  onOpenTask: (task: WorkTask) => void
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function TaskRow({
  task,
  boardLabel,
  onOpen,
}: {
  task: WorkTask
  boardLabel: string
  onOpen: () => void
}) {
  const { t, tf } = useI18n()
  const overdue = task.status === 'open' && task.dueDate && task.dueDate < todayIso()
  const { done, total } = taskAssigneeProgress(task)

  return (
    <button
      type="button"
      className="flex w-full items-start justify-between gap-2 rounded-xl border border-stone-200/90 bg-white px-3 py-2.5 text-left text-sm shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="font-medium text-stone-900">{taskDisplayLabel(task)}</div>
        <div className="truncate text-xs text-stone-500">{task.title}</div>
        <div className="text-xs text-stone-400">{boardLabel}</div>
        {total > 1 ? (
          <div className="mt-1 text-[11px] text-stone-500">
            {tf('tasks.card.assigneeProgress', { done, total })}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right text-xs">
        {overdue ? (
          <span className="font-medium text-rose-600">{t('tasks.my.overdue')}</span>
        ) : task.dueDate ? (
          <span className="text-stone-500">{task.dueDate}</span>
        ) : null}
      </div>
    </button>
  )
}

export function TasksMyTab({ tasksStore, userId, onOpenTask }: Props) {
  const { t } = useI18n()
  const openTasks = useMemo(
    () => tasksStore.tasks.filter((t) => t.status === 'open'),
    [tasksStore.tasks],
  )
  const incoming = openTasks.filter((t) => taskHasAssignee(t, userId))
  const created = openTasks.filter(
    (t) => t.createdBy === userId && !taskHasAssignee(t, userId),
  )
  const overdue = openTasks.filter(
    (t) => taskHasAssignee(t, userId) && t.dueDate && t.dueDate < todayIso(),
  )

  const sections = [
    { key: 'incoming', title: t('tasks.my.incoming'), items: incoming },
    { key: 'overdue', title: t('tasks.my.overdueSection'), items: overdue },
    { key: 'created', title: t('tasks.my.created'), items: created },
  ].filter((s) => s.items.length > 0)

  if (!sections.length) {
    return (
      <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/80 px-4 py-10 text-center text-sm text-stone-500">
        {t('tasks.my.empty')}
      </p>
    )
  }

  return (
    <div className="space-y-6" data-coach="tasks:my">
      {sections.map((section) => (
        <section key={section.key}>
          <h3 className="mb-2 text-sm font-semibold text-stone-700">{section.title}</h3>
          <div className="space-y-2">
            {section.items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                boardLabel={boardTitle(tasksStore, task.boardId)}
                onOpen={() => onOpenTask(task)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
