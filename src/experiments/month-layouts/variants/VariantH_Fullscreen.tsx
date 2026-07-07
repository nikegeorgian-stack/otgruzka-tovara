import { useState } from 'react'
import { MOCK_STATS } from '../mockData'
import { MockTimesheetTable } from '../MockTimesheetTable'

const COMMANDS = [
  { keys: '⌘K', label: 'Палитра команд' },
  { keys: 'E', label: 'Редактировать / готово' },
  { keys: 'F', label: 'Фильтры бригад' },
  { keys: 'P', label: 'Печать' },
  { keys: '← →', label: 'Месяц' },
  { keys: '1 2 3', label: 'Обзор / план / факт' },
]

export function VariantH_Fullscreen() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  return (
    <div className="ml-variant ml-variant--h">
      <div className="ml-h-badge">
        <span className="ml-h-badge__month">Июн 2026</span>
        <span className="ml-h-badge__mode">Обзор</span>
        {editing && <span className="ml-h-badge__edit">✎</span>}
      </div>

      <button
        type="button"
        className="ml-h-cmd-hint"
        onClick={() => setPaletteOpen(true)}
        title="Палитра команд (⌘K)"
      >
        ⌘K
      </button>

      <MockTimesheetTable className="ml-h-table" />

      <div className="ml-h-corner">
        <button
          type="button"
          className={`ml-h-corner__btn ${editing ? 'ml-h-corner__btn--on' : ''}`}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? 'Готово' : 'Редакт.'}
        </button>
        <span className="ml-h-corner__stat">
          {MOCK_STATS.fact}/{MOCK_STATS.plan}
        </span>
      </div>

      {paletteOpen && (
        <>
          <button
            type="button"
            className="ml-h-palette-backdrop"
            aria-label="Закрыть"
            onClick={() => setPaletteOpen(false)}
          />
          <div className="ml-h-palette" role="dialog">
            <input
              className="ml-h-palette__input"
              type="search"
              placeholder="Команда: фильтр, печать, закрыть месяц…"
              autoFocus
            />
            <ul className="ml-h-palette__list">
              {[
                'Фильтры бригад…',
                'Перекличка',
                'Печать табеля',
                'Экспорт Excel',
                'Закрыть месяц',
                'Настройки вида',
              ].map((cmd) => (
                <li key={cmd}>
                  <button type="button">{cmd}</button>
                </li>
              ))}
            </ul>
            <div className="ml-h-palette__keys">
              {COMMANDS.map((c) => (
                <span key={c.keys}>
                  <kbd>{c.keys}</kbd> {c.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
