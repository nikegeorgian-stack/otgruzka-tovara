import { useState } from 'react'
import { MOCK_SITE } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'
import { MockFilterPanel, MockKpiPanel, MockOpsPanel } from '../shared/MockPanels'

type Section = 'filters' | 'ops' | 'kpi'

export function VariantD_Accordion() {
  const [open, setOpen] = useState<Set<Section>>(new Set())

  function toggle(id: Section) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sections: { id: Section; label: string; summary: string }[] = [
    { id: 'filters', label: 'Фильтры', summary: '2/4 бригады · план+факт' },
    { id: 'ops', label: 'Операции', summary: 'массовые · шаблоны · экспорт' },
    { id: 'kpi', label: 'Аналитика', summary: '1762/1840 ч · 3 проблемы' },
  ]

  return (
    <div className="ml-variant ml-variant--d">
      <header className="ml-head ml-head--compact">
        <h1 className="ml-head__title">Июнь 2026</h1>
        <span className="ml-head__sub">{MOCK_SITE}</span>
        <input className="ml-search ml-search--inline" type="search" placeholder="Сотрудник…" />
        <div className="ml-head__spacer" />
        <div className="ml-seg ml-seg--sm">
          <button type="button" className="ml-seg__on">
            Обзор
          </button>
          <button type="button">План</button>
          <button type="button">Факт</button>
        </div>
        <button type="button" className="ml-btn ml-btn--accent">
          Редактировать
        </button>
        <button type="button" className="ml-btn ml-btn--ghost">
          ⋯
        </button>
      </header>

      <div className="ml-accordion">
        {sections.map((s) => {
          const isOpen = open.has(s.id)
          return (
            <div key={s.id} className={`ml-acc ${isOpen ? 'ml-acc--open' : ''}`}>
              <button type="button" className="ml-acc__head" onClick={() => toggle(s.id)}>
                <span className="ml-acc__chev">{isOpen ? '▾' : '▸'}</span>
                <span className="ml-acc__label">{s.label}</span>
                {!isOpen && <span className="ml-acc__sum">{s.summary}</span>}
              </button>
              {isOpen && (
                <div className="ml-acc__body">
                  {s.id === 'filters' && <MockFilterPanel />}
                  {s.id === 'ops' && <MockOpsPanel />}
                  {s.id === 'kpi' && <MockKpiPanel />}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <MockTimesheetTable />
    </div>
  )
}
