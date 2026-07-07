import { useState } from 'react'
import { MOCK_SITE } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockKpiPanel, MockOpsPanel } from '../shared/MockPanels'

type Layout = 'dual' | 'plan' | 'fact'

export function VariantA_Toolbar() {
  const [layout, setLayout] = useState<Layout>('dual')
  const [menu, setMenu] = useState<'filters' | 'ops' | 'kpi' | null>(null)

  return (
    <div className="ml-variant ml-variant--a">
      <header className="ml-head ml-head--a">
        <div className="ml-head__left">
          <h1 className="ml-head__title">Июнь 2026</h1>
          <span className="ml-head__sub">{MOCK_SITE}</span>
        </div>
        <div className="ml-head__center">
          <input className="ml-search" type="search" placeholder="Сотрудник…" />
          <div className="ml-seg">
            {(['dual', 'plan', 'fact'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={layout === id ? 'ml-seg__on' : ''}
                onClick={() => setLayout(id)}
              >
                {id === 'dual' ? 'Обзор' : id === 'plan' ? 'План' : 'Факт'}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-head__right">
          <button type="button" className="ml-btn ml-btn--ghost">
            ◀ ▶
          </button>
          <button type="button" className="ml-btn ml-btn--sky">
            План
          </button>
          <button type="button" className="ml-btn ml-btn--accent">
            Редактировать
          </button>
          <div className="ml-drop-wrap">
            <button
              type="button"
              className={`ml-btn ${menu === 'filters' ? 'ml-btn--on' : ''}`}
              onClick={() => setMenu(menu === 'filters' ? null : 'filters')}
            >
              ▦ Фильтры
            </button>
            {menu === 'filters' && (
              <div className="ml-drop ml-drop--wide">
                <MockFilterPanel />
              </div>
            )}
          </div>
          <div className="ml-drop-wrap">
            <button
              type="button"
              className={`ml-btn ${menu === 'ops' ? 'ml-btn--on' : ''}`}
              onClick={() => setMenu(menu === 'ops' ? null : 'ops')}
            >
              ⚙
            </button>
            {menu === 'ops' && (
              <div className="ml-drop">
                <MockOpsPanel />
              </div>
            )}
          </div>
          <button
            type="button"
            className={`ml-btn ${menu === 'kpi' ? 'ml-btn--on' : ''}`}
            onClick={() => setMenu(menu === 'kpi' ? null : 'kpi')}
          >
            ◫ 3
          </button>
          <button type="button" className="ml-btn ml-btn--ghost">
            ⋯
          </button>
        </div>
      </header>

      {menu === 'kpi' && (
        <div className="ml-kpi-bar">
          <MockKpiPanel />
        </div>
      )}

      <MockTimesheetTable />
    </div>
  )
}
