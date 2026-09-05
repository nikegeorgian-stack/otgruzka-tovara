import { memo } from 'react'
import { hoursForCode } from '@/lib/codes'
import type { DayCode } from '@/lib/types'

export const CELL_CODE_STYLES: Record<string, string> = {
  '4': 'bg-emerald-50 text-emerald-800 font-semibold',
  '6': 'bg-emerald-50 text-emerald-700 font-semibold',
  '8': 'bg-emerald-50 text-emerald-800 font-semibold',
  '10': 'bg-sky-50 text-sky-800 font-semibold',
  '11': 'bg-sky-50 text-sky-800 font-semibold',
  '12': 'bg-sky-50 text-sky-800 font-semibold',
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
  /** Код другого слоя — только при расхождении, мелкая подпись снизу */
  otherCode?: DayCode | ''
  /** Код плана на этот день — чтобы отличить недоработку от работы в выходной. */
  planCode?: DayCode | ''
  mismatch?: boolean
  /** Ячейка в мультивыделении (заливка) */
  selected?: boolean
  dimmed?: boolean
  hasComment?: boolean
  hasSubstitution?: boolean
  isBrigadier?: boolean
  dataCell?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  readOnly?: boolean
  size?: 'sm' | 'lg'
  layer?: 'plan' | 'fact'
  extraHours?: number
  overrideHours?: number | null
  remoteFlash?: boolean
  periodOff?: boolean
  payRisk?: 'idle' | 'pending' | null
}

/** Бейдж точных часов: −N недоработка, +N сверх плана / работа в выходной. */
function OverrideHoursBadge({
  overrideHours,
  planCode,
  prominent,
  asMainHours,
}: {
  overrideHours: number
  planCode?: DayCode | ''
  prominent?: boolean
  /** Часы уже показаны в центре ячейки (выходной) — бейдж не нужен. */
  asMainHours?: boolean
}) {
  if (asMainHours) return null
  const badgeClass = prominent
    ? 'absolute bottom-0 right-0 rounded-tl px-1 py-px text-[10px] font-bold leading-none text-white'
    : 'absolute bottom-0 right-0 rounded-tl px-0.5 text-[7px] font-bold leading-none text-white'
  const planNorm = hoursForCode((planCode ?? '') as DayCode)
  // Выходной/праздник в плане: любые часы = сверх плана (не «недоработка 8»).
  if (planNorm <= 0) {
    if (overrideHours <= 0) return null
    return (
      <span className={`${badgeClass} bg-amber-500`} title={`+${overrideHours}`}>
        +{overrideHours}
      </span>
    )
  }
  const delta = overrideHours - planNorm
  if (delta < 0) {
    return (
      <span
        className={`${badgeClass} bg-stone-600`}
        title={`${overrideHours}/${planNorm}`}
      >
        −{Math.abs(delta)}
      </span>
    )
  }
  if (delta > 0) {
    return (
      <span
        className={`${badgeClass} bg-amber-500`}
        title={`${overrideHours}/${planNorm}`}
      >
        +{delta}
      </span>
    )
  }
  return null
}

