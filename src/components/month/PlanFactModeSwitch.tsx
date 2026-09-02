type Mode = 'plan' | 'fact'

type Props = {
  value: Mode
  onChange: (mode: Mode) => void
  planLabel: string
  factLabel: string
  planHint?: string
  factHint?: string
  groupLabel?: string
  size?: 'sm' | 'md'
  /** pill — компактный; rail — вертикальный пульт; deck — широкий в шапке */
  variant?: 'pill' | 'rail' | 'deck'
}

/**
 * Переключатель План / Факт — подпись слоя, не просто таб.
 */
export function PlanFactModeSwitch({
  value,
  onChange,
  planLabel,
  factLabel,
  planHint,
  factHint,
  groupLabel,
  size = 'md',
  variant = 'pill',
}: Props) {
  const items = (
    [
      ['fact', factLabel, factHint],
      ['plan', planLabel, planHint],
    ] as const
  )

  if (variant === 'rail') {
    return (
      <div className={`pf-rail pf-rail--${value}`} role="group" aria-label={groupLabel}>
        {items.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={`pf-rail__btn pf-rail__btn--${id} ${value === id ? 'pf-rail__btn--on' : ''}`}
            onClick={() => onChange(id)}
            title={hint}
            aria-pressed={value === id}
            data-coach={id === 'plan' ? 'month:tabPlan' : 'month:tabFact'}
          >
            <span className="pf-rail__mark" aria-hidden />
            <span className="pf-rail__text">{label}</span>
          </button>
        ))}
      </div>
    )
  }

  if (variant === 'deck') {
    return (
      <div
        className={`pf-deck-switch pf-deck-switch--${value}`}
        role="group"
        aria-label={groupLabel}
      >
        <span className="pf-deck-switch__glow" aria-hidden />
        {items.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={`pf-deck-switch__btn ${value === id ? 'pf-deck-switch__btn--on' : ''}`}
            onClick={() => onChange(id)}
            title={hint}
            aria-pressed={value === id}
            data-coach={id === 'plan' ? 'month:tabPlan' : 'month:tabFact'}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }

  const sm = size === 'sm'
  return (
    <div
      className={`pf-mode ${sm ? 'pf-mode--sm' : ''} pf-mode--${value}`}
      role="group"
      aria-label={groupLabel}
    >
      <span className="pf-mode__glow" aria-hidden />
      {items.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          className={`pf-mode__btn ${value === id ? 'pf-mode__btn--on' : ''}`}
          onClick={() => onChange(id)}
          title={hint}
          aria-pressed={value === id}
          data-coach={id === 'plan' ? 'month:tabPlan' : 'month:tabFact'}
        >
          <span className="pf-mode__dot" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
