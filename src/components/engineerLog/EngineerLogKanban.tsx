import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import type { EngineerLogEntry, EngineerLogStatus } from '@/lib/engineerLog/types'

const COLUMNS: EngineerLogStatus[] = ['open', 'deferred', 'done']

const KIND_DOT: Record<EngineerLogEntry['kind'], string> = {
  note: 'bg-stone-400',
  remark: 'bg-amber-500',
  task_done: 'bg-emerald-500',
  issue: 'bg-rose-500',
  inspection: 'bg-sky-500',
  idea: 'bg-violet-500',
  handoff: 'bg-orange-500',
}

function entryStatus(entry: EngineerLogEntry): EngineerLogStatus {
  return entry.status ?? 'open'
}

type Props = {
  entries: EngineerLogEntry[]
  onOpen: (entry: EngineerLogEntry) => void
  onSetStatus: (id: string, status: EngineerLogStatus) => void
}

export function EngineerLogKanban({ entries, onOpen, onSetStatus }: Props) {
  const { t, locale } = useI18n()
  const { draggingId, dropColumnId, cardDragProps, columnDropProps } =
    useKanbanDrag<EngineerLogStatus>()

  function byStatus(status: EngineerLogStatus) {
    return entries.filter((e) => entryStatus(e) === status)
  }

  function handleDrop(itemId: string, status: EngineerLogStatus) {
    const entry = entries.find((e) => e.id === itemId)
    if (entry && entryStatus(entry) !== status) onSetStatus(itemId, status)
  }

  function timeOf(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString(locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-GB' : 'ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso.slice(11, 16)
    }
  }

  if (!entries.length) {
    return (
      <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50/50 px-6 py-10 text-center text-sm text-stone-500">
        {t('engineerLog.emptyTitle')}
      </p>
    )
  }

  return (
    <KanbanBoard data-coach="engineerLog:kanban">
      {COLUMNS.map((status) => {
        const col = byStatus(status)
        return (
          <KanbanColumn
            key={status}
            title={t(`engineerLog.status.${status}`)}
            count={col.length}
            isDropTarget={dropColumnId === status}
            isDragging={!!draggingId}
            dropHandlers={columnDropProps(status, handleDrop)}
          >
            {col.map((e) => (
              <KanbanCardShell
                key={e.id}
                dragging={draggingId === e.id}
                dragProps={cardDragProps(e.id)}
                onClick={() => onOpen(e)}
                className={e.pinned ? 'ring-1 ring-amber-200' : ''}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[e.kind]}`}
                    aria-hidden
                  />
                  <span className="text-[10px] tabular-nums text-stone-400">
                    {e.date} {timeOf(e.createdAt)}
                  </span>
                </div>
                <div className="mt-1 font-medium text-stone-900">{e.title}</div>
                <div className="mt-0.5 text-[11px] text-stone-500">
                  {t(`engineerLog.kind.${e.kind}`)}
                  {e.area ? ` · ${e.area}` : ''}
                </div>
              </KanbanCardShell>
            ))}
          </KanbanColumn>
        )
      })}
    </KanbanBoard>
  )
}
