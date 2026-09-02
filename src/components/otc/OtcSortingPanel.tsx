import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { localTodayYmd } from '@/lib/otc/calc'
import type { OtcSortingRecord, OtcStore } from '@/lib/otc/types'

type Props = {
  store: OtcStore
  operatorName?: string
  onSave: (entry: Omit<OtcSortingRecord, 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function num(v: string): number {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function OtcSortingPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t } = useI18n()
  const [sortedAt, setSortedAt] = useState(localTodayYmd())
  const [shiftLabel, setShiftLabel] = useState('')
  const [productName, setProductName] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [qtyCat1, setQtyCat1] = useState('')
  const [qtyCat2, setQtyCat2] = useState('')
  const [qtyCat3, setQtyCat3] = useState('')
  const [qtyScrap, setQtyScrap] = useState('')
  const [unit, setUnit] = useState<'rolls' | 'mp'>('rolls')
  const [visualOk, setVisualOk] = useState(true)
  const [handStretchOk, setHandStretchOk] = useState(true)
  const [sorterName, setSorterName] = useState(operatorName ?? '')
  const [note, setNote] = useState('')

  function save() {
    if (!productName.trim()) return
    onSave({
      sortedAt,
      shiftLabel: shiftLabel.trim() || undefined,
      productName: productName.trim(),
      batchNo: batchNo.trim() || undefined,
      qtyCat1: num(qtyCat1),
      qtyCat2: num(qtyCat2),
      qtyCat3: num(qtyCat3),
      qtyScrap: num(qtyScrap),
      unit,
      visualOk,
      handStretchOk,
      sorterName: sorterName.trim() || undefined,
      note: note.trim() || undefined,
    })
    setQtyCat1('')
    setQtyCat2('')
    setQtyCat3('')
    setQtyScrap('')
    setNote('')
  }

  const rows = [...store.sorting].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('otc.sorting.title')}</h3>
        <p className="text-xs text-slate-500">{t('otc.sorting.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('otc.date')}>
            <Input type="date" value={sortedAt} onChange={(e) => setSortedAt(e.target.value)} />
          </FormField>
          <FormField label={t('otc.sorting.shift')}>
            <Input value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value)} />
          </FormField>
          <FormField label={t('otc.productName')}>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.batchNo')}>
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </FormField>
          <FormField label={t('otc.sorting.unit')}>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={unit}
              onChange={(e) => setUnit(e.target.value as 'rolls' | 'mp')}
            >
              <option value="rolls">{t('otc.sorting.rolls')}</option>
              <option value="mp">{t('otc.sorting.mp')}</option>
            </select>
          </FormField>
          <FormField label={t('otc.controller')}>
            <Input value={sorterName} onChange={(e) => setSorterName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.sorting.cat1')}>
            <Input value={qtyCat1} onChange={(e) => setQtyCat1(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.sorting.cat2')}>
            <Input value={qtyCat2} onChange={(e) => setQtyCat2(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.sorting.cat3')}>
            <Input value={qtyCat3} onChange={(e) => setQtyCat3(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.sorting.scrap')}>
            <Input value={qtyScrap} onChange={(e) => setQtyScrap(e.target.value)} inputMode="decimal" />
          </FormField>
          <FormField label={t('otc.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={visualOk} onChange={(e) => setVisualOk(e.target.checked)} />
            {t('otc.sorting.visualOk')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={handStretchOk}
              onChange={(e) => setHandStretchOk(e.target.checked)}
            />
            {t('otc.sorting.handStretchOk')}
          </label>
        </div>
        <Button type="button" onClick={save} disabled={!productName.trim()}>
          {t('otc.save')}
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('otc.sorting.journal')}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('otc.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">{t('otc.date')}</th>
                  <th className="px-2 py-1.5">{t('otc.productName')}</th>
                  <th className="px-2 py-1.5">1 / 2 / 3 / {t('otc.sorting.scrap')}</th>
                  <th className="px-2 py-1.5">{t('otc.sorting.checks')}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums">{r.sortedAt}</td>
                    <td className="px-2 py-1.5">
                      {r.productName}
                      {r.batchNo ? (
                        <span className="block text-xs text-slate-500">{r.batchNo}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.qtyCat1} / {r.qtyCat2} / {r.qtyCat3} /{' '}
                      <span className="text-red-700">{r.qtyScrap}</span> {r.unit}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.visualOk === false ? t('otc.sorting.visualBad') : t('otc.sorting.visualOk')}
                      {' · '}
                      {r.handStretchOk === false
                        ? t('otc.sorting.handBad')
                        : t('otc.sorting.handStretchOk')}
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
