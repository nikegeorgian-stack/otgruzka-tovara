import { useState } from 'react'
import { MOCK_BRIGADES, MOCK_ROWS, MOCK_SITE, MOCK_STATS } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockOpsPanel } from '../shared/MockPanels'

type SideTab = 'brigades' | 'units' | 'ops'

export function VariantF_IdeSidebar() {
  const [sideTab, setSideTab] = useState<SideTab>('brigades')
  const [selectedBrigade, setSelectedBrigade] = useState(MOCK_BRIGADES[0])

  return (
    <div className="ml-variant ml-variant--f">
      <header className="ml-f-statusbar">
        <span className="ml-f-statusbar__month">Июнь 2026</span>
        <span className="ml-f-statusbar__dot">·</span>
        <span>{MOCK_SITE}</span>
        <span className="ml-f-statusbar__dot">·</span>
        <span className="ml-f-statusbar__kpi">
          {MOCK_STATS.fact}/{MOCK_STATS.plan} ч
        </span>
        {MOCK_STATS.problems > 0 && (
          <span className="ml-f-statusbar__warn">⚠ {MOCK_STATS.problems}</span>
        )}
        <div className="ml-head__spacer" />
        <div className="ml-seg ml-seg--xs">
          <button type="button" className="ml-seg__on">
            Обзор
          </button>
          <button type="button">План</button>
          <button type="button">Факт</button>
        </div>
        <button type="button" className="ml-btn ml-btn--accent ml-btn--xs">
          Редактировать
        </button>
      </header>

      <div className="ml-f-split">
        <aside className="ml-f-sidebar">
          <nav className="ml-f-sidebar__tabs">
            {(
              [
                ['brigades', 'Бригады'],
                ['units', 'Подразд.'],
                ['ops', 'Операции'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={sideTab === id ? 'ml-f-sidebar__tab--on' : ''}
                onClick={() => setSideTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-f-sidebar__body">
            {sideTab === 'brigades' && (
              <>
                <input className="ml-f-search" type="search" placeholder="Бригада…" />
                <ul className="ml-f-tree">
                  {MOCK_BRIGADES.map((b) => (
                    <li key={b}>
                      <button
                        type="button"
                        className={`ml-f-tree__item ${selectedBrigade === b ? 'ml-f-tree__item--on' : ''}`}
                        onClick={() => setSelectedBrigade(b)}
                      >
                        <span className="ml-f-tree__label">{b}</span>
                        <span className="ml-f-tree__count">
                          {MOCK_ROWS.filter((r) => r.brigade === b).length}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="ml-f-sidebar__hint">Выбрано: {selectedBrigade}</p>
              </>
            )}
            {sideTab === 'units' && <MockFilterPanel />}
            {sideTab === 'ops' && <MockOpsPanel />}
          </div>
        </aside>

        <main className="ml-f-main">
          <div className="ml-f-main__toolbar">
            <input className="ml-search" type="search" placeholder="Сотрудник в таблице…" />
            <span className="ml-f-main__ctx">{selectedBrigade}</span>
          </div>
          <MockTimesheetTable />
        </main>
      </div>
    </div>
  )
}
