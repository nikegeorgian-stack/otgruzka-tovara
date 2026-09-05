import { useMemo, useState } from 'react'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { linkedEmployee } from '@/lib/access/userEmployee'
import type { AppUser } from '@/lib/access/types'
import {
  buildEmployeeMoneyExplain,
  type MoneyTimelineEvent,
} from '@/lib/employeeCabinet/moneyExplain'
import { buildEmployeePayDetail } from '@/lib/employeeCabinet/payDetail'
import { EmployeeTimesheetCalendar } from '@/components/my/EmployeeTimesheetCalendar'
import { MyPayDetailPanel } from '@/components/my/MyPayDetailPanel'
import {
  buildEmployeeCabinetSnapshot,
  type AbsenceGateStatus,
} from '@/lib/employeeCabinet/snapshot'
import { monthKey } from '@/lib/dates'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  currentUser: AppUser | null
}

function gateLabel(status: AbsenceGateStatus, t: (k: string) => string): string {
  if (status === 'confirmed') return t('my.gate.confirmed')
  if (status === 'pending') return t('my.gate.pending')
  return t('my.gate.none')
}

function money(n: number, locale: Locale): string {
  return `${Math.round(n).toLocaleString(intlLocale(locale))} ₾`
}

function formatEventDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  if (!y || !m || !d) return isoDate
  return `${d}.${m}`
}

function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return parts[1] ?? parts[0]!
  return parts[0] || full
}

function statusToneClass(tone: 'ok' | 'wait' | 'warn' | 'info'): string {
  if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  if (tone === 'wait') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (tone === 'warn') return 'border-red-200 bg-red-50 text-red-950'
  return 'border-sky-200 bg-sky-50 text-sky-950'
}

function eventDot(kind: MoneyTimelineEvent['kind'], status: MoneyTimelineEvent['status']): string {
  if (status === 'pending') return 'bg-amber-400'
  if (status === 'info') return 'bg-stone-300'
  if (kind === 'penalty') return 'bg-red-500'
  if (kind === 'payout' || kind === 'advance_paid') return 'bg-emerald-500'
  if (kind === 'bonus') return 'bg-sky-500'
  return 'bg-[#ff5500]'
}

