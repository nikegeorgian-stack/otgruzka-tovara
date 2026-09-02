type Tab = { id: string; label: string; coach?: string }

type Props = {
  tabs: Tab[]
  value: string
  onChange: (id: string) => void
}

/** Pill-навигация раздела «Задачи» — отдельный от общего TabBar chrome. */
export function TasksWorkspaceNav({ tabs, value, onChange }: Props) {
  return (
    <nav
      className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-gradient-to-b from-stone-100/95 to-stone-200/40 p-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"
      aria-label="tasks navigation"
    >
      {tabs.map(tab => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            data-coach={tab.coach}
            onClick={() => onChange(tab.id)}
            className={[
              'rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out',
              active
                ? 'bg-white text-sky-900 shadow-md shadow-stone-300/30 ring-1 ring-white/80'
                : 'text-stone-600 hover:bg-white/50 hover:text-stone-900 active:scale-[0.98]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
