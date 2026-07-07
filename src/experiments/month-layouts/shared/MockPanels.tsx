import { MOCK_BRIGADES, MOCK_STATS } from '../mockData'

export function MockFilterPanel() {
  return (
    <div className="ml-panel">
      <label className="ml-field">
        <span>Поиск бригады</span>
        <input type="search" placeholder="Бригада…" defaultValue="" />
      </label>
      <div className="ml-chip-row">
        {MOCK_BRIGADES.map((b) => (
          <label key={b} className="ml-chip-check">
            <input type="checkbox" defaultChecked={b.startsWith('Бригада')} />
            {b}
          </label>
        ))}
      </div>
      <div className="ml-toggle-row">
        <label>
          <input type="checkbox" defaultChecked /> План
        </label>
        <label>
          <input type="checkbox" defaultChecked /> Факт
        </label>
        <label>
          <input type="checkbox" /> Только отклонения
        </label>
      </div>
    </div>
  )
}

export function MockOpsPanel() {
  return (
    <div className="ml-panel">
      <div className="ml-btn-grid">
        <button type="button">Праздник В</button>
        <button type="button">План → факт</button>
        <button type="button">Шаблон смены</button>
        <button type="button">Excel</button>
      </div>
      <label className="ml-field">
        <span>График</span>
        <select defaultValue="">
          <option value="">Все</option>
          <option>2/2</option>
          <option>5/2</option>
        </select>
      </label>
    </div>
  )
}

export function MockKpiPanel() {
  return (
    <div className="ml-panel">
      <div className="ml-kpi-grid">
        <div className="ml-kpi">
          <span className="ml-kpi__label">План, ч</span>
          <span className="ml-kpi__val">{MOCK_STATS.plan}</span>
        </div>
        <div className="ml-kpi">
          <span className="ml-kpi__label">Факт, ч</span>
          <span className="ml-kpi__val">{MOCK_STATS.fact}</span>
        </div>
        <div className="ml-kpi ml-kpi--warn">
          <span className="ml-kpi__label">Δ</span>
          <span className="ml-kpi__val">{MOCK_STATS.delta}</span>
        </div>
        <div className="ml-kpi ml-kpi--warn">
          <span className="ml-kpi__label">Проблемы</span>
          <span className="ml-kpi__val">{MOCK_STATS.problems}</span>
        </div>
      </div>
      <p className="ml-legend text-[10px] text-stone-500">
        8 · 11 · Н · В · ОТ · Б — легенда кодов
      </p>
    </div>
  )
}
