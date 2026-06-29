import { Fragment } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import type { InventoryPrintPayload } from '@/lib/warehouse/inventoryPrint'
import { formatInventoryQty } from '@/lib/warehouse/inventoryPrint'

type Props = {
  payload: InventoryPrintPayload
  title: string
  date: string
  site?: string
  responsible?: string
  comment?: string
  showBookBalance: boolean
  groupByCategory: boolean
}

export function WarehouseInventoryPrintSheet({
  payload,
  title,
  date,
  site,
  responsible,
  comment,
  showBookBalance,
  groupByCategory,
}: Props) {
  const dateRu = new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  let rowNum = 0

  function renderRow(row: (typeof payload.flatRows)[0]) {
    rowNum += 1
    return (
      <tr key={row.item.id}>
        <td className="print-inv-num">{rowNum}</td>
        <td className="print-inv-code">{row.item.internalCode}</td>
        <td className="print-inv-name">{row.item.name}</td>
        <td className="print-inv-unit">{row.item.unit}</td>
        {showBookBalance && (
          <td className="print-inv-qty">{formatInventoryQty(row.bookBalance)}</td>
        )}
        <td className="print-inv-fact" />
        <td className="print-inv-sign" />
      </tr>
    )
  }

  return (
    <div className="print-sheet-page print-inventory-page">
      <div className="print-sheet-content">
        <header className="print-sheet-header">
          <div className="print-fc-header-row">
            <FiberCellBrand variant="print" />
            <div className="print-fc-header-text">
              <p className="print-org">{site ?? 'FiberCell'}</p>
              <h1 className="print-title">{title}</h1>
              <p className="print-meta">
                Дата: <strong>{dateRu}</strong>
                {payload.warehouseNames.length > 0 && (
                  <>
                    {' · '}
                    Склад: <strong>{payload.warehouseNames.join(', ')}</strong>
                  </>
                )}
              </p>
              {payload.categoryNames.length > 0 && payload.categoryNames.length <= 6 && (
                <p className="print-meta">
                  Отделы: <strong>{payload.categoryNames.join(' · ')}</strong>
                </p>
              )}
              {payload.categoryNames.length > 6 && (
                <p className="print-meta">
                  Отделов: <strong>{payload.categoryNames.length}</strong> (
                  {payload.categoryNames.slice(0, 4).join(', ')}…)
                </p>
              )}
              {comment && <p className="print-meta">Примечание: {comment}</p>}
              <p className="print-meta">
                Позиций в ведомости: <strong>{payload.totalItems}</strong>
              </p>
            </div>
          </div>
        </header>

        <table className="print-table print-inv-table">
          <thead>
            <tr>
              <th className="print-inv-num">№</th>
              <th className="print-inv-code">Код</th>
              <th className="print-inv-name">Наименование</th>
              <th className="print-inv-unit">Ед.</th>
              {showBookBalance && <th className="print-inv-qty">По учёту</th>}
              <th className="print-inv-fact">Факт</th>
              <th className="print-inv-sign">Подпись</th>
            </tr>
          </thead>
          <tbody>
            {groupByCategory
              ? payload.sections.map((section) => (
                  <Fragment key={section.categoryId}>
                    <tr className="print-inv-section-row">
                      <td
                        colSpan={showBookBalance ? 7 : 6}
                        className="print-inv-section-title"
                      >
                        {section.categoryName}
                        <span className="print-inv-section-count">
                          ({section.rows.length})
                        </span>
                      </td>
                    </tr>
                    {section.rows.map((row) => renderRow(row))}
                  </Fragment>
                ))
              : payload.flatRows.map((row) => renderRow(row))}
          </tbody>
        </table>

        <footer className="print-sheet-footer print-inv-footer">
          <div className="print-inv-signatures">
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Материально ответственное лицо</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">{responsible ?? 'ФИО / подпись'}</span>
            </div>
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Председатель комиссии</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">ФИО / подпись</span>
            </div>
            <div className="print-inv-sig-block">
              <span className="print-inv-sig-label">Член комиссии</span>
              <span className="print-inv-sig-line" />
              <span className="print-inv-sig-hint">ФИО / подпись</span>
            </div>
          </div>
          <p className="print-inv-note">
            Фактическое наличие проверено, расхождения отмечены в графе «Факт».
          </p>
        </footer>
      </div>
    </div>
  )
}
