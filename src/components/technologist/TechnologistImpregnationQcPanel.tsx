import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { computeImpregnationQc, qcStatusLabel, theoreticalNvFromRecipe } from '@/lib/technologist/calc'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import type { ImpregnationQcRecord, TechnologistQcStore } from '@/lib/technologist/types'
import { QcStatusBadge } from './QcStatusBadge'

type Props = {
  store: TechnologistQcStore
  formulations: FormulationStore
  operatorName?: string
  onSave: (entry: Omit<ImpregnationQcRecord, 'computed' | 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function TechnologistImpregnationQcPanel({
  store,
  formulations,
  operatorName,
  onSave,
  onRemove,
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const recipes = useMemo(
    () => formulations.recipes.filter((r) => r.active),
    [formulations.recipes],
  )
  const [recipeId, setRecipeId] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [controlledAt, setControlledAt] = useState('')
  const [operators, setOperators] = useState('')
  const [visualOk, setVisualOk] = useState(true)
  const [m0, setM0] = useState('')
  const [m1, setM1] = useState('')
  const [m2, setM2] = useState('')
  const [viscositySec, setViscositySec] = useState('')
  const [viscosityTempC, setViscosityTempC] = useState('')
  const [theoreticalNv, setTheoreticalNv] = useState('')
  const [tolerance, setTolerance] = useState(String(store.settings.defaultNvTolerancePp))
  const [controllerName, setControllerName] = useState('')
  const [note, setNote] = useState('')

  const selectedRecipe = recipes.find((r) => r.id === recipeId)

  function applyRecipe(r: FormulationRecipe) {
    setRecipeId(r.id)
    const nv = theoreticalNvFromRecipe(r)
    if (nv != null) setTheoreticalNv(String(nv))
  }

  const live = useMemo(
    () =>
      computeImpregnationQc({
        gravimetric: { m0: num(m0), m1: num(m1), m2: num(m2) },
        theoreticalNvPct: num(theoreticalNv),
        nvTolerancePp: num(tolerance) ?? store.settings.defaultNvTolerancePp,
      }),
    [m0, m1, m2, theoreticalNv, tolerance, store.settings.defaultNvTolerancePp],
  )

  // Минимум для осмысленной записи: рецепт/партия ИЛИ навеска (m0/m1/m2).
  const hasGravimetric = num(m0) != null && num(m1) != null && num(m2) != null
  const canSave = Boolean(recipeId || batchNumber.trim()) || hasGravimetric

  function save() {
    if (!canSave) return
    onSave({
      recipeId: recipeId || undefined,
      recipeCode: selectedRecipe?.code,
      batchNumber: batchNumber || undefined,
      manufacturedAt: manufacturedAt || undefined,
      controlledAt: controlledAt || undefined,
      operators: operators || undefined,
      visualOk,
      gravimetric: { m0: num(m0), m1: num(m1), m2: num(m2) },
      viscositySec: num(viscositySec),
      viscosityTempC: num(viscosityTempC),
      theoreticalNvPct: num(theoreticalNv),
      nvTolerancePp: num(tolerance) ?? store.settings.defaultNvTolerancePp,
      controllerName: controllerName || operatorName,
      note: note || undefined,
    })
  }

  const rows = [...store.impregnationQc].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card title={t('technologist.qc.impreg.title')} description={t('technologist.qc.impreg.hint')}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('technologist.qc.impreg.recipe')}>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipeId}
              onChange={(e) => {
                const r = recipes.find((x) => x.id === e.target.value)
                if (r) applyRecipe(r)
                else setRecipeId('')
              }}
            >
              <option value="">—</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('technologist.qc.impreg.batchNo')}>
            <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.mfgDate')}>
            <Input type="date" value={manufacturedAt} onChange={(e) => setManufacturedAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.controlDate')}>
            <Input type="date" value={controlledAt} onChange={(e) => setControlledAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.operators')}>
            <Input value={operators} onChange={(e) => setOperators(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.controller')}>
            <Input value={controllerName} onChange={(e) => setControllerName(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FormField label="m0">
            <Input value={m0} onChange={(e) => setM0(e.target.value)} />
          </FormField>
          <FormField label="m1">
            <Input value={m1} onChange={(e) => setM1(e.target.value)} />
          </FormField>
          <FormField label="m2">
            <Input value={m2} onChange={(e) => setM2(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('technologist.qc.impreg.theoreticalNv')}>
            <Input value={theoreticalNv} onChange={(e) => setTheoreticalNv(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.tolerance')}>
            <Input value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.viscositySec')}>
            <Input value={viscositySec} onChange={(e) => setViscositySec(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.impreg.viscosityTemp')}>
            <Input value={viscosityTempC} onChange={(e) => setViscosityTempC(e.target.value)} />
          </FormField>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visualOk} onChange={(e) => setVisualOk(e.target.checked)} />
          {t('technologist.qc.impreg.visualOk')}
        </label>

        <FormField className="mt-3" label={t('technologist.field.comment')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        <div className="mt-4 grid gap-2 rounded-sm bg-stone-50 p-3 text-sm md:grid-cols-4">
          <div>
            NV: <strong>{live.nvPct != null ? `${live.nvPct}%` : '—'}</strong>
          </div>
          <div>
            {t('technologist.qc.impreg.deviation')}:{' '}
            <strong>{live.absDeviationPp != null ? `${live.absDeviationPp} п.п.` : '—'}</strong>
          </div>
          <div>
            {t('technologist.qc.impreg.relDeviation')}:{' '}
            <strong>{live.relDeviation != null ? `${(live.relDeviation * 100).toFixed(1)}%` : '—'}</strong>
          </div>
          <div className="flex items-center gap-2">
            {t('technologist.qc.status')}:{' '}
            <QcStatusBadge status={live.status} label={qcStatusLabel(live.status, locale)} />
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={save} disabled={!canSave}>
            {t('technologist.qc.save')}
          </Button>
          {!canSave && (
            <span className="ml-3 text-xs text-stone-500">
              {t('technologist.qc.saveHint')}
            </span>
          )}
        </div>
      </Card>

      <Card title={t('technologist.qc.journal')}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('technologist.qc.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('technologist.qc.impreg.recipe')}</th>
                  <th>{t('technologist.qc.impreg.controlDate')}</th>
                  <th className="text-right">NV</th>
                  <th>{t('technologist.qc.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.recipeCode || '—'}</td>
                    <td>{r.controlledAt || r.manufacturedAt || '—'}</td>
                    <td className="text-right font-mono">{r.computed.nvPct ?? '—'}%</td>
                    <td>
                      <QcStatusBadge
                        status={r.computed.status}
                        label={qcStatusLabel(r.computed.status, locale)}
                      />
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={async () => {
                          if (
                            await confirm({
                              message: t('technologist.qc.deleteConfirm'),
                              danger: true,
                            })
                          ) {
                            onRemove(r.id)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
