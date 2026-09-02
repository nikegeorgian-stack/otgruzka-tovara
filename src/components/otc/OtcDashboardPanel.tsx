import { useMemo } from 'react'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/context/I18nContext'
import { alkaliOverdue, localTodayYmd } from '@/lib/otc/calc'
import { passStatusLabel } from '@/lib/otc/labels'
import type { OtcStore } from '@/lib/otc/types'
import { OtcStatusBadge } from './OtcStatusBadge'

type Props = { store: OtcStore }

export function OtcDashboardPanel({ store }: Props) {
  const { t, locale } = useI18n()
  const today = localTodayYmd()

  const stats = useMemo(() => {
    const soaking = store.alkaliSeries.filter((s) => s.phase === 'soaking')
    const overdue = soaking.filter((s) => alkaliOverdue(s, today))
    const testsFail = store.labTests.filter((x) => x.computed.status === 'fail').length
    const testsPass = store.labTests.filter((x) => x.computed.status === 'pass').length
    const openDefects = store.defects.filter((d) => d.status !== 'closed').length
    const sortQty = store.sorting.reduce(
      (a, r) => ({
        cat1: a.cat1 + r.qtyCat1,
        cat2: a.cat2 + r.qtyCat2,
        cat3: a.cat3 + r.qtyCat3,
        scrap: a.scrap + r.qtyScrap,
      }),
      { cat1: 0, cat2: 0, cat3: 0, scrap: 0 },
    )
    return { soaking: soaking.length, overdue, testsFail, testsPass, openDefects, sortQty }
  }, [store, today])

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-800">{t('otc.chain.title')}</h3>
        <ol className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-5">
          <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-900">1.</span> {t('otc.chain.1')}
          </li>
          <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-900">2.</span> {t('otc.chain.2')}
          </li>
          <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-900">3.</span> {t('otc.chain.3')}
          </li>
          <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-900">4.</span> {t('otc.chain.4')}
          </li>
          <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-900">5.</span> {t('otc.chain.5')}
          </li>
        </ol>
        <p className="text-xs text-slate-500">{t('otc.chain.hint')}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t('otc.dash.alkali')}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.soaking}</div>
          <div className="mt-1 text-xs text-slate-600">
            {t('otc.dash.overdue')}:{' '}
            <span className={stats.overdue.length ? 'font-semibold text-red-700' : ''}>
              {stats.overdue.length}
            </span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t('otc.dash.tests')}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-emerald-700 tabular-nums">{stats.testsPass}</span>
            <span className="text-slate-400">/</span>
            <span className="text-2xl font-semibold text-red-700 tabular-nums">{stats.testsFail}</span>
          </div>
          <div className="mt-1 text-xs text-slate-600">{t('otc.dash.passFail')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t('otc.dash.sorting')}</div>
          <div className="mt-2 space-y-0.5 text-sm tabular-nums">
            <div>1: {stats.sortQty.cat1}</div>
            <div>2: {stats.sortQty.cat2}</div>
            <div>3: {stats.sortQty.cat3}</div>
            <div className="text-red-700">
              {t('otc.sorting.scrap')}: {stats.sortQty.scrap}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t('otc.dash.defects')}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.openDefects}</div>
          <div className="mt-1 text-xs text-slate-600">{t('otc.dash.openDefects')}</div>
        </Card>
      </div>

      {stats.overdue.length > 0 && (
        <Card className="space-y-2 border-red-200 p-4">
          <h3 className="text-sm font-semibold text-red-800">{t('otc.dash.overdueList')}</h3>
          <ul className="divide-y divide-red-100 text-sm">
            {stats.overdue.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {s.productName}
                  {s.batchNo ? ` · ${s.batchNo}` : ''}
                  {s.sampleLabel ? ` · ${s.sampleLabel}` : ''}
                </span>
                <span className="text-red-700">
                  {t('otc.alkali.due')}: {s.dueDate}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t('otc.dash.recentTests')}</h3>
        {store.labTests.length === 0 ? (
          <p className="text-sm text-slate-500">{t('otc.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {[...store.labTests]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 8)
              .map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {row.testedAt} · {row.productName}
                    {row.batchNo ? ` · ${row.batchNo}` : ''}
                  </span>
                  <OtcStatusBadge
                    status={row.computed.status}
                    label={passStatusLabel(row.computed.status, locale)}
                  />
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
