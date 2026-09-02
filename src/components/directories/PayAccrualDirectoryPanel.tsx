import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import {
  DEFAULT_PAYROLL_ACCRUAL_RULES,
  multiplierToPercent,
  normalizePayrollAccrualRules,
  percentToMultiplier,
  resolvePayrollAccrualRules,
  type PayrollAccrualRules,
} from '@/lib/finance/payrollAccrualRules'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onSave: (rules: PayrollAccrualRules) => void
}

type Draft = {
  nightPercent: string
  idlePercent: string
  otDayPercent: string
  otNightPercent: string
  nightLineFixedGel: string
}

function draftFromRules(r: PayrollAccrualRules): Draft {
  return {
    nightPercent: String(multiplierToPercent(r.nightMultiplier)),
    idlePercent: String(multiplierToPercent(r.idleMultiplier)),
    otDayPercent: String(multiplierToPercent(r.otDayMultiplier)),
    otNightPercent: String(multiplierToPercent(r.otNightMultiplier)),
    nightLineFixedGel: String(r.nightLineFixedGel),
  }
}

export function PayAccrualDirectoryPanel({ store, onSave }: Props) {
  const { t } = useI18n()
  const current = useMemo(() => resolvePayrollAccrualRules(store.settings), [store.settings])
  const [draft, setDraft] = useState<Draft>(() => draftFromRules(current))
  const [notice, setNotice] = useState<string | null>(null)

  function setField(key: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const next = normalizePayrollAccrualRules({
      ...current,
      nightMultiplier: percentToMultiplier(Number(draft.nightPercent.replace(',', '.'))),
      idleMultiplier: percentToMultiplier(Number(draft.idlePercent.replace(',', '.'))),
      otDayMultiplier: percentToMultiplier(Number(draft.otDayPercent.replace(',', '.'))),
      otNightMultiplier: percentToMultiplier(Number(draft.otNightPercent.replace(',', '.'))),
      nightLineFixedGel: Number(draft.nightLineFixedGel.replace(',', '.')),
    })
    onSave(next)
    setDraft(draftFromRules(next))
    setNotice(t('directories.payAccrual.saved'))
  }

  function handleReset() {
    const next = DEFAULT_PAYROLL_ACCRUAL_RULES
    onSave(next)
    setDraft(draftFromRules(next))
    setNotice(t('directories.payAccrual.resetDone'))
  }

  const rows: { key: keyof Draft; labelKey: string; hintKey: string }[] = [
    {
      key: 'nightPercent',
      labelKey: 'directories.payAccrual.night',
      hintKey: 'directories.payAccrual.nightHint',
    },
    {
      key: 'idlePercent',
      labelKey: 'directories.payAccrual.idle',
      hintKey: 'directories.payAccrual.idleHint',
    },
    {
      key: 'otDayPercent',
      labelKey: 'directories.payAccrual.otDay',
      hintKey: 'directories.payAccrual.otDayHint',
    },
    {
      key: 'otNightPercent',
      labelKey: 'directories.payAccrual.otNight',
      hintKey: 'directories.payAccrual.otNightHint',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-500">{t('directories.payAccrual.subtitle')}</p>

      {notice && (
        <FormNotice type="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <div className="rounded-sm border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950">
        <p className="font-semibold">{t('directories.payAccrual.planNormTitle')}</p>
        <p className="mt-1 text-teal-900/90">{t('directories.payAccrual.planNormBody')}</p>
      </div>

      <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('directories.payAccrual.colName')}</th>
              <th className="px-4 py-3 w-36">{t('directories.payAccrual.colValue')}</th>
              <th className="px-4 py-3">{t('directories.payAccrual.colHint')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-grid">
                <td className="px-4 py-3 font-medium text-ink">{t(row.labelKey)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-24 font-mono"
                      value={draft[row.key]}
                      onChange={(e) => setField(row.key, e.target.value)}
                      inputMode="decimal"
                    />
                    <span className="text-xs text-stone-400">%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-stone-500">{t(row.hintKey)}</td>
              </tr>
            ))}
            <tr className="border-t border-grid">
              <td className="px-4 py-3 font-medium text-ink">
                {t('directories.payAccrual.nightLineFixed')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2" data-coach="directories:nightLineFixed">
                  <Input
                    className="w-24 font-mono"
                    value={draft.nightLineFixedGel}
                    onChange={(e) => setField('nightLineFixedGel', e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="text-xs text-stone-400">₾</span>
                </div>
              </td>
              <td className="px-4 py-3 text-stone-500">
                {t('directories.payAccrual.nightLineFixedHint')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSave}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={handleReset}>
          {t('directories.payAccrual.reset')}
        </Button>
      </div>

      <div className="rounded-sm border border-grid bg-white p-4 text-sm text-stone-600">
        <p className="font-semibold text-ink">{t('directories.payAccrual.codesTitle')}</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>{t('directories.payAccrual.codePlan')}</li>
          <li>{t('directories.payAccrual.codeNight')}</li>
          <li>{t('directories.payAccrual.codeIdle')}</li>
          <li>{t('directories.payAccrual.codeOt')}</li>
          <li>{t('directories.payAccrual.codeVacSick')}</li>
          <li>{t('directories.payAccrual.codeUnpaid')}</li>
        </ul>
      </div>
    </div>
  )
}
