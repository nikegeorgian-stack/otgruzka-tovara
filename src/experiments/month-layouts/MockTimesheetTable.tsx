import { MOCK_DAYS, MOCK_ROWS } from './mockData'

const CELL = ['8', '8', 'В', '8', 'Н', '8', '8', 'ОТ', '8', '8'] as const

type Props = {
  compact?: boolean
  className?: string
}

export function MockTimesheetTable({ compact = false, className = '' }: Props) {
  const dayCols = compact ? MOCK_DAYS.slice(0, 14) : MOCK_DAYS

  return (
    <div className={`ml-mock-table-wrap ${className}`.trim()}>
      <table className="ml-mock-table">
        <thead>
          <tr>
            <th className="ml-mock-sticky ml-mock-name">Сотрудник</th>
            <th className="ml-mock-sticky ml-mock-tab">№</th>
            {!compact && <th className="ml-mock-brig">Бригада</th>}
            {dayCols.map((d) => (
              <th key={d} className="ml-mock-day">
                {d}
              </th>
            ))}
            <th className="ml-mock-sum">Σ</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_ROWS.map((row, ri) => (
            <tr key={ri}>
              <td className="ml-mock-sticky ml-mock-name">{row.name}</td>
              <td className="ml-mock-sticky ml-mock-tab font-mono text-[10px]">{row.tab}</td>
              {!compact && <td className="ml-mock-brig text-[10px]">{row.brigade}</td>}
              {dayCols.map((d, di) => (
                <td
                  key={d}
                  className={`ml-mock-cell ml-mock-cell--${CELL[(ri + di) % CELL.length]}`}
                >
                  {CELL[(ri + di) % CELL.length]}
                </td>
              ))}
              <td className="ml-mock-sum font-mono">168</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
