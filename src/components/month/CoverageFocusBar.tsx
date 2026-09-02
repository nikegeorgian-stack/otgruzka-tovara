type Chip = {
  id: string
  label: string
  title: string
  brigades: string[]
}

type Props = {
  chips: Chip[]
  activeId: string
  onSelect: (id: string, brigades: string[]) => void
  hint: string
}

/** Переключатель «мои бригады / подмена другого мастера / все». */
export function CoverageFocusBar({ chips, activeId, onSelect, hint }: Props) {
  if (chips.length === 0) return null
  return (
    <div
      className="print:hidden space-y-1.5 rounded-sm border border-sky-200 bg-sky-50/90 px-3 py-2"
      data-coach="month:coverage"
    >
      <p className="text-[11px] font-medium text-sky-950/80">{hint}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={hint}>
        {chips.map((chip) => {
          const on = chip.id === activeId
          const empty = chip.brigades.length === 0
          return (
            <button
              key={chip.id}
              type="button"
              disabled={empty}
              title={empty ? chip.title : `${chip.title} (${chip.brigades.length})`}
              aria-pressed={on}
              onClick={() => onSelect(chip.id, chip.brigades)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                on
                  ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                  : empty
                    ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400'
                    : 'border-sky-300 bg-white text-sky-950 hover:border-sky-500 hover:bg-sky-100'
              }`}
            >
              {chip.label}
              {!empty ? (
                <span className={`ml-1 tabular-nums ${on ? 'text-sky-100' : 'text-sky-700/70'}`}>
                  {chip.brigades.length}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
