import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { HrCameraModal } from '@/components/hr/HrCameraModal'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import {
  monthStatement,
  sickConfirmationFor,
  vacationConfirmationFor,
} from '@/lib/finance/calc'
import type { AppStore } from '@/lib/types'
import type { FinanceActions } from './financeTypes'

export type AbsenceConfirmKind = 'sick' | 'vacation'

type Props = {
  kind: AbsenceConfirmKind
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  actions: FinanceActions
  asOfDate?: string
}

export function AbsenceConfirmPanel({
  kind,
  store,
  month,
  onMonthChange,
  actions,
  asOfDate,
}: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const { confirm } = useConfirm()
  const [camFor, setCamFor] = useState<string | null>(null)
  const prefix = kind === 'sick' ? 'fin.sick' : 'fin.vacation'

  const rows = useMemo(
    () =>
      monthStatement(store, month, asOfDate).filter((r) =>
        kind === 'sick' ? r.sickDates.length > 0 : r.vacationDates.length > 0,
      ),
    [store, month, asOfDate, kind],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t(`${prefix}.title`)}</h2>
          <p className="text-sm text-stone-500">
            {formatMonthTitle(month, locale)} · {t(`${prefix}.hint`)}
          </p>
        </div>
        <MonthNavigator month={month} onChange={onMonthChange} variant="input" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-sm border border-grid bg-paper-dark/40 px-4 py-8 text-center text-sm text-stone-400">
          {t(`${prefix}.none`)}
        </div>
      ) : (
        <div className="fc-table-wrap">
          <table className="fc-table min-w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">{t('employees.colName')}</th>
                <th className="px-3 py-2">{t(`${prefix}.days`)}</th>
                <th className="px-3 py-2">{t(`${prefix}.status`)}</th>
                <th className="px-3 py-2">{t(kind === 'sick' ? `${prefix}.bulletin` : `${prefix}.document`)}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dates = kind === 'sick' ? r.sickDates : r.vacationDates
                const confirmed = kind === 'sick' ? r.sickConfirmed : r.vacationConfirmed
                const conf =
                  kind === 'sick'
                    ? sickConfirmationFor(store, r.employeeId, month)
                    : vacationConfirmationFor(store, r.employeeId, month)
                return (
                  <tr key={r.rowId} className="border-t border-grid">
                    <td className="px-3 py-2">
                      <BilingualText lines={employeeNameLines(r.emp)} />
                      <div className="text-xs text-stone-400">{r.brigade || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">{dates.length}</td>
                    <td className="px-3 py-2 text-center">
                      {confirmed ? (
                        <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          {t(`${prefix}.confirmed`)}
                        </span>
                      ) : (
                        <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {t(`${prefix}.pending`)}
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
                          {t(`${prefix}.view`)}
                        </a>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark"
                          onClick={() => setCamFor(r.employeeId)}
                        >
                          {t(`${prefix}.attach`)}
                        </button>
                        {confirmed ? (
                          <button
                            type="button"
                            className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark"
                            onClick={async () => {
                              if (await confirm({ message: t(`${prefix}.confirmUnconfirm`), danger: true })) {
                                if (kind === 'sick') {
                                  actions.onUnconfirmSick(r.employeeId, month)
                                } else {
                                  actions.onUnconfirmVacation(r.employeeId, month)
                                }
                              }
                            }}
                          >
                            {t(`${prefix}.unconfirm`)}
                          </button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              if (kind === 'sick') {
                                actions.onConfirmSick({ employeeId: r.employeeId, month })
                              } else {
                                actions.onConfirmVacation({ employeeId: r.employeeId, month })
                              }
                            }}
                          >
                            {t(`${prefix}.confirm`)}
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
            if (kind === 'sick') {
              actions.onConfirmSick({ employeeId: camFor, month, fileUrl: dataUrl, fileName })
            } else {
              actions.onConfirmVacation({ employeeId: camFor, month, fileUrl: dataUrl, fileName })
            }
            setCamFor(null)
          }}
        />
      )}
    </div>
  )
}
