import { useCallback, useState } from 'react'

export const KANBAN_DRAG_MIME = 'text/kanban-item-id'

export function useKanbanDrag<TColumnId extends string>() {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropColumnId, setDropColumnId] = useState<TColumnId | null>(null)

  const clearDrag = useCallback(() => {
    setDraggingId(null)
    setDropColumnId(null)
  }, [])

  const cardDragProps = useCallback(
    (itemId: string) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(KANBAN_DRAG_MIME, itemId)
        e.dataTransfer.effectAllowed = 'move'
        setDraggingId(itemId)
      },
      onDragEnd: clearDrag,
    }),
    [clearDrag],
  )

  const columnDropProps = useCallback(
    (columnId: TColumnId, onDrop: (itemId: string, columnId: TColumnId) => void) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropColumnId(columnId)
      },
      onDragLeave: () => {
        setDropColumnId((prev) => (prev === columnId ? null : prev))
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const itemId = e.dataTransfer.getData(KANBAN_DRAG_MIME)
        if (itemId) onDrop(itemId, columnId)
        clearDrag()
      },
    }),
    [clearDrag],
  )

  return {
    draggingId,
    dropColumnId,
    cardDragProps,
    columnDropProps,
    clearDrag,
    setDraggingId,
  }
}
