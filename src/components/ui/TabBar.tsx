type Tab<T extends string> = {
  id: T
  label: string
  count?: number
  /** Явный data-coach; иначе при coachPrefix → `${coachPrefix}:${id}` (camelCase id). */
  coach?: string
}

type Props<T extends string> = {
  tabs: Tab<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  /** Префикс якоря коуча, напр. month → data-coach="month:plan" */
  coachPrefix?: string
}

function tabCoachKey(id: string): string {
  // fact → Fact, documents → Documents for month:tabFact style keys in catalog
  return id.charAt(0).toUpperCase() + id.slice(1)
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  coachPrefix,
}: Props<T>) {
  return (
    <div
      className={`fc-tabbar ${className}`.trim()}
      role="tablist"
      {...(coachPrefix ? { 'data-coach': `${coachPrefix}:tabs` } : {})}
    >
      {tabs.map((tab) => {
        const active = tab.id === value
        const coach =
          tab.coach ??
          (coachPrefix ? `${coachPrefix}:tab${tabCoachKey(String(tab.id))}` : undefined)
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`fc-tabbar__tab ${active ? 'fc-tabbar__tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
            {...(coach ? { 'data-coach': coach } : {})}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="fc-tabbar__count">{tab.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
