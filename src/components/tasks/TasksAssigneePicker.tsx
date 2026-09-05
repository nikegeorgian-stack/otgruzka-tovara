import { useMemo } from 'react'
import type { AppUser } from '@/lib/access/types'
import { taskAssigneeUserIds, taskAssigneeDoneUserIds } from '@/lib/tasks/assignees'
import type { WorkTask } from '@/lib/tasks/types'

type Props = {
  users: AppUser[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  readonly?: boolean
  /** Для карточки уже созданной задачи — отметки «выполнил». */
  task?: WorkTask
  onToggleDone?: (userId: string) => void
  labels: {
    title: string
    empty: string
    markDone: string
    progress: (done: number, total: number) => string
  }
}

export function TasksAssigneePicker({
  users,
  selectedIds,
  onChange,
  readonly = false,
  task,
  onToggleDone,
  labels,
}: Props) {
  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.displayName || a.login).localeCompare(b.displayName || b.login, 'ru'),
      ),
    [users],
  )

  const doneSet = useMemo(() => {
    if (!task) return new Set<string>()
    return new Set(taskAssigneeDoneUserIds(task))
  }, [task])

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  function toggleAssignee(userId: string) {
    if (readonly) return
    if (selected.has(userId)) {
      onChange(selectedIds.filter(id => id !== userId))
    } else {
      onChange([...selectedIds, userId])
    }
  }

  const progressDone = task ? taskAssigneeDoneUserIds(task).length : 0
  const progressTotal = task ? taskAssigneeUserIds(task).length : selectedIds.length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {labels.title}
        </span>
        {progressTotal > 0 && (
          <span className="text-xs text-stone-500">
            {labels.progress(progressDone, progressTotal)}
          </span>
        )}
      </div>

      {sortedUsers.length === 0 ? (
        <p className="text-sm text-stone-500">{labels.empty}</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-xl border border-stone-200/80 bg-stone-50/50 p-1">
          {sortedUsers.map(user => {
            const isSelected = selected.has(user.id)
            const isDone = doneSet.has(user.id)
            const canMarkDone = task && onToggleDone && isSelected

            return (
              <div
                key={user.id}
                className={[
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150',
                  isSelected ? 'bg-white shadow-sm ring-1 ring-stone-200/60' : 'hover:bg-white/60',
                ].join(' ')}
              >
                {!readonly ? (
                  <button
                    type="button"
                    onClick={() => toggleAssignee(user.id)}
                    className={[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all duration-150',
                      isSelected
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-stone-300 bg-white text-transparent hover:border-sky-300',
                    ].join(' ')}
                    aria-pressed={isSelected}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3 8.5L6.5 12L13 4"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : (
                  <span
                    className={[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                      isSelected ? 'bg-sky-100 text-sky-800' : 'bg-stone-100 text-stone-400',
                    ].join(' ')}
                  >
                    {(user.displayName || user.login).slice(0, 1).toUpperCase()}
                  </span>
                )}

                <span className="min-w-0 flex-1 truncate text-sm text-stone-800">
                  {user.displayName || user.login}
                </span>

                {canMarkDone && (
                  <button
                    type="button"
                    onClick={() => onToggleDone!(user.id)}
                    title={labels.markDone}
                    className={[
                      'shrink-0 rounded-lg px-2 py-0.5 text-xs font-medium transition-all duration-150',
                      isDone
                        ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                        : 'bg-stone-100 text-stone-600 hover:bg-emerald-50 hover:text-emerald-700',
                    ].join(' ')}
                  >
                    {isDone ? '✓' : '○'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!readonly && selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const u = users.find(x => x.id === id)
            if (!u) return null
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-900 ring-1 ring-sky-100"
              >
                {u.displayName || u.login}
                <button
                  type="button"
                  className="text-sky-600 hover:text-sky-900"
                  onClick={() => toggleAssignee(id)}
                  aria-label="remove"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
