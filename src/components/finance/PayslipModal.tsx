import { useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { financeEntriesFor, type StatementRow } from '@/lib/finance/calc'
import { adjustmentReasonLabel, isProductivityBonusReason } from '@/lib/finance/adjustmentReasons'
import { exportPayslipPdf } from '@/lib/export/payslipPdf'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'
import { PayslipHourDetailSection } from './PayslipHourDetailSection'
import { PayslipAccrualLines } from './PayslipAccrualLines'

type Props = {
  store: AppStore
  month: string
  row: StatementRow
  responsible?: string
  onClose: () => void
}

type PayslipVariant = 'full' | 'short'

function Line({
  label,
  value,
  strong,
  tone,
  compact,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: string
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between border-b border-dashed border-stone-200 ${
        compact ? 'py-0.5 text-[12px]' : 'py-1.5 text-[13px]'
      }`}
    >
      <span className={strong ? 'font-semibold text-ink' : 'text-stone-600'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-bold' : ''} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function PayslipModal({ store, month, row, responsible, onClose }: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [variant, setVariant] = useState<PayslipVariant>('full')
  const [pdfError, setPdfError] = useState<string | null>(null)

  const entries = financeEntriesFor(store, row.employeeId, month)
  const nameLines = employeeNameLines(row.emp)
  const grossAccrued = row.accrued + row.bonus + row.brigadierBonus
  const monthTitle = formatMonthTitle(month, locale)
  const tab = row.emp.tabNumber || row.employeeId.slice(0, 6)
  const deltaH = row.hourDetail.factHours - row.hourDetail.planHours

  async function downloadPdf() {
    setBusy(true)
    setPdfError(null)
    try {
      const suffix = variant === 'short' ? 'short' : 'full'
      await exportPayslipPdf(
        {
          row,
          month,
          locale,
          site: store.settings.site,
          responsible,
          entries,
          variant,
          t,
        },
        `payslip-${tab}-${month}-${suffix}.pdf`,
      )
    } catch (e) {
      console.error(e)
      setPdfError(t('fin.payslip.pdfError'))
    } finally {
      setBusy(false)
    }
  }

  function handlePrint() {
    setPdfError(null)
    document.body.classList.add('payslip-print-open')
    requestAnimationFrame(() => {
      window.print()
      window.setTimeout(() => document.body.classList.remove('payslip-print-open'), 300)
    })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('fin.payslip.title')}
      subtitle={`${nameLines.primary} · ${monthTitle}`}
      size="preview"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-sm border border-grid p-0.5">
            <button
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${
                variant === 'full' ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-50'
              }`}
              onClick={() => setVariant('full')}
            >
              {t('fin.payslip.variantFull')}
            </button>
            <button
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${
                variant === 'short' ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-50'
              }`}
              onClick={() => setVariant('short')}
            >
              {t('fin.payslip.variantShort')}
            </button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handlePrint}>
              {t('fin.payslip.print')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void downloadPdf()}>
              {busy ? 'PDF…' : t('fin.payslip.download')}
            </Button>
          </div>
        </div>
      }
    >
      {pdfError && (
        <div className="mx-4 mt-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {pdfError}
        </div>
      )}
      <div className="bg-stone-100 p-4">
        <div ref={printRef} className="payslip-print-root">
          {variant === 'short' ? (
            <article
              className="payslip-page mx-auto max-w-[420px] bg-white px-5 py-4 shadow-sm"
              style={{ color: '#1c1917', background: '#ffffff' }}
            >
              <header className="mb-2 flex items-baseline justify-between border-b border-stone-300 pb-2">
                <div>
                  <div className="text-sm font-extrabold tracking-tight">FiberCell</div>
                  <div className="text-[11px] text-stone-500">{t('fin.payslip.variantShort')}</div>
                </div>
                <div className="text-right text-[12px] font-semibold">{monthTitle}</div>
              </header>

              <div className="mb-2 space-y-0.5 text-[12px]">
                <div className="font-semibold">{nameLines.primary}</div>
                <div className="text-stone-500">
                  {t('employees.colTab')} {row.emp.tabNumber || '—'}
                  {' · '}
                  {row.schedule}
                  {row.emp.position ? ` · ${row.emp.position}` : ''}
                </div>
                <div className="font-mono text-stone-700">
                  {row.hourDetail.planHours}/{row.hourDetail.factHours} ч
                  {deltaH !== 0 ? ` · Δ${deltaH > 0 ? '+' : ''}${deltaH}` : ''}
                  {' · '}
                  {row.rateLabel}
                </div>
              </div>

              <div className="mb-2">
                <PayslipAccrualLines
                  compact
                  breakdown={row.breakdown}
                  hourDetail={row.hourDetail}
                  brigadierBonus={row.brigadierBonus}
                  autoBonus={row.autoBonus}
                  productivityBonus={row.productivityBonus}
                  otherManualBonus={row.otherManualBonus}
                  extraBonusLines={entries.bonuses
                    .filter((b) => !isProductivityBonusReason(b.reason))
                    .map((b) => ({
                      id: b.id,
                      label: adjustmentReasonLabel(b.reason, t),
                      value: `+${formatGel(b.amount)}`,
                    }))}
                  grossAccrued={grossAccrued}
                />
                {row.penalty > 0 && (
                  <Line
                    compact
                    label={t('fin.col.penalty')}
                    value={`−${formatGel(row.penalty)}`}
                    tone="text-red-700"
                  />
                )}
                {row.advance > 0 && (
                  <Line
                    compact
                    label={t('fin.col.advance')}
                    value={`−${formatGel(row.advance)}`}
                    tone="text-amber-700"
                  />
                )}
              </div>

              <div className="rounded-sm border border-stone-300 bg-stone-50 px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{t('fin.col.net')}</span>
                  <span className="font-mono text-base font-extrabold">{formatGel(row.net)}</span>
                </div>
              </div>

              <footer className="mt-4 flex justify-between gap-4 text-[10px] text-stone-500">
                <div className="flex-1">
                  <div className="mb-4">{t('fin.payslip.accountant')}</div>
                  <div className="border-t border-stone-300 pt-0.5">{t('fin.payslip.signature')}</div>
                </div>
                <div className="flex-1 text-right">
                  <div className="mb-4">{t('fin.payslip.employee')}</div>
                  <div className="border-t border-stone-300 pt-0.5">{t('fin.payslip.signature')}</div>
                </div>
              </footer>
            </article>
          ) : (
            <article
              className="payslip-page mx-auto max-w-[760px] bg-white p-8 shadow-sm"
              style={{ color: '#1c1917', background: '#ffffff' }}
            >
              <header className="mb-4 flex items-start justify-between border-b border-stone-300 pb-3">
                <div>
                  <div className="text-lg font-extrabold tracking-tight">FiberCell</div>
                  <div className="text-sm text-stone-500">{t('fin.payslip.title')}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{monthTitle}</div>
                  <div className="text-xs text-stone-500">{store.settings.site}</div>
                </div>
              </header>

              <section className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
                <Info label={t('employees.colName')} value={nameLines.primary} />
                <Info label={t('employees.colTab')} value={row.emp.tabNumber || '—'} />
                <Info label={t('hr.position')} value={row.emp.position || '—'} />
                <Info label={t('employees.colSchedule')} value={row.schedule} />
                <Info label={t('pay.colRate')} value={row.rateLabel} />
                <Info
                  label={t('fin.payslip.planFactHours')}
                  value={`${row.hourDetail.planHours} / ${row.hourDetail.factHours} ч`}
                />
              </section>

              <PayslipHourDetailSection
                hourDetail={row.hourDetail}
                brigadierBonus={row.brigadierBonus}
                className="mb-5"
              />

              <h3 className="mb-1 text-sm font-bold text-emerald-800">{t('fin.payslip.accruals')}</h3>
              <div className="mb-4">
                <PayslipAccrualLines
                  breakdown={row.breakdown}
                  hourDetail={row.hourDetail}
                  brigadierBonus={row.brigadierBonus}
                  autoBonus={row.autoBonus}
                  productivityBonus={row.productivityBonus}
                  extraBonusLines={entries.bonuses
                    .filter((b) => !isProductivityBonusReason(b.reason))
                    .map((b) => ({
                      id: b.id,
                      label: `${t('fin.ledger.kind.bonus')}: ${adjustmentReasonLabel(b.reason, t)}`,
                      value: `+${formatGel(b.amount)}`,
                    }))}
                  grossAccrued={grossAccrued}
                />
              </div>

              <h3 className="mb-1 text-sm font-bold text-red-800">{t('fin.payslip.deductions')}</h3>
              <div className="mb-4">
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

              <div className="mb-4 rounded-sm border border-stone-300 bg-stone-50 p-3">
                <Line label={t('fin.col.net')} value={formatGel(row.net)} strong />
                <Line label={t('fin.col.paid')} value={formatGel(row.paid)} tone="text-sky-700" />
                <div className="mt-1 flex items-center justify-between pt-1 text-base">
                  <span className="font-bold">{t('fin.col.remaining')}</span>
                  <span className="font-mono text-lg font-extrabold">{formatGel(row.remaining)}</span>
                </div>
              </div>

              {entries.payouts.length > 0 && (
                <div className="mb-4 text-[12px] text-stone-500">
                  <div className="mb-1 font-semibold text-stone-600">{t('fin.payslip.payouts')}</div>
                  {entries.payouts.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between border-b border-dashed border-stone-200 py-1"
                    >
                      <span>
                        {p.date} · {t(`fin.method.${p.method}`)}
                        {p.byName ? ` · ${p.byName}` : ''}
                      </span>
                      <span className="font-mono">{formatGel(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <footer className="mt-8 flex items-end justify-between text-[12px] text-stone-500">
                <div>
                  <div className="mb-6">
                    {t('fin.payslip.accountant')}: {responsible || '____________'}
                  </div>
                  <div className="border-t border-stone-300 pt-1">{t('fin.payslip.signature')}</div>
                </div>
                <div className="text-right">
                  <div className="mb-6">{t('fin.payslip.employee')}</div>
                  <div className="border-t border-stone-300 pt-1">{t('fin.payslip.signature')}</div>
                </div>
              </footer>
              <div className="mt-3 text-right text-[11px] text-stone-400">
                {new Date().toLocaleDateString('ru-RU')}
              </div>
            </article>
          )}
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
