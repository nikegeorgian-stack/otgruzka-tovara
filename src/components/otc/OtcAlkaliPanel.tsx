import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import {
  addDaysIso,
  alkaliOverdue,
  findNorm,
  localTodayYmd,
} from '@/lib/otc/calc'
import { passStatusLabel } from '@/lib/otc/labels'
import type { OtcAlkaliPhase, OtcAlkaliSeries, OtcStore } from '@/lib/otc/types'
import { OtcStatusBadge } from './OtcStatusBadge'

type Props = {
  store: OtcStore
  operatorName?: string
  onSave: (
    entry: Omit<OtcAlkaliSeries, 'computed' | 'id' | 'createdAt' | 'dueDate'> & {
      id?: string
      dueDate?: string
    },
  ) => void
  onRemove: (id: string) => void
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function OtcAlkaliPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const defaultResidual =
    findNorm(store.norms, 'mesh', 'alkali_resistance')?.residualMinPct ?? 50

  const [productName, setProductName] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [sampleLabel, setSampleLabel] = useState('')
  const [strengthBefore, setStrengthBefore] = useState('')
  const [strengthBeforeSecondary, setStrengthBeforeSecondary] = useState('')
  const [soakDate, setSoakDate] = useState(localTodayYmd())
  const [residualMinPct, setResidualMinPct] = useState(String(defaultResidual))
  const [controllerName, setControllerName] = useState(operatorName ?? '')
  const [note, setNote] = useState('')

  const [afterId, setAfterId] = useState<string | null>(null)
  const [strengthAfter, setStrengthAfter] = useState('')
  const [strengthAfterSecondary, setStrengthAfterSecondary] = useState('')

  const today = localTodayYmd()
  const rows = useMemo(
    () => [...store.alkaliSeries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [store.alkaliSeries],
  )

  function startSeries() {
    if (!productName.trim() || !strengthBefore.trim()) return
    onSave({
      productName: productName.trim(),
      batchNo: batchNo.trim() || undefined,
      sampleLabel: sampleLabel.trim() || undefined,
      soakDate,
      dueDate: addDaysIso(soakDate, 28),
      strengthBefore: num(strengthBefore),
      strengthBeforeSecondary: num(strengthBeforeSecondary),
      residualMinPct: num(residualMinPct) ?? 50,
      phase: 'soaking',
      controllerName: controllerName.trim() || undefined,
      note: note.trim() || undefined,
    })
    setStrengthBefore('')
    setStrengthBeforeSecondary('')
    setNote('')
  }

  function completeAfter(row: OtcAlkaliSeries) {
    const after = num(strengthAfter)
    if (after == null) return
    const phase: OtcAlkaliPhase = 'closed'
    const patch = {
      ...row,
      strengthAfter: after,
      strengthAfterSecondary: num(strengthAfterSecondary),
      phase,
    }
    onSave({
      id: row.id,
      productName: patch.productName,
      finishedProductId: patch.finishedProductId,
      batchNo: patch.batchNo,
      sampleLabel: patch.sampleLabel,
      soakDate: patch.soakDate,
      dueDate: patch.dueDate,
      strengthBefore: patch.strengthBefore,
      strengthBeforeSecondary: patch.strengthBeforeSecondary,
      strengthAfter: after,
      strengthAfterSecondary: num(strengthAfterSecondary),
      residualMinPct: patch.residualMinPct,
      phase,
      controllerName: controllerName.trim() || row.controllerName,
      note: row.note,
    })
    setAfterId(null)
    setStrengthAfter('')
    setStrengthAfterSecondary('')
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('otc.alkali.title')}</h3>
        <p className="text-xs text-slate-500">{t('otc.alkali.hint')}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>{t('otc.alkali.step1')}</li>
          <li>{t('otc.alkali.step2')}</li>
          <li>{t('otc.alkali.step3')}</li>
          <li>{t('otc.alkali.step4')}</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('otc.productName')}>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.batchNo')}>
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </FormField>
          <FormField label={t('otc.alkali.sample')}>
            <Input value={sampleLabel} onChange={(e) => setSampleLabel(e.target.value)} />
          </FormField>
          <FormField label={t('otc.alkali.before')}>
            <Input
              value={strengthBefore}
              onChange={(e) => setStrengthBefore(e.target.value)}
              inputMode="decimal"
            />
          </FormField>
          <FormField label={t('otc.alkali.before2')}>
            <Input
              value={strengthBeforeSecondary}
              onChange={(e) => setStrengthBeforeSecondary(e.target.value)}
              inputMode="decimal"
            />
          </FormField>
          <FormField label={t('otc.alkali.soakDate')}>
            <Input type="date" value={soakDate} onChange={(e) => setSoakDate(e.target.value)} />
          </FormField>
          <FormField label={t('otc.alkali.residualMin')}>
            <Input
              value={residualMinPct}
              onChange={(e) => setResidualMinPct(e.target.value)}
              inputMode="decimal"
            />
          </FormField>
          <FormField label={t('otc.controller')}>
            <Input value={controllerName} onChange={(e) => setControllerName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>
            {t('otc.alkali.due')}: <strong>{addDaysIso(soakDate, 28)}</strong>
          </span>
          <Button
            type="button"
            onClick={startSeries}
            disabled={!productName.trim() || !strengthBefore.trim()}
          >
            {t('otc.alkali.start')}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('otc.alkali.journal')}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('otc.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const overdue = alkaliOverdue(r, today)
              return (
                <li
                  key={r.id}
                  className={`rounded-md border p-3 ${overdue ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {r.productName}
                        {r.batchNo ? ` · ${r.batchNo}` : ''}
                        {r.sampleLabel ? ` · ${r.sampleLabel}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {t('otc.alkali.soakDate')}: {r.soakDate ?? '—'} · {t('otc.alkali.due')}:{' '}
                        {r.dueDate ?? '—'}
                        {overdue ? ` · ${t('otc.dash.overdue')}` : ''}
                      </div>
                      <div className="mt-1 text-sm">
                        {t('otc.alkali.before')}: {r.strengthBefore ?? '—'}
                        {r.strengthBeforeSecondary != null ? ` / ${r.strengthBeforeSecondary}` : ''}
                        {r.strengthAfter != null && (
                          <>
                            {' '}
                            → {t('otc.alkali.after')}: {r.strengthAfter}
                            {r.strengthAfterSecondary != null
                              ? ` / ${r.strengthAfterSecondary}`
                              : ''}
                          </>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{r.computed.summary}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <OtcStatusBadge
                        status={r.computed.status}
                        label={passStatusLabel(r.computed.status, locale)}
                      />
                      <span className="text-xs uppercase text-slate-500">{r.phase}</span>
                      {r.phase === 'soaking' && (
                        <Button type="button" onClick={() => setAfterId(r.id)}>
                          {t('otc.alkali.recordAfter')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        onClick={() => {
                          if (confirm(t('otc.deleteConfirm'))) onRemove(r.id)
                        }}
                      >
                        {t('otc.delete')}
                      </Button>
                    </div>
                  </div>
                  {afterId === r.id && (
                    <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
                      <FormField label={t('otc.alkali.after')}>
                        <Input
                          value={strengthAfter}
                          onChange={(e) => setStrengthAfter(e.target.value)}
                          inputMode="decimal"
                        />
                      </FormField>
                      <FormField label={t('otc.alkali.after2')}>
                        <Input
                          value={strengthAfterSecondary}
                          onChange={(e) => setStrengthAfterSecondary(e.target.value)}
                          inputMode="decimal"
                        />
                      </FormField>
                      <div className="flex items-end gap-2">
                        <Button type="button" onClick={() => completeAfter(r)}>
                          {t('otc.alkali.finish')}
                        </Button>
                        <Button type="button" onClick={() => setAfterId(null)}>
                          {t('otc.cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
