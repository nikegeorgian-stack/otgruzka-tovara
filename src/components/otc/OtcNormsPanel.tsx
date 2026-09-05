import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { defaultUnit } from '@/lib/otc/calc'
import {
  OTC_PRODUCT_KINDS,
  OTC_TEST_KINDS,
  productKindLabel,
  testKindLabel,
} from '@/lib/otc/labels'
import type { OtcNorm, OtcProductKind, OtcStore, OtcTestKind } from '@/lib/otc/types'

type Props = {
  store: OtcStore
  onSave: (entry: OtcNorm) => void
  onRemove: (id: string) => void
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function OtcNormsPanel({ store, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const [editId, setEditId] = useState<string | null>(null)
  const [productKind, setProductKind] = useState<OtcProductKind>('mesh')
  const [testKind, setTestKind] = useState<OtcTestKind>('tensile_strength')
  const [labelRu, setLabelRu] = useState('')
  const [unit, setUnit] = useState(defaultUnit('tensile_strength'))
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [residualMinPct, setResidualMinPct] = useState('')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)

  function load(row: OtcNorm) {
    setEditId(row.id)
    setProductKind(row.productKind)
    setTestKind(row.testKind)
    setLabelRu(row.labelRu)
    setUnit(row.unit)
    setMin(row.min != null ? String(row.min) : '')
    setMax(row.max != null ? String(row.max) : '')
    setResidualMinPct(row.residualMinPct != null ? String(row.residualMinPct) : '')
    setNote(row.note ?? '')
    setActive(row.active)
  }

  function resetForm() {
    setEditId(null)
    setLabelRu('')
    setMin('')
    setMax('')
    setResidualMinPct('')
    setNote('')
    setActive(true)
    setUnit(defaultUnit(testKind))
  }

  function save() {
    const label = labelRu.trim() || testKindLabel(testKind, 'ru')
    onSave({
      id: editId ?? crypto.randomUUID(),
      productKind,
      testKind,
      labelRu: label,
      unit: unit || defaultUnit(testKind),
      min: num(min),
      max: num(max),
      residualMinPct: num(residualMinPct),
      active,
      note: note.trim() || undefined,
    })
    resetForm()
  }

  const rows = [...store.norms].sort((a, b) =>
    `${a.productKind}:${a.testKind}`.localeCompare(`${b.productKind}:${b.testKind}`),
  )

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('otc.norms.title')}</h3>
        <p className="text-xs text-slate-500">{t('otc.norms.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('otc.productKind')}>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={productKind}
              onChange={(e) => setProductKind(e.target.value as OtcProductKind)}
            >
              {OTC_PRODUCT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {productKindLabel(k, locale)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('otc.testKind')}>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={testKind}
              onChange={(e) => {
                const k = e.target.value as OtcTestKind
                setTestKind(k)
                setUnit(defaultUnit(k))
              }}
            >
              {OTC_TEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {testKindLabel(k, locale)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('otc.norms.label')}>
            <Input value={labelRu} onChange={(e) => setLabelRu(e.target.value)} />
          </FormField>
          <FormField label={t('otc.unit')}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </FormField>
          <FormField label={t('otc.normMin')}>
            <Input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.normMax')}>
            <Input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.alkali.residualMin')}>
            <Input
              value={residualMinPct}
              onChange={(e) => setResidualMinPct(e.target.value)}
              inputMode="decimal"
            />
          </FormField>
          <FormField label={t('otc.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('otc.norms.active')}
        </label>
        <div className="flex gap-2">
          <Button type="button" onClick={save}>
            {editId ? t('otc.norms.update') : t('otc.save')}
          </Button>
          {editId && (
            <Button type="button" onClick={resetForm}>
              {t('otc.cancel')}
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('otc.norms.list')}</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">{t('otc.productKind')}</th>
                <th className="px-2 py-1.5">{t('otc.testKind')}</th>
                <th className="px-2 py-1.5">{t('otc.norms.range')}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-slate-100 ${r.active ? '' : 'opacity-50'}`}>
                  <td className="px-2 py-1.5">{productKindLabel(r.productKind, locale)}</td>
                  <td className="px-2 py-1.5">
                    {r.labelRu}
                    <span className="block text-xs text-slate-500">
                      {testKindLabel(r.testKind, locale)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {r.residualMinPct != null
                      ? `≥ ${r.residualMinPct}%`
                      : r.min != null || r.max != null
                        ? `${r.min ?? '—'} … ${r.max ?? '—'} ${r.unit}`
                        : `— ${r.unit}`}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => load(r)}>
                        {t('otc.edit')}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          if (confirm(t('otc.deleteConfirm'))) onRemove(r.id)
                        }}
                      >
                        {t('otc.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
