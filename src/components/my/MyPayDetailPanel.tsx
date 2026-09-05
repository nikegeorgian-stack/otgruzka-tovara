import { PayslipHourDetailSection } from '@/components/finance/PayslipHourDetailSection'
import { PayslipAccrualLines } from '@/components/finance/PayslipAccrualLines'
import { useI18n } from '@/context/I18nContext'
import type { Locale } from '@/i18n/types'
import type { EmployeePayDetail } from '@/lib/employeeCabinet/payDetail'

type Props = {
  detail: EmployeePayDetail
  locale: Locale
}

export function MyPayDetailPanel({ detail }: Props) {
  const { t } = useI18n()
  const b = detail.breakdown

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
        <p className="text-sm font-semibold text-ink">{t('my.detail.metaTitle')}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">{t('my.detail.schedule')}</dt>
            <dd className="font-medium text-ink">{detail.schedule || '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">{t('my.detail.rate')}</dt>
            <dd className="font-medium tabular-nums text-ink">{detail.rateLabel || '—'}</dd>
          </div>
          {detail.staffRate !== 1 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">{t('hr.pay.staffRate')}</dt>
              <dd className="font-medium tabular-nums text-ink">
                {detail.staffRate} · {Math.round(detail.staffRate * 100)}%
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
        <PayslipHourDetailSection
          hourDetail={detail.hourDetail}
          brigadierBonus={detail.brigadierBonus}
        />
      </section>

      <section className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
        <p className="text-sm font-semibold text-ink">{t('my.detail.accrualsTitle')}</p>
        <p className="mt-1 text-xs text-stone-500">{t('my.detail.accrualsHint')}</p>
        <div className="mt-3">
          <PayslipAccrualLines
            breakdown={b}
            hourDetail={detail.hourDetail}
            brigadierBonus={detail.brigadierBonus}
            autoBonus={detail.autoBonus}
            productivityBonus={detail.productivityBonus}
            otherManualBonus={detail.otherManualBonus}
            grossAccrued={
              detail.payrollAmount +
              detail.autoBonus +
              detail.productivityBonus +
              detail.otherManualBonus +
              detail.brigadierBonus
            }
          />
        </div>
      </section>
    </div>
  )
}
