import { useState } from 'react'
import { MOCK_SITE } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockKpiPanel, MockOpsPanel } from '../shared/MockPanels'

export function VariantE_Focus() {
  const [fabOpen, setFabOpen] = useState(false)
  const [tab, setTab] = useState<'filters' | 'ops' | 'kpi' | 'more'>('filters')

  return (
    <div className="ml-variant ml-variant--e">
      <header className="ml-head ml-head--micro">
        <button type="button" className="ml-micro-btn">
          ◀ Июнь 2026 ▶
        </button>
        <div className="ml-seg ml-seg--xs">
          <button type="button" className="ml-seg__on">
            Обзор
          </button>
          <button type="button">П</button>
          <button type="button">Ф</button>
        </div>
        <span className="ml-head__sub ml-head__sub--fade">{MOCK_SITE}</span>
        <div className="ml-head__spacer" />
        <button type="button" className="ml-btn ml-btn--accent ml-btn--xs">
          ✎
        </button>
      </header>

      <MockTimesheetTable className="ml-table--bleed" />

      {fabOpen && (
        <>
          <button
            type="button"
            className="ml-fab-backdrop"
            aria-label="Закрыть"
            onClick={() => setFabOpen(false)}
          />
          <div className="ml-fab-panel">
            <nav className="ml-fab-tabs">
              {(
                [
                  ['filters', 'Фильтры'],
                  ['ops', 'Операции'],
                  ['kpi', 'KPI'],
                  ['more', 'Ещё'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={tab === id ? 'ml-fab-tabs__on' : ''}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="ml-fab-body">
              {tab === 'filters' && <MockFilterPanel />}
              {tab === 'ops' && <MockOpsPanel />}
              {tab === 'kpi' && <MockKpiPanel />}
              {tab === 'more' && (
                <ul className="ml-more-list">
                  <li>Перекличка</li>
                  <li>Печать</li>
                  <li>Закрыть месяц</li>
                  <li>Настройки вида</li>
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        className={`ml-fab ${fabOpen ? 'ml-fab--open' : ''}`}
        onClick={() => setFabOpen((o) => !o)}
        aria-expanded={fabOpen}
      >
        {fabOpen ? '×' : '⋯'}
      </button>
    </div>
  )
}
