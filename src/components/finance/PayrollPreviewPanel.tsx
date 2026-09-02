import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { financeEntriesFor, statementRowForEmployee } from '@/lib/finance/calc'
import { adjustmentReasonLabel, isProductivityBonusReason } from '@/lib/finance/adjustmentReasons'
import { filterEmployeesForMonth } from '@/lib/hr/employeeActive'
import { isMonthClosed } from '@/lib/monthManage'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'
import { PayslipHourDetailSection } from './PayslipHourDetailSection'
import { PayslipAccrualLines } from './PayslipAccrualLines'
import { PayslipModal } from './PayslipModal'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  asOfDate?: string
}

function PreviewLine({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: string
  tone?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-stone-200 py-2 text-sm">
      <span className={strong ? 'font-semibold text-ink' : 'text-stone-600'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-bold' : ''} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function PayrollPreviewPanel({ store, month, onMonthChange, asOfDate }: Props) {
  const { t, locale } = useI18n()
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [payslipOpen, setPayslipOpen] = useState(false)

  const employees = useMemo(
    () => filterEmployeesForMonth(store.employees, month),
    [store.employees, month],
  )

  const row = useMemo(
    () => (employeeId ? statementRowForEmployee(store, month, employeeId, asOfDate) : undefined),
    [store, month, employeeId, asOfDate],
  )

  const entries = useMemo(
    () => (row ? financeEntriesFor(store, row.employeeId, month) : null),
    [store, row, month],
  )

  const closed = isMonthClosed(store, month)
  const hasSheet = Boolean(store.months[month])
  const grossAccrued = row ? row.accrued + row.bonus + row.brigadierBonus : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('fin.preview.title')}</h2>
          <p className="text-sm text-stone-500">{t('fin.preview.subtitle')}</p>
        </div>
        <MonthNavigator month={month} onChange={onMonthChange} variant="input" />
      </div>

      <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('fin.preview.pickEmployee')}
        </label>
        <EmployeePicker
          employees={employees}
          value={employeeId}
          month={month}
          asOfDate={asOfDate}
          placeholder={t('fin.preview.pickEmployee')}
          onChange={setEmployeeId}
        />
      </div>

      {!hasSheet && (
        <div className="rounded-sm border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
          {t('month.notFound')}
        </div>
      )}

      {hasSheet && employeeId && !row && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900">
          {t('fin.preview.noRow')}
        </div>
      )}

      {row && (
        <>
          {!closed && (
            <div className="rounded-sm border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <span className="font-semibold">{t('fin.preview.draftBadge')}</span>
              <span className="ml-1">{t('fin.preview.draftHint')}</span>
            </div>
          )}

          {closed && row.frozen && (
            <div className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">{t('fin.frozen')}</span>
              <span className="ml-1">{t('fin.frozenHint')}</span>
            </div>
          )}

          <PayslipHourDetailSection
            hourDetail={row.hourDetail}
            brigadierBonus={row.brigadierBonus}
            className="rounded-sm border border-grid bg-white p-4 shadow-sm"
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-ink">
                {formatMonthTitle(month, locale)} · {row.emp.fullName}
              </h3>
              <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-stone-500">
                <div>
                  {t('employees.colTab')}: <span className="font-mono text-ink">{row.emp.tabNumber || '—'}</span>
                </div>
                <div>
                  {t('employees.colSchedule')}: <span className="text-ink">{row.schedule}</span>
                </div>
                <div>
                  {t('pay.colRate')}: <span className="text-ink">{row.rateLabel}</span>
                </div>
                <div>
                  {t('stats.factH')}: <span className="font-mono text-ink">{row.hourDetail.factHours}</span>
                </div>
                <div>
                  {t('stats.planH')}: <span className="font-mono text-ink">{row.hourDetail.planHours}</span>
                </div>
              </div>

              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                {t('fin.payslip.accruals')}
              </h4>
              <PayslipAccrualLines
                breakdown={row.breakdown}
                hourDetail={row.hourDetail}
                brigadierBonus={row.brigadierBonus}
                autoBonus={row.autoBonus}
                productivityBonus={row.productivityBonus}
                otherManualBonus={row.otherManualBonus}
                grossAccrued={grossAccrued}
              />
            </div>

            <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-red-800">
                {t('fin.payslip.deductions')}
              </h4>
              {row.penalty > 0 ? (
                <PreviewLine
                  label={t('fin.col.penalty')}
                  value={`−${formatGel(row.penalty)}`}
                  tone="text-red-700"
                />
              ) : (
                <PreviewLine label={t('fin.col.penalty')} value="—" />
              )}
              {row.advance > 0 ? (
                <PreviewLine
                  label={t('fin.col.advance')}
                  value={`−${formatGel(row.advance)}`}
                  tone="text-amber-700"
                />
              ) : (
                <PreviewLine label={t('fin.col.advance')} value="—" />
              )}

              <div className="my-3 border-t border-stone-200" />

              <PreviewLine label={t('fin.col.net')} value={formatGel(row.net)} strong />
              <PreviewLine
                label={t('fin.col.paid')}
                value={row.paid > 0 ? formatGel(row.paid) : '—'}
                tone="text-stone-500"
              />
              <PreviewLine
                label={t('fin.col.remaining')}
                value={formatGel(row.remaining)}
                strong
                tone={row.remaining > 0 ? 'text-ink' : 'text-emerald-600'}
              />

              {(row.sickDates.length > 0 || row.vacationDates.length > 0) && (
                <div className="mt-4 space-y-2 text-xs text-stone-500">
                  {row.sickDates.length > 0 && (
                    <p>
                      {t('fin.preview.sickDays')}: {row.sickDates.length}
                      {row.sickConfirmed ? ` · ${t('fin.preview.confirmed')}` : ` · ${t('fin.preview.notConfirmed')}`}
                    </p>
                  )}
                  {row.vacationDates.length > 0 && (
                    <p>
                      {t('fin.preview.vacationDays')}: {row.vacationDates.length}
                      {row.vacationConfirmed
                        ? ` · ${t('fin.preview.confirmed')}`
                        : ` · ${t('fin.preview.notConfirmed')}`}
                    </p>
                  )}
                </div>
              )}

              {entries && (entries.bonuses.length > 0 || entries.penalties.length > 0) && (
                <div className="mt-4 border-t border-stone-200 pt-3">
                  <p className="mb-2 text-xs font-semibold text-stone-500">{t('fin.preview.adjustments')}</p>
                  {entries.bonuses
                    .filter((b) => !isProductivityBonusReason(b.reason))
                    .map((b) => (
                    <PreviewLine
                      key={b.id}
                      label={adjustmentReasonLabel(b.reason, t)}
                      value={`+${formatGel(b.amount)}`}
                      tone="text-emerald-700"
                    />
                  ))}
                  {entries.penalties.map((p) => (
                    <PreviewLine
                      key={p.id}
                      label={p.reason}
                      value={`−${formatGel(p.amount)}`}
                      tone="text-red-700"
                    />
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPayslipOpen(true)}>
                  {t('fin.payslip.open')}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {payslipOpen && row && (
        <PayslipModal
          store={store}
          month={month}
          row={row}
          responsible={store.settings.responsible}
          onClose={() => setPayslipOpen(false)}
        />
      )}
    </div>
  )
}
