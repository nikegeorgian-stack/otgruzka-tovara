import { useMemo, useState } from 'react'
import { collatorLocale } from '@/i18n/localeFormat'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { runExport } from '@/lib/export'
import {
  brigadierBonusAmount,
  monthStatement,
  statementTotals,
  type StatementRow,
} from '@/lib/finance/calc'
import {
  collectUnconfirmedAbsences,
  hasUnconfirmedAbsences,
} from '@/lib/finance/unconfirmedAbsences'
import { collectUnsignedBrigades } from '@/lib/brigadeSignoff'
import { isMonthClosed, monthClosureInfo } from '@/lib/monthManage'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'
import { FinanceOpDialog, type FinanceOpKind, type FinanceOpResult } from './FinanceOpDialog'
import { PayslipModal } from './PayslipModal'
import { PrintPayrollStatementModal } from './PrintPayrollStatementModal'
import { PrintBankTransferModal } from './PrintBankTransferModal'
import type { FinanceActions } from './financeTypes'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  actions: FinanceActions
  asOfDate?: string
}

export function PayrollStatementPanel({ store, month, onMonthChange, actions, asOfDate }: Props) {
  const { t, tf, locale, employeeNameLines } = useI18n()
  const { confirm } = useConfirm()
  const [op, setOp] = useState<{ kind: FinanceOpKind; row: StatementRow } | null>(null)
  const [payslip, setPayslip] = useState<StatementRow | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [bankPrintOpen, setBankPrintOpen] = useState(false)

  const rows = useMemo(() => {
    const list = monthStatement(store, month, asOfDate)
    return list.sort((a, b) =>
      employeeNameLines(a.emp).primary.localeCompare(
        employeeNameLines(b.emp).primary,
        collatorLocale(locale),
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, month, locale, asOfDate])

  const bankRows = useMemo(
    () => rows.filter((r) => r.remaining > 0.005),
    [rows],
  )

  const totals = useMemo(() => statementTotals(rows), [rows])
  const closed = isMonthClosed(store, month)
  const closure = monthClosureInfo(store, month)
  const unconfirmed = useMemo(
    () => collectUnconfirmedAbsences(store, month, asOfDate),
    [store, month, asOfDate],
  )
  const unconfirmedOpen = hasUnconfirmedAbsences(unconfirmed)
  const unsignedBrigades = useMemo(
    () => collectUnsignedBrigades(store, month),
    [store, month],
  )

  async function warnIfUnconfirmed(): Promise<boolean> {
    if (!unconfirmedOpen && unsignedBrigades.length === 0) return true
    const parts: string[] = []
    if (unconfirmedOpen) {
      parts.push(
        tf('fin.unconfirmed.warn', {
          sick: unconfirmed.sickCount,
          vacation: unconfirmed.vacationCount,
        }),
      )
    }
    if (unsignedBrigades.length > 0) {
      parts.push(tf('fin.unconfirmed.brigades', { count: unsignedBrigades.length }))
    }
    return confirm({
      title: t('fin.unconfirmed.title'),
      message: parts.join('\n\n'),
      confirmLabel: t('fin.unconfirmed.continue'),
    })
  }

  function handleSubmit(result: FinanceOpResult) {
    if (!op) return
    const { employeeId } = op.row
    if (result.op === 'advance') {
      actions.onGiveAdvance({
        employeeId,
        month,
        date: result.date,
        amount: result.amount,
        method: result.method,
        note: result.note,
      })
    } else if (result.op === 'adjustment') {
      actions.onAddAdjustment({
        employeeId,
        month,
        date: result.date,
        kind: result.kind,
        amount: result.amount,
        reason: result.reason,
      })
    } else {
      actions.onAddPayout({
        employeeId,
        month,
        date: result.date,
        amount: result.amount,
        method: result.method,
        note: result.note,
      })
    }
    setOp(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('fin.statement.title')}</h2>
          <p className="text-sm text-stone-500">
            {formatMonthTitle(month, locale)} · {t('fin.statement.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-stone-500">
            {t('fin.brigadierBonusLabel')}
            <input
              type="number"
              min={0}
              step={50}
              defaultValue={brigadierBonusAmount(store)}
              disabled={closed}
              className="w-20 rounded-sm border border-grid px-2 py-1 text-right text-xs font-mono disabled:opacity-50"
              onBlur={(e) => {
                const v = Number(e.target.value.replace(',', '.'))
                if (Number.isFinite(v) && v >= 0 && v !== brigadierBonusAmount(store)) {
                  actions.onSetBrigadierBonus(v)
                }
              }}
            />
            ₾
          </label>
          <MonthNavigator month={month} onChange={onMonthChange} variant="input" />
          <Button
            variant="secondary"
            size="sm"
            disabled={!rows.length}
            onClick={() => {
              void (async () => {
                if (!(await warnIfUnconfirmed())) return
                setPrintOpen(true)
              })()
            }}
          >
            {t('fin.printStatement')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void (async () => {
                if (!(await warnIfUnconfirmed())) return
                void runExport('payroll_statement', store, { month, locale })
              })()
            }}
          >
            {t('fin.exportStatement')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!bankRows.length}
            onClick={() => {
              void (async () => {
                if (!(await warnIfUnconfirmed())) return
                setBankPrintOpen(true)
              })()
            }}
          >
            {t('fin.printBankTransfer')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!bankRows.length}
            onClick={() => {
              void (async () => {
                if (!(await warnIfUnconfirmed())) return
                void runExport('payroll_bank_transfer', store, { month, locale })
              })()
            }}
          >
            {t('fin.exportBankTransfer')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!rows.length}
            title={t('fin.salary1c.hint')}
            data-coach="finance:export1c"
            onClick={() => {
              void (async () => {
                if (!(await warnIfUnconfirmed())) return
                void runExport('salary_calculation_1c', store, { month, locale }).catch((err) => {
                  console.error(err)
                  window.alert(t('fin.salary1c.empty'))
                })
              })()
            }}
          >
            {t('fin.salary1c.export')}
          </Button>
        </div>
      </div>

      {(unconfirmedOpen || unsignedBrigades.length > 0) && (
        <div className="rounded-sm border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          <p className="font-semibold">{t('fin.unconfirmed.title')}</p>
          {unconfirmedOpen ? (
            <p className="mt-1">
              {tf('fin.unconfirmed.banner', {
                sick: unconfirmed.sickCount,
                vacation: unconfirmed.vacationCount,
              })}
            </p>
          ) : null}
          {unsignedBrigades.length > 0 ? (
            <p className="mt-1">
              {tf('fin.unconfirmed.brigades', { count: unsignedBrigades.length })}
              {': '}
              {unsignedBrigades.slice(0, 8).join(', ')}
              {unsignedBrigades.length > 8 ? ` +${unsignedBrigades.length - 8}` : ''}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-rose-800">{t('fin.unconfirmed.hint')}</p>
          {unconfirmed.items.length > 0 ? (
            <ul className="mt-2 max-h-28 list-inside list-disc overflow-auto text-xs text-rose-900">
              {unconfirmed.items.slice(0, 12).map((it) => (
                <li key={it.employeeId}>
                  {it.employeeName}
                  {it.brigade ? ` · ${it.brigade}` : ''}
                  {it.sickDays > 0 ? ` · Б ${it.sickDays}` : ''}
                  {it.vacationDays > 0 ? ` · ОТ ${it.vacationDays}` : ''}
                </li>
              ))}
              {unconfirmed.items.length > 12 ? (
                <li>… +{unconfirmed.items.length - 12}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}

      {closed && (
        <div className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">{t('fin.frozen')}</span>
          {closure?.byName ? ` · ${closure.byName}` : ''}
          {closure?.at ? ` · ${new Date(closure.at).toLocaleDateString('ru-RU')}` : ''}
          <span className="ml-1 text-amber-700">{t('fin.frozenHint')}</span>
        </div>
      )}

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">{t('employees.colName')}</th>
              <th className="px-3 py-2">{t('employees.colSchedule')}</th>
              <th className="px-3 py-2 text-right">{t('stats.factH')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.accrued')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.bonus')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.brigadierBonus')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.penalty')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.advance')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.net')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.paid')}</th>
              <th className="px-3 py-2 text-right">{t('fin.col.remaining')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowId} className="border-t border-grid align-middle">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    <BilingualText lines={employeeNameLines(r.emp)} />
                  </div>
                  <div className="text-xs text-stone-400">{r.brigade || '—'}</div>
                </td>
                <td className="px-3 py-2 text-center text-xs">{r.schedule}</td>
                <td className="px-3 py-2 text-right font-mono">{r.factHours}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatGel(r.accrued)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">
                  {r.bonus ? `+${formatGel(r.bonus)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-teal-700">
                  {r.brigadierBonus ? `+${formatGel(r.brigadierBonus)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-red-700">
                  {r.penalty ? `−${formatGel(r.penalty)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-amber-700">
                  {r.advance ? `−${formatGel(r.advance)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold">{formatGel(r.net)}</td>
                <td className="px-3 py-2 text-right font-mono text-stone-500">
                  {r.paid ? formatGel(r.paid) : '—'}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold ${r.remaining > 0 ? 'text-ink' : 'text-emerald-600'}`}
                >
                  {formatGel(r.remaining)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      title={t('fin.payslip.open')}
                      className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark"
                      onClick={() => setPayslip(r)}
                    >
                      {t('fin.payslip.short')}
                    </button>
                    <button
                      type="button"
                      disabled={closed}
                      title={t('fin.act.advance')}
                      className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark disabled:opacity-40"
                      onClick={() => setOp({ kind: 'advance', row: r })}
                    >
                      {t('fin.act.advance')}
                    </button>
                    <button
                      type="button"
                      disabled={closed}
                      title={t('fin.act.adjust')}
                      className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark disabled:opacity-40"
                      onClick={() => setOp({ kind: 'adjustment', row: r })}
                    >
                      ±
                    </button>
                    <button
                      type="button"
                      disabled={r.remaining <= 0}
                      title={t('fin.act.payout')}
                      className="rounded-sm border border-accent/40 bg-accent-soft/30 px-2 py-1 text-xs font-medium hover:bg-accent-soft/60 disabled:opacity-40"
                      onClick={() => setOp({ kind: 'payout', row: r })}
                    >
                      {t('fin.act.payout')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-stone-400">
                  {t('month.notFound')}
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 border-accent/30 bg-accent-soft/20 font-bold">
                <td className="px-3 py-3" colSpan={3}>
                  {t('fin.total')}
                </td>
                <td className="px-3 py-3 text-right font-mono">{formatGel(totals.accrued)}</td>
                <td className="px-3 py-3 text-right font-mono text-emerald-700">
                  {formatGel(totals.bonus)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-teal-700">
                  {formatGel(totals.brigadierBonus)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-red-700">
                  {formatGel(totals.penalty)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-amber-700">
                  {formatGel(totals.advance)}
                </td>
                <td className="px-3 py-3 text-right font-mono">{formatGel(totals.net)}</td>
                <td className="px-3 py-3 text-right font-mono text-stone-500">
                  {formatGel(totals.paid)}
                </td>
                <td className="px-3 py-3 text-right font-mono">{formatGel(totals.remaining)}</td>
                <td className="px-3 py-3" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-stone-500">{t('pay.formula')}</p>

      {op && (
        <FinanceOpDialog
          kind={op.kind}
          employeeName={employeeNameLines(op.row.emp).primary}
          accrued={op.row.accrued}
          remaining={op.row.remaining}
          onClose={() => setOp(null)}
          onSubmit={handleSubmit}
        />
      )}

      {payslip && (
        <PayslipModal
          store={store}
          month={month}
          row={payslip}
          responsible={store.settings.responsible}
          onClose={() => setPayslip(null)}
        />
      )}

      {printOpen && (
        <PrintPayrollStatementModal
          store={store}
          month={month}
          rows={rows}
          printLocale={locale}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {bankPrintOpen && (
        <PrintBankTransferModal
          store={store}
          month={month}
          rows={bankRows}
          printLocale={locale}
          onClose={() => setBankPrintOpen(false)}
        />
      )}
    </div>
  )
}
