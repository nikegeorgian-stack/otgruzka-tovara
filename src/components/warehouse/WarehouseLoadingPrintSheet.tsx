import { Fragment } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import {
  computeLoadingBalance,
  computeLoadingLine,
  computeLoadingTotals,
  formatInt,
  formatKg,
  formatTons,
  type LoadingLine,
} from '@/lib/warehouse/loading'

export type LoadingPrintMeta = {
  customer: string
  orderNo: string
  date: string
  containerName: string
}

type Props = {
  meta: LoadingPrintMeta
  payloadKg: number
  palletPlaces: number
  lines: LoadingLine[]
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

function num(n: number): string {
  return n ? formatInt(n) : '—'
}

function balanceText(left: number, unitRu: string): string {
  if (left > 0) return `Остаток ${formatInt(left)} ${unitRu}`
  if (left < 0) return `Перевес ${formatInt(-left)} ${unitRu}`
  return 'Ровно'
}

export function WarehouseLoadingPrintSheet({ meta, payloadKg, palletPlaces, lines }: Props) {
  const rows = lines.filter((l) => l.name.trim() || l.rolls > 0 || l.weightPerRollKg > 0)
  const totals = computeLoadingTotals(rows)
  const balance = computeLoadingBalance(totals, payloadKg, palletPlaces)

  return (
    <div className="print-sheet-page warehouse-loading-page wl-page">
      <div className="print-sheet-content">
        <div className="wl-header">
          <FiberCellBrand variant="print" className="wl-brand" />
          <div className="wl-title-box">
            <p className="wl-title">
              Погрузка готовой продукции <span className="wl-ka">მზა პროდუქციის დატვირთვა</span>
            </p>
            <p className="wl-subtitle">{meta.containerName}</p>
          </div>
        </div>

        <div className="wl-meta">
          <div className="wl-meta-item">
            <span className="wl-meta-label">Заказчик · დამკვეთი</span>
            <span className="wl-meta-value">{meta.customer || '—'}</span>
          </div>
          <div className="wl-meta-item">
            <span className="wl-meta-label">№ заказа / машины</span>
            <span className="wl-meta-value">{meta.orderNo || '—'}</span>
          </div>
          <div className="wl-meta-item">
            <span className="wl-meta-label">Дата · თარიღი</span>
            <span className="wl-meta-value">{fmtDate(meta.date)}</span>
          </div>
          <div className="wl-meta-item">
            <span className="wl-meta-label">Лимит · ლიმიტი</span>
            <span className="wl-meta-value">
              {formatTons(payloadKg)} т / {formatInt(palletPlaces)} мест
            </span>
          </div>
        </div>

        <table className="wl-table">
          <thead>
            <tr>
              <th className="wl-c-num">№</th>
              <th className="wl-c-name">
                Наименование <span className="wl-ka">დასახელება</span>
              </th>
              <th className="wl-c-note">Комплектация</th>
              <th className="wl-c-n">
                Вес рул., кг
              </th>
              <th className="wl-c-n">Рул.</th>
              <th className="wl-c-n">м²</th>
              <th className="wl-c-n">Кор.</th>
              <th className="wl-c-n">Подд.</th>
              <th className="wl-c-n">Палет-мест</th>
              <th className="wl-c-n">Нетто, т</th>
              <th className="wl-c-n">Брутто, т</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const r = computeLoadingLine(l)
              return (
                <tr key={l.id}>
                  <td className="wl-num">{i + 1}</td>
                  <td>{l.name}</td>
                  <td className="wl-note">{l.note}</td>
                  <td className="wl-num">{l.weightPerRollKg ? formatKg(l.weightPerRollKg) : '—'}</td>
                  <td className="wl-num">{num(l.rolls)}</td>
                  <td className="wl-num">{r.areaM2 ? formatInt(r.areaM2) : '—'}</td>
                  <td className="wl-num">{num(l.boxes)}</td>
                  <td className="wl-num">{num(r.pallets)}</td>
                  <td className="wl-num">{num(r.palletPlaces)}</td>
                  <td className="wl-num">{formatTons(r.netKg)}</td>
                  <td className="wl-num">{formatTons(r.grossKg)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td className="wl-empty" colSpan={11}>
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="wl-summary">
          {(
            [
              ['Всего рулонов', formatInt(totals.rolls)],
              ['Всего площадь', `${formatInt(totals.areaM2)} м²`],
              ['Коробки / пакеты', formatInt(totals.boxes)],
              ['Поддоны', formatInt(totals.pallets)],
              ['Палет-места', `${formatInt(totals.palletPlaces)} / ${formatInt(palletPlaces)}`],
              ['Вес нетто', `${formatKg(totals.netKg)} кг / ${formatTons(totals.netKg)} т`],
              ['Вес брутто', `${formatKg(totals.grossKg)} кг / ${formatTons(totals.grossKg)} т`],
              ['Остаток / перевес по весу', balanceText(balance.weightLeftKg, 'кг')],
              ['Остаток / перевес по палет-местам', balanceText(balance.placesLeft, 'мест')],
              ['Загрузка по весу', `${balance.weightLoadPct.toFixed(1).replace('.', ',')}%`],
            ] as [string, string][]
          ).map(([k, v], i) => (
            <Fragment key={k}>
              <div className={`wl-sum-row ${i % 2 ? 'wl-sum-row--alt' : ''}`}>
                <span className="wl-sum-k">{k}</span>
                <span
                  className={`wl-sum-v ${
                    (k.includes('весу') && balance.weightOver) ||
                    (k.includes('палет-местам') && balance.placesOver)
                      ? 'wl-sum-v--over'
                      : ''
                  }`}
                >
                  {v}
                </span>
              </div>
            </Fragment>
          ))}
        </div>

        <div className="wl-signs">
          <div className="wl-sign">
            <span className="wl-sign-line" />
            <span className="wl-sign-label">Погрузку проверил · დატვირთვა შეამოწმა</span>
          </div>
          <div className="wl-sign">
            <span className="wl-sign-line" />
            <span className="wl-sign-label">Водитель · მძღოლი</span>
          </div>
        </div>
      </div>
    </div>
  )
}
