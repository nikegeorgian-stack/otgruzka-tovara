import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { canCreateTaskOnBoard } from '@/lib/tasks/access'
import {
  taskAssigneeDoneUserIds,
  taskAssigneeProgress,
  taskAssigneeUserIds,
} from '@/lib/tasks/assignees'
import type { TasksStore, WorkTask } from '@/lib/tasks/types'
import { taskDisplayLabel } from '@/lib/tasks/taskNumber'

type Props = {
  tasksStore: TasksStore
  boardIds: string[]
  users: AppUser[]
  currentUser: AppUser | null
  access: AccessStore
  onOpenTask: (task: WorkTask) => void
  onMoveTask: (taskId: string, columnId: string) => void
  onAddTask: (boardId: string) => void
}

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'border-l-4 border-l-rose-500',
  high: 'border-l-4 border-l-amber-500',
  low: 'border-l-4 border-l-stone-300',
  normal: 'border-l-4 border-l-sky-400',
}

function userLabel(users: AppUser[], id: string): string {
  const u = users.find((x) => x.id === id)
  return u?.displayName || u?.login || id.slice(0, 6)
}

function TaskKanbanCard({
  task,
  users,
  dragging,
  dragProps,
  onOpen,
}: {
  task: WorkTask
  users: AppUser[]
  dragging: boolean
  dragProps: {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  onOpen: () => void
}) {
  const assignees = taskAssigneeUserIds(task)
  const { done, total } = taskAssigneeProgress(task)
  const doneSet = new Set(taskAssigneeDoneUserIds(task))

  return (
    <KanbanCardShell
      dragging={dragging}
      dragProps={dragProps}
      onClick={onOpen}
      className={PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.normal}
    >
      <div className="text-xs text-stone-400">{task.number}</div>
      <div className="font-medium text-stone-900">{taskDisplayLabel(task)}</div>
      {assignees.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {assignees.map((id) => (
            <span
              key={id}
              className={[
                'max-w-[120px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium',
                doneSet.has(id)
                  ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
                  : 'bg-stone-100 text-stone-600',
              ].join(' ')}
              title={userLabel(users, id)}
            >
              {userLabel(users, id)}
            </span>
          ))}
          {total > 1 ? (
            <span className="ml-auto text-[10px] text-stone-400">
              {done}/{total}
            </span>
          ) : null}
        </div>
      ) : null}
      {task.dueDate ? (
        <div className="mt-1.5 text-xs text-stone-500">{task.dueDate}</div>
      ) : null}
    </KanbanCardShell>
  )
}

export function TasksBoardTab({
  tasksStore,
  boardIds,
  users,
  currentUser,
  access,
  onOpenTask,
  onMoveTask,
  onAddTask,
}: Props) {
  const { t } = useI18n()
  const boards = useMemo(
    () =>
      tasksStore.boards
        .filter((b) => !b.archived && boardIds.includes(b.id) && b.columnIds.length > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasksStore.boards, boardIds],
  )
  const [boardId, setBoardId] = useState(() => boards[0]?.id ?? '')
  const activeBoardId = boards.some((b) => b.id === boardId) ? boardId : boards[0]?.id ?? ''
  const board = boards.find((b) => b.id === activeBoardId)
  const canCreate = board ? canCreateTaskOnBoard(board.id, currentUser, access) : false

  const { draggingId, dropColumnId, cardDragProps, columnDropProps } = useKanbanDrag<string>()

  const columns = useMemo(() => {
    if (!board) return []
    return board.columnIds
      .map((id) => tasksStore.columns.find((c) => c.id === id))
      .filter(Boolean)
  }, [board, tasksStore.columns])

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, WorkTask[]>()
    for (const col of columns) {
      if (!col) continue
      map.set(
        col.id,
        tasksStore.tasks
          .filter(
            (task) =>
              task.boardId === activeBoardId && task.columnId === col.id && task.status !== 'cancelled',
          )
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      )
    }
    return map
  }, [columns, tasksStore.tasks, activeBoardId])

  if (!boards.length) {
    return <p className="text-sm text-stone-500">{t('tasks.board.noBoards')}</p>
  }

  return (
    <div className="space-y-4" data-coach="tasks:boards">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-stone-100/90 p-1">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
                b.id === activeBoardId
                  ? 'bg-white text-sky-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900',
              ].join(' ')}
              onClick={() => setBoardId(b.id)}
            >
              {b.title}
            </button>
          ))}
        </div>
        {canCreate ? (
          <Button size="sm" data-coach="tasks:boardAdd" onClick={() => onAddTask(activeBoardId)}>
            {t('tasks.board.add')}
          </Button>
        ) : null}
      </div>

      <KanbanBoard showHint={false}>
        {columns.map((col) =>
          col ? (
            <KanbanColumn
              key={col.id}
              title={col.title}
              count={(tasksByColumn.get(col.id) ?? []).length}
              isDropTarget={dropColumnId === col.id}
              isDragging={!!draggingId}
              dropHandlers={columnDropProps(col.id, (taskId, columnId) => onMoveTask(taskId, columnId))}
            >
              {(tasksByColumn.get(col.id) ?? []).map((task) => (
                <TaskKanbanCard
                  key={task.id}
                  task={task}
                  users={users}
                  dragging={draggingId === task.id}
                  dragProps={cardDragProps(task.id)}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </KanbanColumn>
          ) : null,
        )}
      </KanbanBoard>
    </div>
  )
}
