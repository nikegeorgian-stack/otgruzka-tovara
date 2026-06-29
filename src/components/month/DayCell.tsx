import type { DayCode } from '@/lib/types'

export const CELL_CODE_STYLES: Record<string, string> = {
  '8': 'bg-emerald-50 text-emerald-800 font-semibold',
  '11': 'bg-sky-50 text-sky-800 font-semibold',
  'Н': 'bg-violet-50 text-violet-800 font-semibold',
  '22': 'bg-indigo-50 text-indigo-800 font-semibold',
  'В': 'bg-stone-100 text-stone-500',
  'ОТ': 'bg-amber-50 text-amber-800 font-semibold',
  'ОО': 'bg-amber-100/70 text-amber-900 font-semibold ring-1 ring-amber-200/80',
  'Б': 'bg-blue-50 text-blue-800 font-semibold',
  'X': 'bg-red-50 text-red-700 font-semibold',
  'ПР': 'bg-orange-50 text-orange-800 font-semibold',
  '': 'text-stone-300',
}

type Props = {
  code: DayCode
  mismatch?: boolean
  dimmed?: boolean
  hasComment?: boolean
  hasSubstitution?: boolean
  dataCell?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  readOnly?: boolean
  size?: 'sm' | 'lg'
  /** Доп. сверхурочные часы в факте (+1…+6) */
  extraHours?: number
}

export function DayCell({
  code,
  mismatch,
  dimmed,
  hasComment,
  hasSubstitution,
  dataCell,
  onClick,
  onContextMenu,
  title,
  readOnly = false,
  size = 'sm',
  extraHours = 0,
}: Props) {
  const sizeClass = size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
  return (
    <button
      type="button"
      title={title}
      data-cell={dataCell}
      onClick={readOnly ? undefined : onClick}
      onContextMenu={readOnly ? undefined : onContextMenu}
      tabIndex={readOnly ? -1 : 0}
      className={`relative flex items-center justify-center font-mono transition-all ${sizeClass} ${
        readOnly
          ? 'cursor-default opacity-95'
          : 'hover:ring-2 hover:ring-accent/40 focus:outline-none focus:ring-2 focus:ring-accent'
      } ${CELL_CODE_STYLES[code] ?? CELL_CODE_STYLES['']} ${
        mismatch ? 'ring-2 ring-amber-400 ring-offset-1' : ''
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      {code || '·'}
      {hasSubstitution && (
        <span className="absolute left-0.5 top-0.5 rounded bg-violet-600 px-0.5 text-[8px] font-bold leading-none text-white">
          З
        </span>
      )}
      {hasComment && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-sm bg-sky-500" />
      )}
      {extraHours > 0 && (
        <span className="absolute bottom-0 right-0 rounded-tl bg-amber-500 px-0.5 text-[7px] font-bold leading-none text-white">
          +{extraHours}
        </span>
      )}
    </button>
  )
}
