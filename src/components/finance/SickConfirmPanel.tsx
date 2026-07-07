import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { HrCameraModal } from '@/components/hr/HrCameraModal'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { monthStatement, sickConfirmationFor } from '@/lib/finance/calc'
import { isMonthClosed } from '@/lib/monthManage'
import type { AppStore } from '@/lib/types'
import type { FinanceActions } from './financeTypes'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  actions: FinanceActions
  asOfDate?: string
}

export function SickConfirmPanel({ store, month, onMonthChange, actions, asOfDate }: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const { confirm } = useConfirm()
  const [camFor, setCamFor] = useState<string | null>(null)

  const rows = useMemo(
    () => monthStatement(store, month, asOfDate).filter((r) => r.sickDates.length > 0),
    [store, month, asOfDate],
  )
  const closed = isMonthClosed(store, month)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('fin.sick.title')}</h2>
          <p className="text-sm text-stone-500">
            {formatMonthTitle(month, locale)} · {t('fin.sick.hint')}
          </p>
        </div>
        <MonthNavigator month={month} onChange={onMonthChange} variant="input" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-sm border border-grid bg-paper-dark/40 px-4 py-8 text-center text-sm text-stone-400">
          {t('fin.sick.none')}
        </div>
      ) : (
        <div className="fc-table-wrap">
          <table className="fc-table min-w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">{t('employees.colName')}</th>
                <th className="px-3 py-2">{t('fin.sick.days')}</th>
                <th className="px-3 py-2">{t('fin.sick.status')}</th>
                <th className="px-3 py-2">{t('fin.sick.bulletin')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const conf = sickConfirmationFor(store, r.employeeId, month)
                return (
                  <tr key={r.rowId} className="border-t border-grid">
                    <td className="px-3 py-2">
                      <BilingualText lines={employeeNameLines(r.emp)} />
                      <div className="text-xs text-stone-400">{r.brigade || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">{r.sickDates.length}</td>
                    <td className="px-3 py-2 text-center">
                      {r.sickConfirmed ? (
                        <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          {t('fin.sick.confirmed')}
                        </span>
                      ) : (
                        <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {t('fin.sick.pending')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {conf?.fileUrl ? (
                        <a
                          href={conf.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-accent underline"
                        >
                          {t('fin.sick.view')}
                        </a>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={closed}
                          className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark disabled:opacity-40"
                          onClick={() => setCamFor(r.employeeId)}
                        >
                          {t('fin.sick.attach')}
                        </button>
                        {r.sickConfirmed ? (
                          <button
                            type="button"
                            disabled={closed}
                            className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark disabled:opacity-40"
                            onClick={async () => {
                              if (
                                await confirm({ message: t('fin.sick.confirmUnconfirm'), danger: true })
                              ) {
                                actions.onUnconfirmSick(r.employeeId, month)
                              }
                            }}
                          >
                            {t('fin.sick.unconfirm')}
                          </button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={closed}
                            onClick={() =>
                              actions.onConfirmSick({ employeeId: r.employeeId, month })
                            }
                          >
                            {t('fin.sick.confirm')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {camFor && (
        <HrCameraModal
          mode="document"
          onClose={() => setCamFor(null)}
          onCapture={(dataUrl, fileName) => {
            actions.onConfirmSick({ employeeId: camFor, month, fileUrl: dataUrl, fileName })
            setCamFor(null)
          }}
        />
      )}
    </div>
  )
}
