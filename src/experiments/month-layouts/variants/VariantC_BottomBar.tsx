import { useState } from 'react'
import { MOCK_SITE, MOCK_STATS } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockKpiPanel, MockOpsPanel } from '../shared/MockPanels'

type Sheet = 'filters' | 'ops' | 'kpi' | null

export function VariantC_BottomBar() {
  const [sheet, setSheet] = useState<Sheet>(null)

  return (
    <div className="ml-variant ml-variant--c">
      <header className="ml-head ml-head--minimal">
        <button type="button" className="ml-btn ml-btn--ghost">
          ◀
        </button>
        <h1 className="ml-head__title">Июнь 2026</h1>
        <button type="button" className="ml-btn ml-btn--ghost">
          ▶
        </button>
        <span className="ml-pill">Обзор</span>
        <div className="ml-head__spacer" />
        <button type="button" className="ml-btn ml-btn--accent">
          Редакт.
        </button>
      </header>

      <div className="ml-c-table-area">
        <MockTimesheetTable />
      </div>

      {sheet && (
        <div className="ml-bottom-sheet">
          <div className="ml-bottom-sheet__handle" />
          <header className="ml-bottom-sheet__head">
            <strong>
              {sheet === 'filters' ? 'Фильтры' : sheet === 'ops' ? 'Операции' : 'Аналитика'}
            </strong>
            <button type="button" onClick={() => setSheet(null)}>
              ×
            </button>
          </header>
          <div className="ml-bottom-sheet__body">
            {sheet === 'filters' && <MockFilterPanel />}
            {sheet === 'ops' && <MockOpsPanel />}
            {sheet === 'kpi' && <MockKpiPanel />}
          </div>
        </div>
      )}

      <footer className="ml-dock">
        <button
          type="button"
          className={sheet === 'filters' ? 'ml-dock__on' : ''}
          onClick={() => setSheet(sheet === 'filters' ? null : 'filters')}
        >
          <span>▦</span>
          <span>Фильтры</span>
        </button>
        <button
          type="button"
          className={sheet === 'ops' ? 'ml-dock__on' : ''}
          onClick={() => setSheet(sheet === 'ops' ? null : 'ops')}
        >
          <span>⚙</span>
          <span>Операции</span>
        </button>
        <button
          type="button"
          className={sheet === 'kpi' ? 'ml-dock__on' : ''}
          onClick={() => setSheet(sheet === 'kpi' ? null : 'kpi')}
        >
          <span>◫</span>
          <span>
            {MOCK_STATS.fact}/{MOCK_STATS.plan}
          </span>
        </button>
        <button type="button">
          <span>⌕</span>
          <span>Поиск</span>
        </button>
        <button type="button">
          <span>⋯</span>
          <span>Ещё</span>
        </button>
      </footer>
      <p className="ml-head__sub ml-c-site">{MOCK_SITE}</p>
    </div>
  )
}
