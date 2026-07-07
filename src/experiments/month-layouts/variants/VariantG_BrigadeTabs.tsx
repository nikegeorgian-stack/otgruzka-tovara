import { useState } from 'react'
import { MOCK_BRIGADES, MOCK_ROWS, MOCK_STATS } from '../mockData'

const CELL = ['8', '8', 'В', '8', 'Н', '8', '8', 'ОТ', '8', '8', '8', '11', '8', '8'] as const
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1)

export function VariantG_BrigadeTabs() {
  const [brigade, setBrigade] = useState(MOCK_BRIGADES[0])
  const rows = MOCK_ROWS.filter((r) => r.brigade === brigade)

  return (
    <div className="ml-variant ml-variant--g">
      <header className="ml-g-top">
        <div className="ml-g-top__left">
          <button type="button" className="ml-btn ml-btn--ghost">
            ◀
          </button>
          <h1 className="ml-head__title">Июнь 2026</h1>
          <button type="button" className="ml-btn ml-btn--ghost">
            ▶
          </button>
        </div>
        <div className="ml-g-kpi-strip">
          <span>
            План <strong>{MOCK_STATS.plan}</strong>
          </span>
          <span>
            Факт <strong>{MOCK_STATS.fact}</strong>
          </span>
          <span className="ml-g-kpi-strip--warn">
            Δ <strong>{MOCK_STATS.delta}</strong>
          </span>
        </div>
        <div className="ml-head__spacer" />
        <button type="button" className="ml-btn ml-btn--accent">
          Редактировать
        </button>
        <button type="button" className="ml-btn ml-btn--ghost">
          ⋯
        </button>
      </header>

      <div className="ml-g-tabs" role="tablist">
        {MOCK_BRIGADES.map((b) => {
          const count = MOCK_ROWS.filter((r) => r.brigade === b).length
          const on = b === brigade
          return (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={on}
              className={`ml-g-tab ${on ? 'ml-g-tab--on' : ''}`}
              onClick={() => setBrigade(b)}
            >
              {b}
              <span className="ml-g-tab__badge">{count}</span>
            </button>
          )
        })}
        <button type="button" className="ml-g-tab ml-g-tab--add" title="Все бригады">
          +4
        </button>
      </div>

      <div className="ml-g-mode">
        <div className="ml-seg ml-seg--sm">
          <button type="button" className="ml-seg__on">
            План + факт
          </button>
          <button type="button">Только план</button>
          <button type="button">Только факт</button>
        </div>
        <input className="ml-search ml-search--inline" type="search" placeholder="В бригаде…" />
      </div>

      <div className="ml-g-table-wrap">
        <table className="ml-g-table">
          <thead>
            <tr>
              <th className="ml-g-sticky-name">Сотрудник</th>
              <th className="ml-g-sticky-tab">№</th>
              {DAYS.map((d) => (
                <th key={d} className="ml-g-day">
                  {d}
                </th>
              ))}
              <th>Σ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.tab}>
                <td className="ml-g-sticky-name">{row.name}</td>
                <td className="ml-g-sticky-tab font-mono">{row.tab}</td>
                {DAYS.map((d, di) => (
                  <td
                    key={d}
                    className={`ml-mock-cell ml-mock-cell--${CELL[(ri + di) % CELL.length]}`}
                  >
                    {CELL[(ri + di) % CELL.length]}
                  </td>
                ))}
                <td className="font-mono">168</td>
              </tr>
            ))}
            <tr className="ml-g-slot-row">
              <td colSpan={2} className="ml-g-sticky-name text-stone-400">
                + Добавить строку
              </td>
              <td colSpan={DAYS.length + 1} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
