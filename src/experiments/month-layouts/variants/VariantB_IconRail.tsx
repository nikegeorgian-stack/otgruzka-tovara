import { useState } from 'react'
import { MOCK_SITE } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockKpiPanel, MockOpsPanel } from '../shared/MockPanels'

type Panel = 'filters' | 'ops' | 'kpi' | null

export function VariantB_IconRail() {
  const [panel, setPanel] = useState<Panel>(null)

  return (
    <div className="ml-variant ml-variant--b">
      <header className="ml-head ml-head--compact">
        <h1 className="ml-head__title">Июнь 2026</h1>
        <span className="ml-head__sub">{MOCK_SITE}</span>
        <div className="ml-head__spacer" />
        <button type="button" className="ml-btn ml-btn--accent">
          Редактировать
        </button>
        <div className="ml-seg ml-seg--sm">
          <button type="button" className="ml-seg__on">
            Обзор
          </button>
          <button type="button">План</button>
          <button type="button">Факт</button>
        </div>
      </header>

      <div className="ml-b-body">
        <nav className="ml-icon-rail" aria-label="Инструменты табеля">
          {(
            [
              ['filters', '▦', 'Фильтры'],
              ['ops', '⚙', 'Операции'],
              ['kpi', '◫', 'Аналитика'],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              className={`ml-icon-rail__btn ${panel === id ? 'ml-icon-rail__btn--on' : ''}`}
              title={label}
              onClick={() => setPanel(panel === id ? null : id)}
            >
              <span>{icon}</span>
              <span className="ml-icon-rail__tip">{label}</span>
            </button>
          ))}
          <button type="button" className="ml-icon-rail__btn" title="Поиск">
            ⌕
          </button>
        </nav>

        <div className="ml-b-main">
          {panel && (
            <aside className="ml-side-pop">
              <header className="ml-side-pop__head">
                <span>
                  {panel === 'filters' ? 'Фильтры' : panel === 'ops' ? 'Операции' : 'Аналитика'}
                </span>
                <button type="button" onClick={() => setPanel(null)}>
                  ×
                </button>
              </header>
              {panel === 'filters' && <MockFilterPanel />}
              {panel === 'ops' && <MockOpsPanel />}
              {panel === 'kpi' && <MockKpiPanel />}
            </aside>
          )}
          <MockTimesheetTable />
        </div>
      </div>
    </div>
  )
}
