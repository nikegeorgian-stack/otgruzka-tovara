import type { ReactNode } from 'react'

type Props = {
  dragging: boolean
  dragProps: {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  onClick?: () => void
  className?: string
  title?: string
  children: ReactNode
}

export function KanbanCardShell({
  dragging,
  dragProps,
  onClick,
  className = '',
  title,
  children,
}: Props) {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={title}
      {...dragProps}
      onClick={onClick}
      className={[
        'w-full rounded-xl border bg-white p-2.5 text-left text-sm shadow-sm transition-all duration-200 ease-out',
        dragging
          ? 'scale-[0.97] border-dashed border-sky-300 opacity-50 shadow-none'
          : 'border-stone-200/90 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md',
        onClick ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        className,
      ].join(' ')}
    >
      {children}
    </Tag>
  )
}
