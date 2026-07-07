import { useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { financeEntriesFor, type StatementRow } from '@/lib/finance/calc'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  row: StatementRow
  responsible?: string
  onClose: () => void
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-stone-200 py-1.5 text-[13px]">
      <span className={strong ? 'font-semibold text-ink' : 'text-stone-600'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-bold' : ''} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function PayslipModal({ store, month, row, responsible, onClose }: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  const entries = financeEntriesFor(store, row.employeeId, month)
  const nameLines = employeeNameLines(row.emp)
  const grossAccrued = row.accrued + row.bonus + row.brigadierBonus
  const monthTitle = formatMonthTitle(month, locale)

  async function downloadPdf() {
    if (!printRef.current) return
    setBusy(true)
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const tab = row.emp.tabNumber || row.employeeId.slice(0, 6)
      await exportPrintAreaToPdf(printRef.current, `payslip-${tab}-${month}.pdf`, {
        pageSelector: '.payslip-page',
        orientation: 'portrait',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('fin.payslip.title')}
      subtitle={`${nameLines.primary} · ${monthTitle}`}
      size="preview"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void downloadPdf()}>
            {busy ? 'PDF…' : t('fin.payslip.download')}
          </Button>
        </div>
      }
    >
      <div className="bg-stone-100 p-4">
        <div ref={printRef}>
          <article
            className="payslip-page mx-auto max-w-[760px] bg-white p-8 shadow-sm"
            style={{ color: '#1c1917' }}
          >
            <header className="mb-5 flex items-start justify-between border-b border-stone-300 pb-4">
              <div>
                <div className="text-lg font-extrabold tracking-tight">FiberCell</div>
                <div className="text-sm text-stone-500">{t('fin.payslip.title')}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{monthTitle}</div>
                <div className="text-xs text-stone-500">{store.settings.site}</div>
              </div>
            </header>

            <section className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              <Info label={t('employees.colName')} value={nameLines.primary} />
              <Info label={t('employees.colTab')} value={row.emp.tabNumber || '—'} />
              <Info label={t('hr.position')} value={row.emp.position || '—'} />
              <Info label={t('employees.colSchedule')} value={row.schedule} />
              <Info label={t('pay.colRate')} value={row.rateLabel} />
              <Info label={t('stats.factH')} value={`${row.factHours} ч`} />
              {row.emp.terminationDate && (
                <Info label={t('hr.fireDate')} value={row.emp.terminationDate} />
              )}
            </section>

            <h3 className="mb-1 text-sm font-bold text-emerald-800">{t('fin.payslip.accruals')}</h3>
            <div className="mb-5">
              <Line label={t('fin.payslip.base')} value={formatGel(row.breakdown.base)} />
              <Line label={t('fin.payslip.night')} value={formatGel(row.breakdown.night)} />
              <Line label={t('fin.payslip.overtime')} value={formatGel(row.breakdown.overtime)} />
              <Line label={t('fin.payslip.vacation')} value={formatGel(row.breakdown.vacation)} />
              <Line label={t('fin.payslip.sick')} value={formatGel(row.breakdown.sick)} />
              {entries.bonuses.map((b) => (
                <Line
                  key={b.id}
                  label={`${t('fin.ledger.kind.bonus')}: ${b.reason}`}
                  value={`+${formatGel(b.amount)}`}
                  tone="text-emerald-700"
                />
              ))}
              {row.brigadierBonus > 0 && (
                <Line
                  label={t('fin.col.brigadierBonus')}
                  value={`+${formatGel(row.brigadierBonus)}`}
                  tone="text-teal-700"
                />
              )}
              <Line label={t('fin.payslip.totalAccrued')} value={formatGel(grossAccrued)} strong />
            </div>

            <h3 className="mb-1 text-sm font-bold text-red-800">{t('fin.payslip.deductions')}</h3>
            <div className="mb-5">
              {entries.penalties.length === 0 && row.advance === 0 ? (
                <Line label={t('fin.payslip.none')} value="—" />
              ) : (
                <>
                  {entries.penalties.map((p) => (
                    <Line
                      key={p.id}
                      label={`${t('fin.ledger.kind.penalty')}: ${p.reason}`}
                      value={`−${formatGel(p.amount)}`}
                      tone="text-red-700"
                    />
                  ))}
                  {entries.advances.map((a) => (
                    <Line
                      key={a.id}
                      label={`${t('fin.ledger.kind.advance')} · ${a.date}`}
                      value={`−${formatGel(a.amount)}`}
                      tone="text-amber-700"
                    />
                  ))}
                </>
              )}
            </div>

            <div className="mb-5 rounded-sm border border-stone-300 bg-stone-50 p-3">
              <Line label={t('fin.col.net')} value={formatGel(row.net)} strong />
              <Line label={t('fin.col.paid')} value={formatGel(row.paid)} tone="text-sky-700" />
              <div className="mt-1 flex items-center justify-between pt-1 text-base">
                <span className="font-bold">{t('fin.col.remaining')}</span>
                <span className="font-mono text-lg font-extrabold">{formatGel(row.remaining)}</span>
              </div>
            </div>

            {entries.payouts.length > 0 && (
              <div className="mb-5 text-[12px] text-stone-500">
                <div className="mb-1 font-semibold text-stone-600">{t('fin.payslip.payouts')}</div>
                {entries.payouts.map((p) => (
                  <div key={p.id} className="flex justify-between border-b border-dashed border-stone-200 py-1">
                    <span>
                      {p.date} · {t(`fin.method.${p.method}`)}
                      {p.byName ? ` · ${p.byName}` : ''}
                    </span>
                    <span className="font-mono">{formatGel(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <footer className="mt-10 flex items-end justify-between text-[12px] text-stone-500">
              <div>
                <div className="mb-6">{t('fin.payslip.accountant')}: {responsible || '____________'}</div>
                <div className="border-t border-stone-300 pt-1">{t('fin.payslip.signature')}</div>
              </div>
              <div className="text-right">
                <div className="mb-6">{t('fin.payslip.employee')}</div>
                <div className="border-t border-stone-300 pt-1">{t('fin.payslip.signature')}</div>
              </div>
            </footer>
            <div className="mt-4 text-right text-[11px] text-stone-400">
              {new Date().toLocaleDateString('ru-RU')}
            </div>
          </article>
        </div>
      </div>
    </AppDialog>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-stone-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
