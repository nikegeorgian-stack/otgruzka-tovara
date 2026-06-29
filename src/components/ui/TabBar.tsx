type Tab<T extends string> = {
  id: T
  label: string
  count?: number
}

type Props<T extends string> = {
  tabs: Tab<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: Props<T>) {
  return (
    <div className={`fc-tabbar ${className}`.trim()} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`fc-tabbar__tab ${active ? 'fc-tabbar__tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
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
