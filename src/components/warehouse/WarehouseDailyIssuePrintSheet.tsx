import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { formatQty } from '@/lib/warehouse/stock'
import type { DailyIssueSession, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  store: WarehouseStore
  session: DailyIssueSession
  site?: string
  responsible?: string
}

export function WarehouseDailyIssuePrintSheet({ store, session, site, responsible }: Props) {
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const whName = store.locations.find((l) => l.id === session.warehouseId)?.name ?? '—'

  const lines = session.lines
    .filter((l) => l.quantity > 0)
    .sort((a, b) => {
      const na = itemMap.get(a.itemId)?.name ?? ''
      const nb = itemMap.get(b.itemId)?.name ?? ''
      return na.localeCompare(nb, 'ru')
    })

  const dateRu = new Date(session.date + 'T12:00:00').toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  const recentEvents = [...session.events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40)

  return (
    <div className="print-sheet-page print-daily-issue-page">
      <div className="print-sheet-content">
        <header className="print-sheet-header">
          <div className="print-fc-header-row">
            <FiberCellBrand variant="print" />
            <div className="print-fc-header-text">
              <p className="print-org">{site ?? 'FiberCell'}</p>
              <h1 className="print-title">Ведомость выдачи за день</h1>
              <p className="print-meta">
                № <strong>{session.number}</strong> · {dateRu}
              </p>
              <p className="print-meta">
                Кладовщик: <strong>{session.keeperName}</strong> · Склад:{' '}
                <strong>{whName}</strong>
              </p>
              {session.comment && (
                <p className="print-meta">Примечание: {session.comment}</p>
              )}
              <p className="print-meta">
                Позиций: <strong>{lines.length}</strong> · Выдано единиц:{' '}
                <strong>{formatQty(totalQty)}</strong>
                {session.status === 'posted' && (
                  <span className="print-daily-posted"> · Проведено</span>
                )}
              </p>
            </div>
          </div>
        </header>

        <table className="print-table print-daily-issue-table">
          <thead>
            <tr>
              <th className="print-inv-num">№</th>
              <th className="print-inv-code">Код</th>
              <th className="print-inv-name">Наименование</th>
              <th>Категория</th>
              <th className="print-inv-unit">Ед.</th>
              <th className="print-inv-qty">Кол-во</th>
              <th className="print-inv-sign">Получил</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const item = itemMap.get(line.itemId)
              if (!item) return null
              return (
                <tr key={line.itemId}>
                  <td className="print-inv-num">{idx + 1}</td>
                  <td className="print-inv-code">{item.internalCode}</td>
                  <td className="print-inv-name">{item.name}</td>
                  <td className="text-xs">{catMap.get(item.categoryId) ?? '—'}</td>
                  <td className="print-inv-unit">{item.unit}</td>
                  <td className="print-inv-qty">{formatQty(line.quantity)}</td>
                  <td className="print-inv-sign" />
                </tr>
              )
            })}
          </tbody>
        </table>

        {recentEvents.length > 0 && (
          <section className="print-daily-events">
            <h2 className="print-daily-events-title">Журнал выдачи в течение дня</h2>
            <table className="print-table print-daily-events-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Позиция</th>
                  <th>Изм.</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((ev) => {
                  const item = itemMap.get(ev.itemId)
                  const time = ev.at.slice(11, 16)
                  return (
                    <tr key={ev.id}>
                      <td className="font-mono text-xs">{time}</td>
                      <td>{item?.name ?? '—'}</td>
                      <td
                        className={`font-mono text-xs ${
                          ev.delta > 0 ? 'text-emerald-800' : 'text-red-800'
                        }`}
                      >
                        {ev.delta > 0 ? '+' : ''}
                        {ev.delta}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        <footer className="print-sheet-footer print-inv-footer">
          <div className="print-inv-signatures">
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Выдал (кладовщик)</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">{session.keeperName}</span>
            </div>
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Принял (МОЛ)</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">{responsible ?? 'ФИО / подпись'}</span>
            </div>
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Бухгалтерия</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">подпись</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
