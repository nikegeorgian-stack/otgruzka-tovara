import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { t, tf, type Locale } from '@/i18n'
import { chunkOfficeStaffPrintPages } from '@/lib/office/staffListPrint'

type Props = {
  headers: string[]
  rows: string[][]
  site: string
  locale: Locale
  printedAt: string
}

export function OfficeStaffPrintSheet({ headers, rows, site, locale, printedAt }: Props) {
  const pages = chunkOfficeStaffPrintPages(rows)
  const title = t(locale, 'office.printTitle')
  const total = rows.length
  let serial = 0

  return (
    <div className="print-area">
      {pages.map((pageRows, pageIdx) => {
        const start = serial
        serial += pageRows.length
        const compact = pageIdx > 0
        return (
          <section
            key={pageIdx}
            className="print-sheet-page print-page-break-after office-staff-print-page"
          >
            <div className="print-sheet-content">
              <header
                className={
                  compact
                    ? 'print-sheet-header office-staff-print-header office-staff-print-header--compact'
                    : 'print-sheet-header office-staff-print-header'
                }
              >
                {compact ? (
                  <p className="office-staff-print-kicker">
                    {title}
                    {' · '}
                    {tf(locale, 'office.printCount', { n: total })}
                    {` · ${pageIdx + 1}/${pages.length}`}
                  </p>
                ) : (
                  <div>
                    <FiberCellBrand variant="print" />
                    <h1 className="print-title mt-2">{title}</h1>
                    <p className="office-staff-print-meta">
                      {site}
                      {site ? ' · ' : ''}
                      {printedAt}
                      {' · '}
                      {tf(locale, 'office.printCount', { n: total })}
                      {pages.length > 1 ? ` · 1/${pages.length}` : ''}
                    </p>
                  </div>
                )}
              </header>
              <table className="print-table office-staff-print-table">
                <thead>
                  <tr>
                    <th className="print-th office-staff-print-no">№</th>
                    {headers.map((h) => (
                      <th key={h} className="print-th text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, idx) => (
                    <tr key={`${pageIdx}-${idx}`}>
                      <td className="print-td office-staff-print-no">{start + idx + 1}</td>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="print-td">
                          {cell || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
