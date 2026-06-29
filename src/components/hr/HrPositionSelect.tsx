import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'

type Props = {
  units: HrStructuralUnit[]
  positions: HrPosition[]
  value: string
  onChange: (positionId: string) => void
  allowEmpty?: boolean
  className?: string
}

export function HrPositionSelect({
  units,
  positions,
  value,
  onChange,
  allowEmpty = true,
  className = 'mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm',
}: Props) {
  const { t } = useI18n()

  const grouped = useMemo(() => {
    const activeUnits = [...units]
      .filter((u) => !u.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
    const activePositions = positions.filter((p) => !p.archived)

    return activeUnits
      .map((unit) => ({
        unit,
        rows: activePositions
          .filter((p) => p.structuralUnitId === unit.id || p.department === unit.name)
          .sort((a, b) => a.title.localeCompare(b.title, 'ru')),
      }))
      .filter((g) => g.rows.length > 0)
  }, [units, positions])

  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{t('orgStructure.choosePosition')}</option> : null}
      {grouped.map(({ unit, rows }) => (
        <optgroup key={unit.id} label={unit.name}>
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.rank ? ` · ${p.rank}` : ''}
              {p.qualificationClass ? ` (${p.qualificationClass})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