function DayCellInner({
  code,
  otherCode,
  planCode,
  mismatch,
  selected = false,
  dimmed,
  hasComment,
  hasSubstitution,
  isBrigadier,
  dataCell,
  onClick,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
  title,
  readOnly = false,
  size = 'sm',
  layer,
  extraHours = 0,
  overrideHours = null,
  remoteFlash = false,
  periodOff = false,
  payRisk = null,
}: Props) {
  const showOther =
    !!mismatch && otherCode != null && otherCode !== code
  const sizeClass =
    size === 'lg'
      ? showOther
        ? 'h-11 w-10 text-sm'
        : 'h-10 w-10 text-sm'
      : showOther
        ? 'h-9 w-8 text-xs'
        : 'h-8 w-8 text-xs'
  const riskRing =
    payRisk === 'idle'
      ? 'ring-2 ring-orange-500 ring-offset-1'
      : payRisk === 'pending'
        ? 'ring-2 ring-rose-500 ring-offset-1 ring-dashed'
        : ''
  const layerClass =
    layer === 'plan' ? 'day-cell--plan' : layer === 'fact' ? 'day-cell--fact' : ''
  const hoursProminent = layer === 'fact' || size === 'lg'
  const hoursBadgeClass = hoursProminent
    ? 'absolute bottom-0 right-0 rounded-tl bg-amber-500 px-1 py-px text-[10px] font-bold leading-none text-white'
    : 'absolute bottom-0 right-0 rounded-tl bg-amber-500 px-0.5 text-[7px] font-bold leading-none text-white'

  const planNorm = hoursForCode((planCode ?? '') as DayCode)
  // На выходном плане показываем отработанные часы в центре (2, 4…), а не «8» с бейджем.
  const weekendWorkHours =
    layer === 'fact' &&
    planNorm <= 0 &&
    overrideHours != null &&
    overrideHours > 0
  const mainLabel = weekendWorkHours
    ? String(overrideHours)
    : code || (periodOff ? '—' : '·')
  const styleCode = weekendWorkHours ? '8' : code

  return (
    <button
      type="button"
      title={title}
      data-cell={dataCell}
      data-coach="month:cell"
      onClick={readOnly ? undefined : onClick}
      onMouseDown={readOnly ? undefined : onMouseDown}
      onMouseEnter={readOnly ? undefined : onMouseEnter}
      onContextMenu={readOnly ? undefined : onContextMenu}
      tabIndex={readOnly ? -1 : 0}
      aria-selected={selected || undefined}
      className={`day-cell relative flex flex-col items-center justify-center font-mono transition-colors ${sizeClass} ${layerClass} ${
        readOnly
          ? 'cursor-default opacity-95'
          : 'cursor-pointer hover:ring-2 hover:ring-accent/35 focus:outline-none focus:ring-2 focus:ring-accent'
      } ${CELL_CODE_STYLES[styleCode] ?? CELL_CODE_STYLES['']} ${
        selected
          ? 'ring-2 ring-sky-500 ring-offset-1 bg-sky-50/80'
          : mismatch && !payRisk
            ? 'ring-2 ring-amber-400 ring-offset-1'
            : ''
      } ${riskRing} ${remoteFlash ? 'month-cell-remote-flash' : ''} ${
        periodOff ? 'month-cell-period-off' : ''
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <span className="leading-none">{mainLabel}</span>
      {showOther ? (
        <span
          className={`day-cell__other leading-none ${
            layer === 'plan' ? 'day-cell__other--fact' : 'day-cell__other--plan'
          }`}
          aria-hidden
        >
          {otherCode || '·'}
        </span>
      ) : null}
      {hasSubstitution && (
        <span
          className="absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-600"
          title="З"
        />
      )}
      {hasComment && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-sm bg-sky-500" />
      )}
      {isBrigadier && (
        <span
          className="absolute bottom-0 left-0 rounded-tr bg-stone-700 px-0.5 text-[8px] font-bold leading-none text-white"
          title="бригадир"
        >
          ★
        </span>
      )}
      {extraHours > 0 && overrideHours == null && (
        <span className={hoursBadgeClass}>+{extraHours}</span>
      )}
      {overrideHours != null && (
        <OverrideHoursBadge
          overrideHours={overrideHours}
          planCode={planCode}
          prominent={hoursProminent}
          asMainHours={weekendWorkHours}
        />
      )}
    </button>
  )
}

function propsEqual(prev: Props, next: Props): boolean {
  return (
    prev.code === next.code &&
    prev.otherCode === next.otherCode &&
    prev.planCode === next.planCode &&
    prev.mismatch === next.mismatch &&
    prev.dimmed === next.dimmed &&
    prev.hasComment === next.hasComment &&
    prev.hasSubstitution === next.hasSubstitution &&
    prev.isBrigadier === next.isBrigadier &&
    prev.dataCell === next.dataCell &&
    prev.title === next.title &&
    prev.readOnly === next.readOnly &&
    prev.size === next.size &&
    prev.layer === next.layer &&
    prev.extraHours === next.extraHours &&
    prev.overrideHours === next.overrideHours &&
    prev.remoteFlash === next.remoteFlash &&
    prev.payRisk === next.payRisk &&
    prev.periodOff === next.periodOff
  )
}

export const DayCell = memo(DayCellInner, propsEqual)
