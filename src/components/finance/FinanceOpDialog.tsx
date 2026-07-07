import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { formatGel } from '@/lib/payroll'
import type { FinanceAdjustmentKind, FinancePaymentMethod } from '@/lib/finance/types'

export type FinanceOpKind = 'advance' | 'adjustment' | 'payout'

export type FinanceOpResult =
  | { op: 'advance'; amount: number; method: FinancePaymentMethod; date: string; note?: string }
  | { op: 'adjustment'; kind: FinanceAdjustmentKind; amount: number; reason: string; date: string }
  | { op: 'payout'; amount: number; method: FinancePaymentMethod; date: string; note?: string }

type Props = {
  kind: FinanceOpKind
  employeeName: string
  /** Начислено за месяц — для расчёта аванса процентом. */
  accrued: number
  /** Остаток к выплате — дефолт для выплаты. */
  remaining: number
  onClose: () => void
  onSubmit: (result: FinanceOpResult) => void
}

const today = () => new Date().toISOString().slice(0, 10)

function parseNum(v: string): number {
  return Number(v.replace(',', '.'))
}

export function FinanceOpDialog({ kind, employeeName, accrued, remaining, onClose, onSubmit }: Props) {
  const { t } = useI18n()
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState<FinancePaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // advance
  const [usePercent, setUsePercent] = useState(false)
  const [percent, setPercent] = useState('50')
  const [amount, setAmount] = useState(
    kind === 'payout' ? String(Math.max(0, remaining)) : '',
  )

  // adjustment
  const [adjKind, setAdjKind] = useState<FinanceAdjustmentKind>('bonus')
  const [reason, setReason] = useState('')

  const title =
    kind === 'advance'
      ? t('fin.adv.title')
      : kind === 'adjustment'
        ? t('fin.adj.title')
        : t('fin.payout.title')

  const computedAdvance =
    kind === 'advance' && usePercent
      ? Math.round((accrued * (parseNum(percent) || 0)) / 100)
      : parseNum(amount)

  function submit() {
    setError(null)
    if (kind === 'advance') {
      const amt = usePercent ? computedAdvance : parseNum(amount)
      if (!Number.isFinite(amt) || amt <= 0) {
        setError(t('fin.invalidAmount'))
        return
      }
      onSubmit({ op: 'advance', amount: amt, method, date, note: note.trim() || undefined })
      return
    }
    if (kind === 'payout') {
      const amt = parseNum(amount)
      if (!Number.isFinite(amt) || amt <= 0) {
        setError(t('fin.invalidAmount'))
        return
      }
      onSubmit({ op: 'payout', amount: amt, method, date, note: note.trim() || undefined })
      return
    }
    const amt = parseNum(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('fin.invalidAmount'))
      return
    }
    if (!reason.trim()) {
      setError(t('fin.adj.reasonRequired'))
      return
    }
    onSubmit({ op: 'adjustment', kind: adjKind, amount: amt, reason: reason.trim(), date })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={title}
      subtitle={employeeName}
      size="md"
      onPrimaryAction={submit}
      initialFocus="primary"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" data-modal-primary onClick={submit}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {error && (
          <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {kind === 'adjustment' && (
          <FormField label={t('fin.adj.kind')}>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium ${adjKind === 'bonus' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-grid'}`}
                onClick={() => setAdjKind('bonus')}
              >
                {t('fin.adj.bonus')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium ${adjKind === 'penalty' ? 'border-red-400 bg-red-50 text-red-800' : 'border-grid'}`}
                onClick={() => setAdjKind('penalty')}
              >
                {t('fin.adj.penalty')}
              </button>
            </div>
          </FormField>
        )}

        {kind === 'advance' && (
          <FormField label={t('fin.adv.mode')} hint={`${t('fin.col.accrued')}: ${formatGel(accrued)}`}>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium ${!usePercent ? 'border-accent bg-accent-soft/30 text-ink' : 'border-grid'}`}
                onClick={() => setUsePercent(false)}
              >
                {t('fin.adv.byAmount')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-sm border px-3 py-2 text-sm font-medium ${usePercent ? 'border-accent bg-accent-soft/30 text-ink' : 'border-grid'}`}
                onClick={() => setUsePercent(true)}
              >
                {t('fin.adv.byPercent')}
              </button>
            </div>
          </FormField>
        )}

        {kind === 'advance' && usePercent ? (
          <FormField label={t('fin.adv.percent')} hint={`= ${formatGel(computedAdvance)}`}>
            <Input
              type="text"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </FormField>
        ) : (
          <FormField label={t('fin.amount')}>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </FormField>
        )}

        {kind === 'adjustment' && (
          <FormField label={t('fin.adj.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('fin.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          {kind !== 'adjustment' && (
            <FormField label={t('fin.method')}>
              <select
                className="fc-input"
                value={method}
                onChange={(e) => setMethod(e.target.value as FinancePaymentMethod)}
              >
                <option value="cash">{t('fin.method.cash')}</option>
                <option value="card">{t('fin.method.card')}</option>
                <option value="bank">{t('fin.method.bank')}</option>
              </select>
            </FormField>
          )}
        </div>

        {kind !== 'adjustment' && (
          <FormField label={t('fin.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        )}
      </div>
    </AppDialog>
  )
}
