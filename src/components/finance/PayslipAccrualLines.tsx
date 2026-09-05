import { useI18n } from '@/context/I18nContext'
import { multiplierToPercent } from '@/lib/finance/payrollAccrualRules'
import type { PayrollHourDetail } from '@/lib/finance/payrollDetail'
import { formatGel, formatHourlyRate, type PayBreakdown } from '@/lib/payroll'

function Line({
  label,
  detail,
  value,
  tone,
  strong,
  compact,
}: {
  label: string
  detail?: string
  value: string
  tone?: string
  strong?: boolean
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 border-b border-dashed border-stone-200 ${
        compact ? 'py-0.5 text-[12px]' : 'py-2 text-sm'
      }`}
    >
      <span className={strong ? 'font-semibold text-ink' : 'text-stone-600'}>
        <span className="block">{label}</span>
        {detail ? (
          <span className="mt-0.5 block font-mono text-[11px] font-normal text-stone-400">
            {detail}
          </span>
        ) : null}
      </span>
      <span className={`shrink-0 font-mono ${strong ? 'font-bold' : ''} ${tone ?? 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

function hoursTimesRate(hours: number, rate: number, hoursShort: string): string {
  return `${hours} ${hoursShort} × ${formatHourlyRate(rate)} ₾`
}

type ExtraLine = { id: string; label: string; value: string }

type Props = {
  breakdown: PayBreakdown
  hourDetail: PayrollHourDetail
  brigadierBonus: number
  autoBonus?: number
  productivityBonus?: number
  otherManualBonus?: number
  extraBonusLines?: ExtraLine[]
  grossAccrued: number
  compact?: boolean
}

export function PayslipAccrualLines({
  breakdown,
  hourDetail,
  brigadierBonus,
  autoBonus = 0,
  productivityBonus = 0,
  otherManualBonus = 0,
  extraBonusLines,
  grossAccrued,
  compact,
}: Props) {
  const { t, tf } = useI18n()
  const h = hourDetail
  const rate = h.hourlyRate
  const hoursShort = t('stats.hoursShort')
  const nightPct = multiplierToPercent(h.nightMultiplier)
  const idlePct = multiplierToPercent(h.idleMultiplier)
  const otDayPct = multiplierToPercent(h.otDayMultiplier)
  const otNightPct = multiplierToPercent(h.otNightMultiplier)
  const hasOtTiers = breakdown.ot110 > 0 || breakdown.ot115 > 0 || breakdown.ot120 > 0
  const b = h.brigadier

  return (
    <>
      <Line
        compact={compact}
        label={t('fin.payslip.base')}
        detail={
          h.baseHours > 0 && rate > 0
            ? hoursTimesRate(h.baseHours, rate, hoursShort)
            : undefined
        }
        value={formatGel(breakdown.base)}
      />
      {breakdown.night > 0 && (
        <Line
          compact={compact}
          label={`${t('fin.payslip.night')} (${nightPct}%)`}
          detail={
            h.nightShiftHours > 0 && rate > 0
              ? hoursTimesRate(h.nightShiftHours, rate * h.nightMultiplier, hoursShort)
              : undefined
          }
          value={formatGel(breakdown.night)}
        />
      )}
      {breakdown.ot110 > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.ot110')}
          detail={
            h.otDayHours > 0 && rate > 0
              ? hoursTimesRate(h.otDayHours, rate * h.otDayMultiplier, hoursShort)
              : `${otDayPct}%`
          }
          value={formatGel(breakdown.ot110)}
          tone="text-amber-800"
        />
      )}
      {breakdown.ot115 > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.ot115')}
          value={formatGel(breakdown.ot115)}
          tone="text-amber-800"
        />
      )}
      {breakdown.ot120 > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.ot120')}
          detail={
            h.otNightHours > 0 && rate > 0
              ? hoursTimesRate(h.otNightHours, rate * h.otNightMultiplier, hoursShort)
              : `${otNightPct}%`
          }
          value={formatGel(breakdown.ot120)}
          tone="text-amber-800"
        />
      )}
      {!hasOtTiers && breakdown.overtime > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.overtime')}
          value={formatGel(breakdown.overtime)}
          tone="text-amber-800"
        />
      )}
      {breakdown.idle > 0 && (
        <Line
          compact={compact}
          label={`${t('fin.payslip.idle')} (${idlePct}%)`}
          detail={
            h.idleHours > 0 && rate > 0
              ? hoursTimesRate(h.idleHours, rate * h.idleMultiplier, hoursShort)
              : undefined
          }
          value={formatGel(breakdown.idle)}
        />
      )}
      {breakdown.vacation > 0 && (
        <Line compact={compact} label={t('fin.payslip.vacation')} value={formatGel(breakdown.vacation)} />
      )}
      {breakdown.sick > 0 && (
        <Line compact={compact} label={t('fin.payslip.sick')} value={formatGel(breakdown.sick)} />
      )}
      {h.nightLineBonus > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.nightLineBonus')}
          detail={tf('fin.payslip.nightLineFormula', {
            n: h.nightLineNights,
            gel: h.nightLineFixedGel,
          })}
          value={`+${formatGel(h.nightLineBonus)}`}
          tone="text-indigo-800"
        />
      )}
      {autoBonus > 0 && (
        <Line
          compact={compact}
          label={t('fin.col.bonus')}
          value={`+${formatGel(autoBonus)}`}
          tone="text-emerald-700"
        />
      )}
      <Line
        compact={compact}
        label={`${t('fin.col.productivityBonus')} (${t('fin.payslip.productivityManual')})`}
        value={productivityBonus > 0 ? `+${formatGel(productivityBonus)}` : '—'}
        tone={productivityBonus > 0 ? 'text-teal-700' : undefined}
      />
      {otherManualBonus > 0 && (
        <Line
          compact={compact}
          label={t('fin.payslip.otherBonus')}
          value={`+${formatGel(otherManualBonus)}`}
          tone="text-emerald-700"
        />
      )}
      {extraBonusLines?.map((line) => (
        <Line
          key={line.id}
          compact={compact}
          label={line.label}
          value={line.value}
          tone="text-emerald-700"
        />
      ))}
      {brigadierBonus > 0 && b && (
        <Line
          compact={compact}
          label={t('fin.col.brigadierBonus')}
          detail={`${b.factBrigHours} ${hoursShort} × ${formatHourlyRate(b.hourlySupplement)} ₾`}
          value={`+${formatGel(brigadierBonus)}`}
          tone="text-teal-700"
        />
      )}
      <Line
        compact={compact}
        label={t('fin.payslip.totalAccrued')}
        value={formatGel(grossAccrued)}
        strong
      />
    </>
  )
}
