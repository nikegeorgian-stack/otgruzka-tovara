import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { applyNormToLabDraft, computeLabTestVerdict, localTodayYmd } from '@/lib/otc/calc'
import {
  OTC_PRODUCT_KINDS,
  passStatusLabel,
  productKindLabel,
  testKindLabel,
  testKindsForProduct,
} from '@/lib/otc/labels'
import type { OtcLabTest, OtcProductKind, OtcStore, OtcTestKind } from '@/lib/otc/types'
import { OtcStatusBadge } from './OtcStatusBadge'

type Props = {
  store: OtcStore
  operatorName?: string
  onSave: (entry: Omit<OtcLabTest, 'computed' | 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function OtcLabTestsPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const [productKind, setProductKind] = useState<OtcProductKind>('mesh')
  const kinds = testKindsForProduct(productKind)
  const [testKind, setTestKind] = useState<OtcTestKind>(kinds[0] ?? 'tensile_strength')
  const [testedAt, setTestedAt] = useState(localTodayYmd())
  const [productName, setProductName] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [value, setValue] = useState('')
  const [valueSecondary, setValueSecondary] = useState('')
  const [normMin, setNormMin] = useState('')
  const [normMax, setNormMax] = useState('')
  const [unit, setUnit] = useState('')
  const [normId, setNormId] = useState<string | undefined>()
  const [controllerName, setControllerName] = useState(operatorName ?? '')
  const [note, setNote] = useState('')

  function applyProduct(kind: OtcProductKind) {
    setProductKind(kind)
    const nextKinds = testKindsForProduct(kind)
    const next = nextKinds.includes(testKind) ? testKind : nextKinds[0]
    setTestKind(next)
    const draft = applyNormToLabDraft(store.norms, kind, next)
    setNormId(draft.normId)
    setNormMin(draft.normMin != null ? String(draft.normMin) : '')
    setNormMax(draft.normMax != null ? String(draft.normMax) : '')
    setUnit(draft.unit)
  }

  function applyTest(kind: OtcTestKind) {
    setTestKind(kind)
    const draft = applyNormToLabDraft(store.norms, productKind, kind)
    setNormId(draft.normId)
    setNormMin(draft.normMin != null ? String(draft.normMin) : '')
    setNormMax(draft.normMax != null ? String(draft.normMax) : '')
    setUnit(draft.unit)
  }

  const live = useMemo(
    () =>
      computeLabTestVerdict({
        value: num(value),
        valueSecondary: num(valueSecondary),
        normMin: num(normMin),
        normMax: num(normMax),
      }),
    [value, valueSecondary, normMin, normMax],
  )

  function save() {
    if (!productName.trim() || !testedAt) return
    onSave({
      productKind,
      testKind,
      testedAt,
      productName: productName.trim(),
      batchNo: batchNo.trim() || undefined,
      value: num(value),
      valueSecondary: num(valueSecondary),
      unit: unit || '—',
      normId,
      normMin: num(normMin),
      normMax: num(normMax),
      controllerName: controllerName.trim() || undefined,
      note: note.trim() || undefined,
    })
    setValue('')
    setValueSecondary('')
    setNote('')
  }

  const rows = [...store.labTests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('otc.lab.title')}</h3>
        <p className="text-xs text-slate-500">{t('otc.lab.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('otc.productKind')}>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={productKind}
              onChange={(e) => applyProduct(e.target.value as OtcProductKind)}
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
              onChange={(e) => applyTest(e.target.value as OtcTestKind)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {testKindLabel(k, locale)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('otc.date')}>
            <Input type="date" value={testedAt} onChange={(e) => setTestedAt(e.target.value)} />
          </FormField>
          <FormField label={t('otc.productName')}>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.batchNo')}>
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </FormField>
          <FormField label={t('otc.controller')}>
            <Input value={controllerName} onChange={(e) => setControllerName(e.target.value)} />
          </FormField>
          <FormField label={`${t('otc.value')} (${unit || '—'})`}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.valueSecondary')}>
            <Input
              value={valueSecondary}
              onChange={(e) => setValueSecondary(e.target.value)}
              inputMode="decimal"
              placeholder={t('otc.valueSecondaryHint')}
            />
          </FormField>
          <FormField label={t('otc.unit')}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </FormField>
          <FormField label={t('otc.normMin')}>
            <Input value={normMin} onChange={(e) => setNormMin(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.normMax')}>
            <Input value={normMax} onChange={(e) => setNormMax(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <OtcStatusBadge status={live.status} label={passStatusLabel(live.status, locale)} />
          <span className="text-sm text-slate-600">{live.summary}</span>
          <Button type="button" onClick={save} disabled={!productName.trim()}>
            {t('otc.save')}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('otc.lab.journal')}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('otc.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">{t('otc.date')}</th>
                  <th className="px-2 py-1.5">{t('otc.productName')}</th>
                  <th className="px-2 py-1.5">{t('otc.testKind')}</th>
                  <th className="px-2 py-1.5">{t('otc.value')}</th>
                  <th className="px-2 py-1.5">{t('otc.status')}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums">{r.testedAt}</td>
                    <td className="px-2 py-1.5">
                      {r.productName}
                      {r.batchNo ? (
                        <span className="block text-xs text-slate-500">{r.batchNo}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">{testKindLabel(r.testKind, locale)}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.value ?? '—'}
                      {r.valueSecondary != null ? ` / ${r.valueSecondary}` : ''} {r.unit}
                    </td>
                    <td className="px-2 py-1.5">
                      <OtcStatusBadge
                        status={r.computed.status}
                        label={passStatusLabel(r.computed.status, locale)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        onClick={() => {
                          if (confirm(t('otc.deleteConfirm'))) onRemove(r.id)
                        }}
                      >
                        {t('otc.delete')}
                      </Button>
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
