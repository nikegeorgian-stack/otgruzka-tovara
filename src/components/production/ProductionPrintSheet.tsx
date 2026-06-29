import { Fragment } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import {
  categoryLabel,
  PACKAGING_SECTIONS,
  PRODUCTION_CATEGORIES,
  PRODUCTION_LINES,
  type PackagingRow,
  type ProductionFactRow,
  type ProductionPlanSegment,
  type ProductionRequest,
} from '@/lib/production/types'
import { formatNum, weekdayLabel } from '@/lib/production/stats'

type Props = {
  request: ProductionRequest
  foremanName?: string
  rosterLines?: { name: string; present: boolean }[]
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function val(n: number | undefined): string {
  return n === undefined || n === 0 ? '' : formatNum(n)
}

/** Дополняет список строк пустыми до минимума (для ручного заполнения). */
function padRows<T>(rows: T[], min: number, makeEmpty: () => T): T[] {
  const out = [...rows]
  while (out.length < min) out.push(makeEmpty())
  return out
}

const emptyPackRow = (): PackagingRow => ({
  id: Math.random().toString(36).slice(2),
  name: '',
  colorLogo: '',
})

function BlankHeader({ request, foremanName, rosterLines }: Props) {
  const line = PRODUCTION_LINES.find((l) => l.id === request.lineId)
  return (
    <div className="pb-header">
      <div className="pb-header-left">
        <FiberCellBrand variant="print" className="pb-brand" />
        <p className="pb-title">
          Заявка на производство <span className="pb-ka">წარმოების მოთხოვნა</span>
        </p>
        <div className="pb-date-row">
          <div className="pb-date-box">
            <span className="pb-label">
              Дата <span className="pb-ka">თარიღი</span>
            </span>
            <span className="pb-date-value">{fmtDate(request.date)}</span>
          </div>
          <div className="pb-weekday">
            <span className="pb-label">
              день недели <span className="pb-ka">კვირის დღე</span>
            </span>
            <span className="pb-line-fill">
              {request.date ? weekdayLabel(request.date, 'ru') : ''}
            </span>
          </div>
          <div className="pb-weekday">
            <span className="pb-label">
              смена <span className="pb-ka">ცვლა</span>
            </span>
            <span className="pb-line-fill">
              {request.shift === 'night' ? 'ночь · ღამე' : 'день · დღე'}
            </span>
          </div>
        </div>
      </div>
      <div className="pb-header-mid">
        <div className="pb-field-line">
          <span className="pb-label">
            Бригадир <span className="pb-ka">ბრიგადირი</span>
          </span>
          <span className="pb-line-fill">{foremanName ?? ''}</span>
        </div>
        <div className="pb-field-line">
          <span className="pb-label">
            Бригада <span className="pb-ka">ბრიგადა</span>
          </span>
          <span className="pb-line-fill">{request.brigadeName}</span>
        </div>
        <div className="pb-field-line">
          <span className="pb-label">
            Явка <span className="pb-ka">დასწრება</span>
          </span>
          <span className="pb-line-fill pb-roster-fill">
            {rosterLines?.length ? (
              <span className="pb-roster-list">
                {rosterLines.map((r, i) => (
                  <span
                    key={`${r.name}-${i}`}
                    className={r.present ? 'pb-roster-in' : 'pb-roster-out'}
                  >
                    {r.name}
                    <span className="pb-roster-mark">{r.present ? ' ✓' : ' ✗'}</span>
                    {i < rosterLines.length - 1 ? '; ' : ''}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div className="pb-header-right">
        <p className="pb-line-title">{line?.labelRu ?? ''}</p>
        <p className="pb-line-title-ka">{line?.labelKa ?? ''}</p>
        {request.lineId === 'pack' ? (
          <>
            <div className="pb-field-line">
              <span className="pb-label">Термоплёнка:</span>
              <span className="pb-line-fill">{request.packaging?.thermoFilm ?? ''}</span>
            </div>
            <div className="pb-field-line">
              <span className="pb-label">Стрейч:</span>
              <span className="pb-line-fill">{request.packaging?.stretch ?? ''}</span>
            </div>
          </>
        ) : (
          <>
            <p className="pb-raw-title">Суровье:</p>
            <div className="pb-field-line">
              <span className="pb-label">к-во рулонов суровья:</span>
              <span className="pb-line-fill">{val(request.rawRollQty)}</span>
            </div>
            <div className="pb-field-line">
              <span className="pb-label">№ рулона суровья:</span>
              <span className="pb-line-fill">{request.rawRollNumbers}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Секция с вертикальной подписью слева, как на бумажном бланке. */
function SectionWithSide({
  side,
  children,
}: {
  side: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="pb-section">
      <div className="pb-section-side">{side}</div>
      <div className="pb-section-body">{children}</div>
    </div>
  )
}

function RatlBlank({ request, foremanName, rosterLines }: Props) {
  const FACT_MIN_ROWS = 13
  const factRows = padRows(
    request.factRows.filter(
      (r) =>
        r.palletRollQty !== undefined ||
        r.rowNote ||
        PRODUCTION_CATEGORIES.some(
          (c) =>
            r[c.key].qtyMp !== undefined ||
            r[c.key].qtyKg !== undefined ||
            r[c.key].note,
        ),
    ),
    FACT_MIN_ROWS,
    (): ProductionFactRow => ({
      id: Math.random().toString(36).slice(2),
      ratl1: {},
      ratl2: {},
      cat4: {},
      cat31: {},
      cat32: {},
      defect: {},
    }),
  )

  const planRows = padRows(
    request.planSegments.filter((s) => s.customer || s.productName),
    2,
    (): ProductionPlanSegment => ({
      id: Math.random().toString(36).slice(2),
      customer: '',
      productName: '',
      colorLogo: '',
    }),
  )

  return (
    <div className="print-sheet-page pb-page">
      <div className="print-sheet-content">
        <BlankHeader request={request} foremanName={foremanName} rosterLines={rosterLines} />

        <SectionWithSide
          side={
            <>
              План
              <span className="pb-ka-block">გეგმა</span>
            </>
          }
        >
          <table className="pb-table">
            <thead>
              <tr>
                <th>
                  заказчик <span className="pb-ka">დამკვეთი</span>
                </th>
                <th>
                  наименование продукции{' '}
                  <span className="pb-ka">პროდუქციის დასახელება</span>
                </th>
                <th className="pb-col-color">
                  цвет лого <span className="pb-ka">(Logo)</span>
                </th>
                <th className="pb-col-narrow">
                  кол-во п.м <span className="pb-ka">რაოდ.</span>
                </th>
                <th>
                  примечание <span className="pb-ka">შენიშვნა</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((seg, i) => (
                <tr key={seg.id ?? i}>
                  <td>{seg.customer}</td>
                  <td>{seg.productName}</td>
                  <td>{seg.colorLogo}</td>
                  <td className="pb-num">{val(seg.plannedQtyMp)}</td>
                  <td>{seg.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionWithSide>

        <table className="pb-table pb-fact-table">
          <thead>
            <tr>
              <th rowSpan={2} className="pb-col-narrow">
                к-во рул.
                <span className="pb-ka-block">რულ. რაოდ.</span>
              </th>
              {PRODUCTION_CATEGORIES.map((cat) => (
                <th key={cat.key} colSpan={cat.key === 'defect' ? 3 : 2}>
                  {categoryLabel(cat.key, request.lineId, 'ru')}{' '}
                  <span className="pb-ka">{cat.labelKa}</span>
                </th>
              ))}
            </tr>
            <tr>
              {PRODUCTION_CATEGORIES.map((cat) =>
                cat.key === 'defect' ? (
                  <Fragment key={cat.key}>
                    <th className="pb-sub-th">к-во п.м</th>
                    <th className="pb-sub-th">кг</th>
                    <th className="pb-sub-th">примечание</th>
                  </Fragment>
                ) : (
                  <Fragment key={cat.key}>
                    <th className="pb-sub-th">к-во п.м</th>
                    <th className="pb-sub-th pb-sub-th--note">примечание</th>
                  </Fragment>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {factRows.map((row) => (
              <tr key={row.id}>
                <td className="pb-num">{val(row.palletRollQty)}</td>
                {PRODUCTION_CATEGORIES.map((cat) =>
                  cat.key === 'defect' ? (
                    <Fragment key={cat.key}>
                      <td className="pb-num">{val(row.defect.qtyMp)}</td>
                      <td className="pb-num">{val(row.defect.qtyKg)}</td>
                      <td>{row.defect.note ?? ''}</td>
                    </Fragment>
                  ) : (
                    <Fragment key={cat.key}>
                      <td className="pb-num">{val(row[cat.key].qtyMp)}</td>
                      <td>{row[cat.key].note ?? ''}</td>
                    </Fragment>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pb-footer-line">
          <span className="pb-label">
            Причины выбраковки <span className="pb-ka">წუნის მიზეზები</span>:
          </span>
          <span className="pb-line-fill">{request.defectReasons}</span>
        </div>
      </div>
    </div>
  )
}

function PackSectionTable({
  title,
  titleKa,
  rows,
  minRows,
  wide,
}: {
  title: string
  titleKa: string
  rows: PackagingRow[]
  minRows: number
  wide?: boolean
}) {
  const padded = padRows(
    rows.filter(
      (r) =>
        r.name || r.colorLogo || r.planQty !== undefined || r.factQty !== undefined,
    ),
    minRows,
    emptyPackRow,
  )
  return (
    <SectionWithSide
      side={
        <>
          <span className="pb-section-plan">
            План
            <span className="pb-ka-block">გეგმა</span>
          </span>
          <span className="pb-section-name">
            {title}
            <span className="pb-ka-block">{titleKa}</span>
          </span>
        </>
      }
    >
      <table className="pb-table">
        <thead>
          <tr>
            <th>
              наименование продукции <span className="pb-ka">დასახელება</span>
            </th>
            <th className="pb-col-color">
              цвет лого <span className="pb-ka">(Logo)</span>
            </th>
            <th className="pb-col-narrow">
              план кол-во <span className="pb-ka">რაოდ.</span>
            </th>
            <th className={wide ? 'pb-col-fact-wide' : 'pb-col-fact'}>
              Выработка <span className="pb-ka">გამომუშავება</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {padded.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.colorLogo}</td>
              <td className="pb-num">{val(row.planQty)}</td>
              <td className="pb-num">{val(row.factQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionWithSide>
  )
}

function PackagingBlank({ request, foremanName, rosterLines }: Props) {
  const p = request.packaging
  const [rolls, boxes, pallets] = PACKAGING_SECTIONS
  return (
    <div className="print-sheet-page pb-page">
      <div className="print-sheet-content">
        <BlankHeader request={request} foremanName={foremanName} rosterLines={rosterLines} />

        <PackSectionTable
          title={rolls.labelRu}
          titleKa={rolls.labelKa}
          rows={p?.rolls ?? []}
          minRows={10}
          wide
        />

        <div className="pb-pack-bottom">
          <PackSectionTable
            title={boxes.labelRu}
            titleKa={boxes.labelKa}
            rows={p?.boxes ?? []}
            minRows={6}
          />
          <PackSectionTable
            title={pallets.labelRu}
            titleKa={pallets.labelKa}
            rows={p?.pallets ?? []}
            minRows={6}
          />
        </div>
      </div>
    </div>
  )
}

export function ProductionPrintSheet({ request, foremanName, rosterLines }: Props) {
  if (request.lineId === 'pack') {
    return <PackagingBlank request={request} foremanName={foremanName} rosterLines={rosterLines} />
  }
  return <RatlBlank request={request} foremanName={foremanName} rosterLines={rosterLines} />
}
