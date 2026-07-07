import { useState } from 'react'
import { MOCK_ROWS, MOCK_STATS } from '../mockData'

const CELL = ['8', '8', 'В', '8', 'Н', '8', '8', 'ОТ', '8', '8', '8', '11', '8', '8', '8'] as const
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1)

export function VariantI_Cards() {
  const [expanded, setExpanded] = useState<string | null>(MOCK_ROWS[0]?.tab ?? null)

  return (
    <div className="ml-variant ml-variant--i">
      <header className="ml-i-head">
        <div>
          <h1 className="ml-head__title">Июнь 2026</h1>
          <p className="ml-i-head__sub">
            {MOCK_ROWS.length} сотрудников · {MOCK_STATS.fact} ч факт
          </p>
        </div>
        <input className="ml-search" type="search" placeholder="Имя или табель…" />
        <select className="ml-i-select" defaultValue="">
          <option value="">Все бригады</option>
          <option>Бригада 1</option>
          <option>Бригада 2</option>
          <option>Упаковка</option>
        </select>
        <button type="button" className="ml-btn ml-btn--accent">
          Редактировать
        </button>
      </header>

      <div className="ml-i-list">
        {MOCK_ROWS.map((row, ri) => {
          const open = expanded === row.tab
          return (
            <article
              key={row.tab}
              className={`ml-i-card ${open ? 'ml-i-card--open' : ''}`}
            >
              <button
                type="button"
                className="ml-i-card__head"
                onClick={() => setExpanded(open ? null : row.tab)}
              >
                <div className="ml-i-card__avatar">{row.name.slice(0, 1)}</div>
                <div className="ml-i-card__info">
                  <span className="ml-i-card__name">{row.name}</span>
                  <span className="ml-i-card__meta">
                    №{row.tab} · {row.brigade}
                  </span>
                </div>
                <div className="ml-i-card__mini">
                  {DAYS.slice(0, 10).map((d, di) => (
                    <span
                      key={d}
                      className={`ml-i-dot ml-i-dot--${CELL[(ri + di) % CELL.length]}`}
                      title={`${d}: ${CELL[(ri + di) % CELL.length]}`}
                    />
                  ))}
                  <span className="ml-i-card__more">+20</span>
                </div>
                <span className="ml-i-card__hours">168ч</span>
                <span className="ml-i-card__chev">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="ml-i-card__timeline">
                  <div className="ml-i-timeline-scroll">
                    {DAYS.map((d, di) => {
                      const code = CELL[(ri + di) % CELL.length]
                      return (
                        <div key={d} className="ml-i-day">
                          <span className="ml-i-day__num">{d}</span>
                          <span className={`ml-i-day__code ml-i-day__code--${code}`}>
                            {code}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="ml-i-card__actions">
                    <button type="button">План</button>
                    <button type="button">Факт</button>
                    <button type="button">Замена</button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
