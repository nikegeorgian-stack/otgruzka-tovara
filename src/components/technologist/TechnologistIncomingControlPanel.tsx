import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { computeIncomingControl, qcStatusLabel } from '@/lib/technologist/calc'
import type { IncomingControlRecord, IncomingMaterialKind, TechnologistQcStore } from '@/lib/technologist/types'
import { QcStatusBadge } from './QcStatusBadge'

type Props = {
  store: TechnologistQcStore
  onSave: (entry: Omit<IncomingControlRecord, 'computed' | 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function TechnologistIncomingControlPanel({ store, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const [kind, setKind] = useState<IncomingMaterialKind>('chemistry')
  const [supplier, setSupplier] = useState('')
  const [containerNo, setContainerNo] = useState('')
  const [itemName, setItemName] = useState('')
  const [receiptDate, setReceiptDate] = useState('')
  const [controlDate, setControlDate] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [ph, setPh] = useState('')
  const [phMin, setPhMin] = useState('')
  const [phMax, setPhMax] = useState('')
  const [drySolidsPct, setDrySolidsPct] = useState('')
  const [passportDry, setPassportDry] = useState('')
  const [grammageGsm, setGrammageGsm] = useState('')
  const [cellWarpMm, setCellWarpMm] = useState('')
  const [cellWeftMm, setCellWeftMm] = useState('')
  const [strengthWarpN, setStrengthWarpN] = useState('')
  const [strengthWeftN, setStrengthWeftN] = useState('')
  const [resultText, setResultText] = useState('')
  const [controllerName, setControllerName] = useState('')

  const live = useMemo(
    () =>
      computeIncomingControl({
        kind,
        ph: num(ph),
        phMin: num(phMin),
        phMax: num(phMax),
        drySolidsPct: num(drySolidsPct),
        passportDrySolidsPct: num(passportDry),
        grammageGsm: num(grammageGsm),
        cellWarpMm: num(cellWarpMm),
        cellWeftMm: num(cellWeftMm),
        strengthWarpN: num(strengthWarpN),
        strengthWeftN: num(strengthWeftN),
      }),
    [
      kind,
      ph,
      phMin,
      phMax,
      drySolidsPct,
      passportDry,
      grammageGsm,
      cellWarpMm,
      cellWeftMm,
      strengthWarpN,
      strengthWeftN,
    ],
  )

  function save() {
    if (!itemName.trim()) return
    onSave({
      kind,
      supplier: supplier.trim(),
      containerNo: containerNo || undefined,
      itemName: itemName.trim(),
      receiptDate: receiptDate || undefined,
      batchNo: batchNo || undefined,
      manufacturedAt: manufacturedAt || undefined,
      ph: num(ph),
      phMin: num(phMin),
      phMax: num(phMax),
      drySolidsPct: num(drySolidsPct),
      passportDrySolidsPct: num(passportDry),
      grammageGsm: num(grammageGsm),
      cellWarpMm: num(cellWarpMm),
      cellWeftMm: num(cellWeftMm),
      strengthWarpN: num(strengthWarpN),
      strengthWeftN: num(strengthWeftN),
      resultText: resultText || live.summary,
      controllerName: controllerName || undefined,
    })
  }

  const rows = [...store.incomingControls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card title={t('technologist.qc.incoming.title')} description={t('technologist.qc.incoming.hint')}>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['chemistry', 'fabric', 'other'] as IncomingMaterialKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`rounded-sm px-3 py-1.5 text-sm ${kind === k ? 'bg-accent text-white' : 'border border-grid bg-white'}`}
              onClick={() => setKind(k)}
            >
              {t(`technologist.qc.incoming.kind.${k}`)}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('technologist.qc.incoming.supplier')}>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.container')}>
            <Input value={containerNo} onChange={(e) => setContainerNo(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.item')}>
            <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.receiptDate')}>
            <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.controlDate')}>
            <Input type="date" value={controlDate} onChange={(e) => setControlDate(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.batchNo')}>
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.mfgDate')}>
            <Input type="date" value={manufacturedAt} onChange={(e) => setManufacturedAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.incoming.controller')}>
            <Input value={controllerName} onChange={(e) => setControllerName(e.target.value)} />
          </FormField>
        </div>

        {kind === 'chemistry' && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <FormField label="pH">
              <Input value={ph} onChange={(e) => setPh(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.phMin')}>
              <Input value={phMin} onChange={(e) => setPhMin(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.phMax')}>
              <Input value={phMax} onChange={(e) => setPhMax(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.drySolids')}>
              <Input value={drySolidsPct} onChange={(e) => setDrySolidsPct(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.passportDry')}>
              <Input value={passportDry} onChange={(e) => setPassportDry(e.target.value)} />
            </FormField>
          </div>
        )}

        {kind === 'fabric' && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <FormField label={t('technologist.qc.incoming.grammage')}>
              <Input value={grammageGsm} onChange={(e) => setGrammageGsm(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.cellWarp')}>
              <Input value={cellWarpMm} onChange={(e) => setCellWarpMm(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.cellWeft')}>
              <Input value={cellWeftMm} onChange={(e) => setCellWeftMm(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.strengthWarp')}>
              <Input value={strengthWarpN} onChange={(e) => setStrengthWarpN(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.qc.incoming.strengthWeft')}>
              <Input value={strengthWeftN} onChange={(e) => setStrengthWeftN(e.target.value)} />
            </FormField>
          </div>
        )}

        <FormField className="mt-4" label={t('technologist.qc.incoming.result')}>
          <Input value={resultText} onChange={(e) => setResultText(e.target.value)} placeholder={live.summary} />
        </FormField>

        <div className="mt-3 flex items-center gap-2 text-sm">
          {t('technologist.qc.status')}:{' '}
          <QcStatusBadge status={live.status} label={qcStatusLabel(live.status, locale)} />
          {live.drySolidsDeviationPct != null && (
            <span className="text-xs text-stone-500">
              {t('technologist.qc.incoming.deviation')}: {live.drySolidsDeviationPct}%
            </span>
          )}
        </div>

        <div className="mt-4">
          <Button onClick={save} disabled={!itemName.trim()}>
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
                  <th>{t('technologist.qc.incoming.item')}</th>
                  <th>{t('technologist.qc.incoming.supplier')}</th>
                  <th>{t('technologist.qc.incoming.controlDate')}</th>
                  <th>{t('technologist.qc.incoming.result')}</th>
                  <th>{t('technologist.qc.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.itemName}</td>
                    <td>{r.supplier || '—'}</td>
                    <td>{r.controlDate || r.receiptDate || '—'}</td>
                    <td className="max-w-xs truncate text-xs">{r.resultText || r.computed.summary}</td>
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