export function MyCabinetPage({ store, currentUser }: Props) {
  const { t, tf, locale } = useI18n()
  const now = new Date()
  const [month, setMonth] = useState(() => monthKey(now.getFullYear(), now.getMonth() + 1))

  const employee = useMemo(
    () => linkedEmployee(currentUser, store.employees),
    [currentUser, store.employees],
  )

  const snap = useMemo(
    () => (employee ? buildEmployeeCabinetSnapshot(store, employee, month) : null),
    [store, employee, month],
  )

  const moneyExplain = useMemo(
    () => (employee ? buildEmployeeMoneyExplain(store, employee.id, month) : null),
    [store, employee, month],
  )

  const payDetail = useMemo(
    () => (employee ? buildEmployeePayDetail(store, employee.id, month) : null),
    [store, employee, month],
  )

  if (!currentUser?.employeeId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <FiberCellBrand variant="page" className="mb-6" />
        <h1 className="text-2xl font-bold text-ink">{t('my.title')}</h1>
        <p className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {t('my.noLink')}
        </p>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <FiberCellBrand variant="page" className="mb-6" />
        <h1 className="text-2xl font-bold text-ink">{t('my.title')}</h1>
        <p className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {t('my.inactiveEmployee')}
        </p>
      </div>
    )
  }

  const greetingName = firstName(employee.fullName)
  const accrued = moneyExplain?.accrued ?? snap?.estimatedPay ?? 0
  const paid = moneyExplain?.salaryPaid ?? 0
  const advancePaid = moneyExplain?.advancePaid ?? 0
  const remaining = moneyExplain?.remaining ?? Math.max(0, accrued - paid - advancePaid)
  const planH = snap?.monthPlanHours ?? snap?.planHours ?? 0
  const planToDateH = snap?.planHours ?? 0
  const factH = snap?.factHours ?? 0
  const fillPct = planH > 0 ? Math.min(100, Math.round((factH / planH) * 100)) : 0
  const planDelta = snap?.planDeltaHours ?? 0
  const asOfLabel = snap?.asOfDate
    ? snap.asOfDate.slice(8)
    : null

  return (
    <div
      className="my-portal min-h-full bg-[linear-gradient(180deg,#faf8f4_0%,#f5f0e8_45%,#faf8f4_100%)]"
      data-coach="my:panel"
    >
      <div className="mx-auto max-w-lg px-4 pb-10 pt-6 sm:pt-8">
        <header className="mb-6">
          <FiberCellBrand variant="page" className="mb-5" />
          <p className="text-sm text-stone-500">{t('my.hello')}</p>
          <h1 className="mt-0.5 text-3xl font-bold tracking-tight text-ink">{greetingName}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {employee.position || employee.brigade || t('my.subtitle')}
            {employee.tabNumber ? ` · № ${employee.tabNumber}` : ''}
          </p>
        </header>

        <div className="mb-5">
          <MonthNavigator month={month} onChange={setMonth} variant="both" />
        </div>

        {!snap?.inMonth ? (
          <p className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 text-sm text-stone-600 shadow-sm">
            {t('my.notInMonth')}
          </p>
        ) : (
          <>
            <section className="mb-4 overflow-hidden rounded-3xl bg-[#1c1917] px-5 py-6 text-white shadow-lg shadow-stone-900/10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300/90">
                {t('my.hero.toReceive')}
              </p>
              <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
                {money(remaining, locale)}
              </p>
              <p className="mt-2 text-sm text-stone-300">{t('my.hero.toReceiveHint')}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm">
                <div>
                  <p className="text-stone-400">{t('my.hero.accrued')}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {money(accrued, locale)}
                  </p>
                </div>
                <div>
                  <p className="text-stone-400">{t('my.hero.received')}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {money(paid + advancePaid, locale)}
                  </p>
                </div>
              </div>
            </section>

            {moneyExplain ? (
              <section
                className={`mb-4 rounded-2xl border px-4 py-3 text-sm shadow-sm ${statusToneClass(moneyExplain.status.tone)}`}
              >
                <p className="font-semibold leading-snug">
                  {moneyExplain.status.vars
                    ? tf(moneyExplain.status.key, moneyExplain.status.vars)
                    : t(moneyExplain.status.key)}
                </p>
              </section>
            ) : null}

            <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
                <p className="text-xs font-medium text-stone-500">
                  {t('my.kpi.factHours')}
                  {asOfLabel ? (
                    <span className="font-normal text-stone-400">
                      {' '}
                      · {tf('my.asOfDay', { day: asOfLabel })}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{factH}</p>
                <p className="mt-1 text-[11px] text-stone-400">
                  {tf('my.hoursOfPlan', { plan: String(planH), pct: String(fillPct) })}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-[#ff5500] transition-[width]"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
                <p className="text-xs font-medium text-stone-500">{t('my.kpi.hoursShort')}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                  {snap?.hoursShort ?? 0}
                </p>
                {(snap?.hoursShort ?? 0) > 0 ? (
                  <p className="mt-1 text-[11px] text-stone-500">
                    {snap?.vacationStatus === 'pending' || snap?.sickStatus === 'pending'
                      ? t('my.tipAbsencePending')
                      : t('my.tipExtraShift')}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-emerald-700">{t('my.tipPlanOk')}</p>
                )}
              </div>
              <div className="col-span-2 rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm sm:col-span-1">
                <p className="text-xs font-medium text-stone-500">{t('my.kpi.planDelta')}</p>
                <p
                  className={`mt-1 text-2xl font-bold tabular-nums ${
                    planDelta < 0
                      ? 'text-amber-800'
                      : planDelta > 0
                        ? 'text-emerald-700'
                        : 'text-ink'
                  }`}
                >
                  {planDelta > 0 ? '+' : ''}
                  {planDelta}
                </p>
                <p className="mt-1 text-[11px] text-stone-500">
                  {tf('my.planDeltaHint', {
                    plan: String(planToDateH),
                    fact: String(factH),
                  })}
                </p>
              </div>
            </section>

            {(snap?.brigadierDaysCount ?? 0) > 0 ? (
              <section className="mb-4 rounded-2xl border border-teal-200/80 bg-teal-50/70 px-4 py-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                  {t('my.kpi.brigadier')}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-teal-700/80">{t('my.kpi.brigadierDays')}</p>
                    <p className="text-xl font-bold tabular-nums text-teal-950">
                      {snap!.brigadierDaysCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-teal-700/80">{t('my.kpi.brigadierHours')}</p>
                    <p className="text-xl font-bold tabular-nums text-teal-950">
                      {snap!.brigadierHours}
                    </p>
                  </div>
                </div>
                {(moneyExplain?.brigadierBonus ?? 0) > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-teal-900">
                    {t('my.money.brigadier')}: +{money(moneyExplain!.brigadierBonus, locale)}
                  </p>
                ) : null}
              </section>
            ) : null}

            {payDetail ? (
              <div className="mb-4">
                <MyPayDetailPanel detail={payDetail} locale={locale} />
              </div>
            ) : null}

            {moneyExplain ? (
              <section className="mb-4 rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
                <p className="text-sm font-semibold text-ink">{t('my.money.breakdown')}</p>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-stone-500">{t('my.hero.accrued')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {money(moneyExplain.accrued, locale)}
                    </dd>
                  </div>
                  {moneyExplain.bonus > 0 ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-stone-500">{t('my.money.bonus')}</dt>
                      <dd className="font-semibold tabular-nums text-emerald-700">
                        +{money(moneyExplain.bonus, locale)}
                      </dd>
                    </div>
                  ) : null}
                  {moneyExplain.brigadierBonus > 0 ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-stone-500">{t('my.money.brigadier')}</dt>
                      <dd className="font-semibold tabular-nums text-emerald-700">
                        +{money(moneyExplain.brigadierBonus, locale)}
                      </dd>
                    </div>
                  ) : null}
                  {moneyExplain.penalty > 0 ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-stone-500">{t('my.money.penalty')}</dt>
                      <dd className="font-semibold tabular-nums text-red-700">
                        −{money(moneyExplain.penalty, locale)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-stone-500">{t('my.advance.paid')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {money(moneyExplain.advancePaid, locale)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-stone-500">{t('my.money.salaryPaid')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {money(moneyExplain.salaryPaid, locale)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-2.5">
                    <dt className="font-medium text-stone-700">{t('my.money.net')}</dt>
                    <dd className="font-bold tabular-nums text-[#ff5500]">
                      {money(moneyExplain.remaining, locale)}
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {moneyExplain && moneyExplain.reasons.length > 0 ? (
              <section className="mb-4 rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
                <p className="text-sm font-semibold text-ink">{t('my.money.why')}</p>
                <ul className="mt-3 space-y-2 text-sm text-stone-600">
                  {moneyExplain.reasons.map((r) => (
                    <li key={r.key} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                      <span>{r.vars ? tf(r.key, r.vars) : t(r.key)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {moneyExplain ? (
              <section className="mb-4 rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
                <p className="text-sm font-semibold text-ink">{t('my.money.timeline')}</p>
                {moneyExplain.timeline.length === 0 ? (
                  <p className="mt-3 text-sm text-stone-500">{t('my.money.timelineEmpty')}</p>
                ) : (
                  <ul className="mt-3 divide-y divide-stone-100">
                    {moneyExplain.timeline.map((ev) => {
                      const title = ev.titleVars
                        ? tf(ev.titleKey, ev.titleVars)
                        : t(ev.titleKey)
                      const signed =
                        ev.kind === 'penalty'
                          ? `−${money(ev.amount, locale)}`
                          : money(ev.amount, locale)
                      return (
                        <li
                          key={ev.id}
                          className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventDot(ev.kind, ev.status)}`}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-xs tabular-nums text-stone-400">
                                {formatEventDate(ev.date)}
                              </span>
                              <span className="text-sm font-medium text-ink">{title}</span>
                              {ev.status === 'pending' ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                  {t('my.money.pendingBadge')}
                                </span>
                              ) : null}
                              {ev.status === 'info' ? (
                                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                                  {t('my.money.estimateBadge')}
                                </span>
                              ) : null}
                            </div>
                            {ev.note ? (
                              <p className="mt-0.5 text-xs text-stone-500">{ev.note}</p>
                            ) : null}
                          </div>
                          <span
                            className={`shrink-0 text-sm font-semibold tabular-nums ${
                              ev.kind === 'penalty'
                                ? 'text-red-700'
                                : ev.status === 'pending'
                                  ? 'text-amber-800'
                                  : 'text-ink'
                            }`}
                          >
                            {signed}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-3 shadow-sm">
                <p className="text-xs text-stone-500">{t('my.sick')}</p>
                <p
                  className={`mt-1 text-sm font-semibold ${
                    snap?.sickStatus === 'confirmed'
                      ? 'text-emerald-700'
                      : snap?.sickStatus === 'pending'
                        ? 'text-amber-700'
                        : 'text-stone-600'
                  }`}
                >
                  {gateLabel(snap?.sickStatus ?? 'none', t)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-3 shadow-sm">
                <p className="text-xs text-stone-500">{t('my.vacation')}</p>
                <p
                  className={`mt-1 text-sm font-semibold ${
                    snap?.vacationStatus === 'confirmed'
                      ? 'text-emerald-700'
                      : snap?.vacationStatus === 'pending'
                        ? 'text-amber-700'
                        : 'text-stone-600'
                  }`}
                >
                  {gateLabel(snap?.vacationStatus ?? 'none', t)}
                </p>
              </div>
            </section>

            <p className="mb-4 rounded-2xl border border-sky-200/80 bg-sky-50 px-4 py-3 text-sm text-sky-950">
              {[
                (snap?.workDaysCount ?? 0) > 0
                  ? tf('my.cal.summaryWork', { n: String(snap!.workDaysCount) })
                  : null,
                (snap?.overtimeHours ?? 0) > 0
                  ? tf('my.cal.summaryOt', { n: String(snap!.overtimeHours) })
                  : null,
                (snap?.brigadierDaysCount ?? 0) > 0
                  ? tf('my.cal.summaryBrig', {
                      days: String(snap!.brigadierDaysCount),
                      hours: String(snap!.brigadierHours),
                    })
                  : null,
                (snap?.missedPlanDays ?? 0) > 0
                  ? tf('my.alertMissed', { n: String(snap!.missedPlanDays) })
                  : null,
                (snap?.idleDays ?? 0) > 0
                  ? tf('my.alertIdle', { n: String(snap!.idleDays) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || t('my.cal.summaryEmpty')}
            </p>

            <div className="mb-4">
              <EmployeeTimesheetCalendar month={month} days={snap?.days ?? []} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
