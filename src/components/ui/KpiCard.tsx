type Props = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warn' | 'ok'
}

export function KpiCard({ label, value, hint, tone = 'default' }: Props) {
  return (
    <div className={`fc-kpi fc-kpi--${tone}`}>
      <p className="fc-kpi__label">{label}</p>
      <p className="fc-kpi__value">{value}</p>
      {hint && <p className="fc-kpi__hint">{hint}</p>}
    </div>
  )
}
