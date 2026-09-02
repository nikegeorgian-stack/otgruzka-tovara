import { useI18n } from '@/context/I18nContext'
import { multiplierToPercent } from '@/lib/finance/payrollAccrualRules'
import type { PayrollHourDetail } from '@/lib/finance/payrollDetail'
import { formatGel, formatHourlyRate } from '@/lib/payroll'

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-stone-200 py-1.5 text-[13px]">
      <span className={strong ? 'font-semibold text-ink' : 'text-stone-600'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-bold' : ''} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}

type Props = {
  hourDetail: PayrollHourDetail
  brigadierBonus: number
  className?: string
}

export function PayslipHourDetailSection({ hourDetail, brigadierBonus, className }: Props) {
  const { t } = useI18n()
  const b = hourDetail.brigadier

  return (
    <div className={className}>
      <h3 className="mb-1 text-sm font-bold text-stone-800">{t('fin.payslip.hoursDetail')}</h3>
      <div className="mb-4 rounded-sm border border-stone-200 bg-stone-50/80 p-3">
        <Line
          label={t('fin.payslip.planFactHours')}
          value={`${hourDetail.planHours} / ${hourDetail.factHours} ${t('stats.hoursShort')}`}
          tone={
            hourDetail.factHours !== hourDetail.planHours ? 'text-amber-800' : undefined
          }
        />
        {hourDetail.factHours !== hourDetail.planHours && (
          <Line
            label={t('fin.payslip.hoursDelta')}
            value={`${hourDetail.factHours - hourDetail.planHours > 0 ? '+' : ''}${hourDetail.factHours - hourDetail.planHours} ${t('stats.hoursShort')}`}
            tone="text-amber-800"
          />
        )}
        <Line
          label={t('fin.payslip.baseHours')}
          value={
            hourDetail.hourlyRate > 0
              ? `${hourDetail.baseHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate)} ₾/${t('stats.hoursShort')}`
              : `${hourDetail.baseHours} ${t('stats.hoursShort')}`
          }
        />
        {hourDetail.nightShiftHours > 0 && (
          <Line
            label={t('fin.payslip.nightShiftHours')}
            value={`${hourDetail.nightShiftHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate * hourDetail.nightMultiplier)} ₾/${t('stats.hoursShort')} (${multiplierToPercent(hourDetail.nightMultiplier)}%)`}
          />
        )}
        {hourDetail.idleHours > 0 && (
          <Line
            label={t('fin.payslip.idleHours')}
            value={`${hourDetail.idleHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate * hourDetail.idleMultiplier)} ₾/${t('stats.hoursShort')} (${multiplierToPercent(hourDetail.idleMultiplier)}%)`}
          />
        )}
        {hourDetail.monthDeltaOtHours > 0 ? (
          <Line
            label={t('fin.payslip.monthDeltaOt')}
            value={`${hourDetail.monthDeltaOtHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate * hourDetail.otDayMultiplier)} ₾/${t('stats.hoursShort')} (${multiplierToPercent(hourDetail.otDayMultiplier)}%)`}
            tone="text-amber-800"
          />
        ) : hourDetail.overtimeHours > 0 ? (
          <>
            <Line
              label={t('fin.payslip.overtimeHours')}
              value={`${hourDetail.overtimeHours} ${t('stats.hoursShort')}`}
              tone="text-amber-800"
            />
            {hourDetail.otDayHours > 0 && (
              <Line
                label={t('fin.payslip.otDayHours')}
                value={`${hourDetail.otDayHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate * hourDetail.otDayMultiplier)} ₾/${t('stats.hoursShort')} (${multiplierToPercent(hourDetail.otDayMultiplier)}%)`}
              />
            )}
            {hourDetail.otNightHours > 0 && (
              <Line
                label={t('fin.payslip.otNightHours')}
                value={`${hourDetail.otNightHours} ${t('stats.hoursShort')} · ${formatHourlyRate(hourDetail.hourlyRate * hourDetail.otNightMultiplier)} ₾/${t('stats.hoursShort')} (${multiplierToPercent(hourDetail.otNightMultiplier)}%)`}
              />
            )}
          </>
        ) : (
          <Line label={t('fin.payslip.overtimeHours')} value="—" />
        )}
        {hourDetail.nightLineNights > 0 && hourDetail.nightLineBonus > 0 && (
          <Line
            label={t('fin.payslip.nightLineBonus')}
            value={`${hourDetail.nightLineNights} × ${hourDetail.nightLineFixedGel} ₾ = +${formatGel(hourDetail.nightLineBonus)}`}
            tone="text-indigo-800"
          />
        )}
      </div>

      <h3 className="mb-1 text-sm font-bold text-teal-900">{t('fin.payslip.brigadierDetail')}</h3>
      <div className="mb-4 rounded-sm border border-teal-200 bg-teal-50/50 p-3">
        {b && brigadierBonus > 0 ? (
          <>
            <Line
              label={t('fin.payslip.brigadierDays')}
              value={`${b.brigadierDays} ${t('fin.payslip.daysShort')}`}
            />
            <Line
              label={t('fin.payslip.brigadierHours')}
              value={`${b.factBrigHours} ${t('stats.hoursShort')}${b.overtimeBrigHours > 0 ? ` (+${b.overtimeBrigHours} ${t('fin.payslip.otShort')})` : ''}`}
            />
            <Line
              label={t('fin.payslip.brigadierRate')}
              value={`${b.fullMonthlyAmount.toLocaleString('ru-RU')} ₾ / ${hourDetail.planHours} ${t('stats.hoursShort')} = ${formatHourlyRate(b.hourlySupplement)} ₾/${t('stats.hoursShort')}`}
            />
            <Line
              label={t('fin.payslip.brigadierFormula')}
              value={`${b.factBrigHours} × ${b.hourlySupplement.toFixed(2)} ₾`}
            />
            <Line
              label={t('fin.col.brigadierBonus')}
              value={`+${formatGel(brigadierBonus)}`}
              tone="text-teal-800"
              strong
            />
          </>
        ) : b && brigadierBonus === 0 ? (
          <p className="text-xs text-stone-500">{t('fin.payslip.brigadierNoHours')}</p>
        ) : (
          <p className="text-xs text-stone-500">{t('fin.payslip.noBrigadier')}</p>
        )}
      </div>
    </div>
  )
}
