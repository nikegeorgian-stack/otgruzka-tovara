import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { computeEadControl, qcStatusLabel } from '@/lib/technologist/calc'
import type { EadControlRecord, TechnologistQcStore } from '@/lib/technologist/types'
import { QcStatusBadge } from './QcStatusBadge'

type Props = {
  store: TechnologistQcStore
  operatorName?: string
  onSave: (entry: Omit<EadControlRecord, 'computed' | 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function parseNums(raw: string): number[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => parseFloat(s.replace(',', '.')))
    .filter((n) => Number.isFinite(n))
}

export function TechnologistEadControlPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const [productType, setProductType] = useState('')
  const [substrateName, setSubstrateName] = useState('')
  const [lineId, setLineId] = useState('1')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [targetGsm, setTargetGsm] = useState('')
  const [note, setNote] = useState('')
  const [leftReadings, setLeftReadings] = useState('')
  const [rightReadings, setRightReadings] = useState('')

  const live = useMemo(() => {
    const target = parseFloat(targetGsm.replace(',', '.'))
    if (!Number.isFinite(target)) return null
    return computeEadControl({
      targetGsm: target,
      leftReadings: parseNums(leftReadings),
      rightReadings: parseNums(rightReadings),
    })
  }, [targetGsm, leftReadings, rightReadings])

  function save() {
    const target = parseFloat(targetGsm.replace(',', '.'))
    if (!productType.trim() || !Number.isFinite(target)) return
    onSave({
      productType: productType.trim(),
      substrateName: substrateName.trim(),
      lineId,
      manufacturedAt: manufacturedAt || undefined,
      targetGsm: target,
      note: note || undefined,
      leftReadings: parseNums(leftReadings),
      rightReadings: parseNums(rightReadings),
      createdByName: operatorName,
    })
  }

  const rows = [...store.eadControls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card title={t('technologist.qc.eadControl.title')} description={t('technologist.qc.eadControl.hint')}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('technologist.qc.eadControl.product')}>
            <Input value={productType} onChange={(e) => setProductType(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadControl.substrate')}>
            <Input value={substrateName} onChange={(e) => setSubstrateName(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadControl.line')}>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              <option value="1">RATL 1</option>
              <option value="2">RATL 2</option>
            </select>
          </FormField>
          <FormField label={t('technologist.qc.eadControl.mfgDate')}>
            <Input type="date" value={manufacturedAt} onChange={(e) => setManufacturedAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadControl.targetGsm')}>
            <Input value={targetGsm} onChange={(e) => setTargetGsm(e.target.value)} placeholder="200" />
          </FormField>
          <FormField label={t('technologist.qc.eadControl.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FormField label={t('technologist.qc.eadControl.leftReadings')} hint={t('technologist.qc.eadControl.readingsHint')}>
            <Input value={leftReadings} onChange={(e) => setLeftReadings(e.target.value)} placeholder="2247, 2232, 2201" />
          </FormField>
          <FormField label={t('technologist.qc.eadControl.rightReadings')}>
            <Input value={rightReadings} onChange={(e) => setRightReadings(e.target.value)} placeholder="1986, 1942, 1928" />
          </FormField>
        </div>

        {live && (
          <div className="mt-4 grid gap-2 rounded-sm bg-stone-50 p-3 text-sm md:grid-cols-4">
            <div>
              {t('technologist.qc.eadControl.leftAvg')}: <strong>{live.leftAvgGsm ?? '—'}</strong>
            </div>
            <div>
              {t('technologist.qc.eadControl.rightAvg')}: <strong>{live.rightAvgGsm ?? '—'}</strong>
            </div>
            <div>
              {t('technologist.qc.eadControl.overall')}: <strong>{live.overallAvgGsm ?? '—'}</strong> г/м²
            </div>
            <div className="flex items-center gap-2">
              {t('technologist.qc.status')}:{' '}
              <QcStatusBadge status={live.status} label={qcStatusLabel(live.status, locale)} />
              {live.deviationGsm != null && (
                <span className="text-xs text-stone-500">
                  Δ {live.deviationGsm > 0 ? '+' : ''}
                  {live.deviationGsm} ({live.deviationPct}%)
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-4">
          <Button onClick={save} disabled={!productType.trim() || !targetGsm}>
            {t('technologist.qc.save')}
          </Button>
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
                  <th>{t('technologist.qc.eadControl.product')}</th>
                  <th>{t('technologist.qc.eadControl.line')}</th>
                  <th className="text-right">{t('technologist.qc.eadControl.targetGsm')}</th>
                  <th className="text-right">{t('technologist.qc.eadControl.overall')}</th>
                  <th>{t('technologist.qc.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div>{r.productType}</div>
                      <div className="text-xs text-stone-500">{r.substrateName}</div>
                    </td>
                    <td>{r.lineId}</td>
                    <td className="text-right font-mono">{r.targetGsm}</td>
                    <td className="text-right font-mono">{r.computed.overallAvgGsm ?? '—'}</td>
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
                        onClick={() => onRemove(r.id)}
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
