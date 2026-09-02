import { useMemo, useRef, useState } from 'react'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { useI18n } from '@/context/I18nContext'
import { fileToDataUrl } from '@/lib/hr/files'
import {
  computeLeaveBalance,
  estimateUnusedLeavePay,
} from '@/lib/hr/leaveBalance'
import {
  applyLeaveLedgerOperation,
  confirmDismissalSettlement,
  findLeaveArchiveDoc,
} from '@/lib/hr/leaveOps'
import { LEAVE_DAYS_PER_FULL_MONTH, type LeaveLedgerKind } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

type Props = {
  emp: Employee
  asOf?: string
  readOnly?: boolean
  onChange: (next: Employee) => void
}

function kindLabel(kind: LeaveLedgerKind, t: (k: string) => string): string {
  if (kind === 'opening') return t('hr.leave.kindOpening')
  if (kind === 'adjustment') return t('hr.leave.kindAdjustment')
  return t('hr.leave.kindPayout')
}

export function LeaveBalancePanel({ emp, asOf, readOnly, onChange }: Props) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const effectiveAsOf =
    asOf?.trim() ||
    emp.terminationDate?.trim() ||
    new Date().toISOString().slice(0, 10)

  const breakdown = useMemo(
    () => computeLeaveBalance(emp, effectiveAsOf),
    [emp, effectiveAsOf],
  )
  const pay = useMemo(
    () => estimateUnusedLeavePay(emp, breakdown.balance),
    [emp, breakdown.balance],
  )

  const [kind, setKind] = useState<LeaveLedgerKind>('opening')
  const [days, setDays] = useState('')
  const [date, setDate] = useState(effectiveAsOf)
  const [note, setNote] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function onPickFile(file: File | undefined) {
    if (!file) {
      setFileName(null)
      setFileUrl(undefined)
      return
    }
    setBusy(true)
    try {
      const url = await fileToDataUrl(file)
      setFileUrl(url)
      setFileName(file.name)
    } finally {
      setBusy(false)
    }
  }

  function addEntry() {
    const n = Number(days.replace(',', '.'))
    if (!Number.isFinite(n) || n === 0) return
    onChange(
      applyLeaveLedgerOperation(emp, {
        kind,
        days: n,
        date: date || effectiveAsOf,
        note: note || undefined,
        attachment: fileUrl
          ? { fileUrl, fileName: fileName ?? undefined }
          : undefined,
      }),
    )
    setDays('')
    setNote('')
    setFileName(null)
    setFileUrl(undefined)
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeEntry(id: string) {
    // Архив документов не трогаем — нужен для отчётов.
    onChange({
      ...emp,
      leaveLedger: (emp.leaveLedger ?? []).filter((e) => e.id !== id),
    })
  }

  const balClass =
    breakdown.balance < 0
      ? 'text-red-700'
      : breakdown.balance > 0
        ? 'text-emerald-800'
        : 'text-stone-700'

  return (
    <div className="space-y-3 rounded-sm border border-sky-200 bg-sky-50/60 p-3">
      <div>
        <p className="text-xs font-semibold text-sky-900">{t('hr.leave.title')}</p>
        <p className="mt-0.5 text-[11px] text-sky-800">
          {t('hr.leave.rule').replace('{n}', String(LEAVE_DAYS_PER_FULL_MONTH))}
        </p>
        <p className="mt-0.5 text-[11px] text-sky-700">{t('hr.leave.archiveHint')}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-sm border border-sky-100 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-stone-500">
            {t('hr.leave.balance')}
          </p>
          <p className={`text-xl font-semibold tabular-nums ${balClass}`}>
            {breakdown.balance.toLocaleString('ru-RU', {
              maximumFractionDigits: 1,
            })}
          </p>
          <p className="text-[10px] text-stone-400">
            {t('hr.leave.asOf')} {breakdown.asOf}
          </p>
        </div>
        <div className="rounded-sm border border-sky-100 bg-white px-3 py-2 text-[11px] text-stone-600">
          <p>
            {t('hr.leave.opening')}:{' '}
            <span className="font-medium tabular-nums">{breakdown.opening}</span>
          </p>
          <p>
            {t('hr.leave.accrued')}:{' '}
            <span className="font-medium tabular-nums">+{breakdown.accrued}</span>{' '}
            <span className="text-stone-400">
              ({breakdown.accruedMonths} {t('hr.leave.months')})
            </span>
          </p>
          <p>
            {t('hr.leave.adjustments')}:{' '}
            <span className="font-medium tabular-nums">
              {breakdown.adjustments >= 0 ? '+' : ''}
              {breakdown.adjustments}
            </span>
          </p>
        </div>
        <div className="rounded-sm border border-sky-100 bg-white px-3 py-2 text-[11px] text-stone-600">
          <p>
            {t('hr.leave.used')}:{' '}
            <span className="font-medium tabular-nums">−{breakdown.used}</span>
          </p>
          <p>
            {t('hr.leave.paidOut')}:{' '}
            <span className="font-medium tabular-nums">−{breakdown.paidOut}</span>
          </p>
          {pay.dailyRate > 0 && breakdown.balance > 0 ? (
            <p className="mt-1 text-sky-900">
              {t('hr.leave.compHint')
                .replace('{days}', String(pay.days))
                .replace('{amount}', pay.amount.toLocaleString('ru-RU'))}
            </p>
          ) : null}
        </div>
      </div>

      {!readOnly ? (
        <div className="grid gap-2 rounded-sm border border-dashed border-sky-200 bg-white/80 p-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-[11px] font-medium text-stone-600">
            {t('hr.leave.addManual')}
          </p>
          <select
            className="rounded-sm border border-grid px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as LeaveLedgerKind)}
          >
            <option value="opening">{t('hr.leave.kindOpening')}</option>
            <option value="adjustment">{t('hr.leave.kindAdjustment')}</option>
            <option value="payout">{t('hr.leave.kindPayout')}</option>
          </select>
          <input
            type="number"
            step="0.5"
            className="rounded-sm border border-grid px-2 py-1.5 text-sm"
            placeholder={t('hr.leave.days')}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <input
            type="date"
            className="rounded-sm border border-grid px-2 py-1.5 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="rounded-sm border border-grid px-2 py-1.5 text-sm"
            placeholder={t('hr.leave.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="sm:col-span-2 text-[11px] text-stone-600">
            {t('hr.leave.attach')}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="mt-1 block w-full text-xs"
              disabled={busy}
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
            {fileName ? (
              <span className="mt-0.5 block text-sky-800">{fileName}</span>
            ) : (
              <span className="mt-0.5 block text-stone-400">
                {t('hr.leave.attachOptional')}
              </span>
            )}
          </label>
          <button
            type="button"
            className="btn-add-sm sm:col-span-2"
            disabled={!days || Number(days) === 0 || busy}
            onClick={addEntry}
          >
            {t('hr.leave.add')}
          </button>
          {kind === 'opening' ? (
            <p className="sm:col-span-2 text-[10px] text-stone-500">
              {t('hr.leave.openingHint')}
            </p>
          ) : null}
        </div>
      ) : null}

      {(emp.leaveLedger ?? []).length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
          {(emp.leaveLedger ?? [])
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
            .map((e) => {
              const doc = findLeaveArchiveDoc(emp, e.documentId)
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-sky-100 bg-white px-2 py-1.5"
                >
                  <span>
                    <span className="font-medium">{kindLabel(e.kind, t)}</span>
                    {' · '}
                    <span className="tabular-nums">
                      {e.days > 0 ? '+' : ''}
                      {e.days}
                    </span>
                    {' · '}
                    <span className="text-stone-500">{e.date}</span>
                    {e.balanceAfter != null ? (
                      <span className="text-stone-400">
                        {' '}
                        · {t('hr.leave.balanceAfter')} {e.balanceAfter}
                      </span>
                    ) : null}
                    {e.note ? (
                      <span className="text-stone-400"> · {e.note}</span>
                    ) : null}
                    {doc ? (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <span className="text-[10px] text-sky-700">
                          {t('hr.leave.inArchive')}
                        </span>
                        {doc.fileUrl ? (
                          <HrDocumentOpenButton doc={doc} compact />
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {!readOnly ? (
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() => removeEntry(e.id)}
                    >
                      {t('common.delete')}
                    </button>
                  ) : null}
                </li>
              )
            })}
        </ul>
      ) : null}

      {(emp.dismissalSettlements ?? []).length > 0 ? (
        <div className="rounded-sm border border-red-100 bg-white/80 p-2">
          <p className="text-[11px] font-semibold text-red-800">
            {t('hr.leave.settlementsList')}
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {(emp.dismissalSettlements ?? []).map((s) => {
              const doc = findLeaveArchiveDoc(emp, s.documentId)
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-red-50 px-2 py-1"
                >
                  <span>
                    {s.terminationDate} · {s.leaveBalanceDays}{' '}
                    {t('hr.leave.daysShort')} ·{' '}
                    {s.leaveCompensationGel.toLocaleString('ru-RU')} ₾
                    {doc?.fileUrl ? (
                      <HrDocumentOpenButton
                        doc={doc}
                        compact
                        className="ml-2 text-xs font-semibold text-accent"
                      />
                    ) : (
                      <span className="ml-2 text-[10px] text-stone-400">
                        {t('hr.leave.inArchive')}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

type SettlementProps = {
  emp: Employee
  fireDate: string
  readOnly?: boolean
  /** После фиксации расчёта (уже со статусом fired + архив). */
  onSettled?: (next: Employee) => void
}

/** Блок расчёта при увольнении + фиксация в архив. */
export function DismissalLeaveSettlement({
  emp,
  fireDate,
  readOnly,
  onSettled,
}: SettlementProps) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    const withTerm = { ...emp, terminationDate: fireDate }
    const b = computeLeaveBalance(withTerm, fireDate)
    const p = estimateUnusedLeavePay(emp, b.balance)
    return { b, pay: p }
  }, [emp, fireDate])

  const already = (emp.dismissalSettlements ?? []).some(
    (s) => s.terminationDate === fireDate,
  )

  async function onPickFile(file: File | undefined) {
    if (!file) {
      setFileName(null)
      setFileUrl(undefined)
      return
    }
    setBusy(true)
    try {
      const url = await fileToDataUrl(file)
      setFileUrl(url)
      setFileName(file.name)
    } finally {
      setBusy(false)
    }
  }

  function settle() {
    if (!onSettled || already) return
    const next = confirmDismissalSettlement(emp, {
      terminationDate: fireDate,
      attachment: fileUrl
        ? { fileUrl, fileName: fileName ?? undefined }
        : undefined,
    })
    onSettled(next)
  }

  return (
    <div className="mt-2 rounded-sm border border-red-100 bg-white/70 px-3 py-2 text-[11px] text-red-900">
      <p className="font-semibold">{t('hr.leave.dismissalTitle')}</p>
      <p className="mt-1">
        {t('hr.leave.dismissalBalance').replace(
          '{n}',
          String(
            preview.b.balance.toLocaleString('ru-RU', {
              maximumFractionDigits: 1,
            }),
          ),
        )}
      </p>
      {preview.pay.dailyRate > 0 && preview.b.balance > 0 ? (
        <p className="mt-0.5">
          {t('hr.leave.dismissalPay')
            .replace('{days}', String(preview.pay.days))
            .replace('{rate}', String(preview.pay.dailyRate))
            .replace('{amount}', preview.pay.amount.toLocaleString('ru-RU'))}
        </p>
      ) : preview.b.balance > 0 ? (
        <p className="mt-0.5 text-amber-800">{t('hr.leave.needSalary')}</p>
      ) : null}
      <p className="mt-1 text-stone-600">{t('hr.leave.dismissalHint')}</p>

      {already ? (
        <p className="mt-2 font-medium text-emerald-800">{t('hr.leave.settlementDone')}</p>
      ) : !readOnly && onSettled ? (
        <div className="mt-2 space-y-2 border-t border-red-100 pt-2">
          <label className="block text-stone-600">
            {t('hr.leave.attachOrder')}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="mt-1 block w-full text-xs"
              disabled={busy}
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
            {fileName ? (
              <span className="mt-0.5 block text-sky-800">{fileName}</span>
            ) : (
              <span className="mt-0.5 block text-stone-400">
                {t('hr.leave.attachOptional')}
              </span>
            )}
          </label>
          <button
            type="button"
            className="rounded-sm bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            disabled={busy}
            onClick={settle}
          >
            {t('hr.leave.settleConfirm')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
