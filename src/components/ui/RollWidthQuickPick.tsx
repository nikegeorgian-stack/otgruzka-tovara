import { ROLL_WIDTH_PRESETS_M } from '@/lib/warehouse/loadingProfile'

type Props = {
  value?: number
  onPick: (widthM: number) => void
  disabled?: boolean
}

function fmt(w: number): string {
  return w.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function RollWidthQuickPick({ value, onPick, disabled }: Props) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ROLL_WIDTH_PRESETS_M.map((w) => {
        const active = value != null && Math.abs(value - w) < 0.001
        return (
          <button
            key={w}
            type="button"
            disabled={disabled}
            className={`rounded-sm border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              active
                ? 'border-teal-700 bg-teal-700 text-white'
                : 'border-grid bg-white text-stone-600 hover:bg-teal-50'
            } disabled:opacity-50`}
            onClick={() => onPick(w)}
          >
            {fmt(w)}
          </button>
        )
      })}
    </div>
  )
}
