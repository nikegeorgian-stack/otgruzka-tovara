import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { computeEadCalculation } from '@/lib/technologist/calc'
import type {
  CellSizeInputMode,
  EadCalculationRecord,
  EadZoneKey,
  TechnologistQcStore,
} from '@/lib/technologist/types'

const ZONES: { key: EadZoneKey; labelKey: string }[] = [
  { key: 'edgeLeft', labelKey: 'technologist.qc.eadCalc.zoneLeft' },
  { key: 'middle', labelKey: 'technologist.qc.eadCalc.zoneMiddle' },
  { key: 'edgeRight', labelKey: 'technologist.qc.eadCalc.zoneRight' },
]

type Props = {
  store: TechnologistQcStore
  operatorName?: string
  onSave: (entry: Omit<EadCalculationRecord, 'computed' | 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
}

function parseNums(raw: string): number[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => parseFloat(s.replace(',', '.')))
    .filter((n) => Number.isFinite(n))
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function TechnologistEadCalcPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t } = useI18n()
  const [productType, setProductType] = useState('')
  const [substrateName, setSubstrateName] = useState('')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [testedAt, setTestedAt] = useState('')
  const [cellSizeMode, setCellSizeMode] = useState<CellSizeInputMode>('instrument')
  const [subWarp, setSubWarp] = useState('')
  const [subWeft, setSubWeft] = useState('')
  const [openWarp, setOpenWarp] = useState('')
  const [openWeft, setOpenWeft] = useState('')
  const [zones, setZones] = useState<Record<EadZoneKey, { m0: string; m1: string; m2: string }>>({
    edgeLeft: { m0: '', m1: '', m2: '' },
    middle: { m0: '', m1: '', m2: '' },
    edgeRight: { m0: '', m1: '', m2: '' },
  })

  const live = useMemo(
    () =>
      computeEadCalculation({
        cellSizeMode,
        substrateCellWarp: parseNums(subWarp),
        substrateCellWeft: parseNums(subWeft),
        openCellWarp: parseNums(openWarp),
        openCellWeft: parseNums(openWeft),
        zones: {
          edgeLeft: { m0: num(zones.edgeLeft.m0), m1: num(zones.edgeLeft.m1), m2: num(zones.edgeLeft.m2) },
          middle: { m0: num(zones.middle.m0), m1: num(zones.middle.m1), m2: num(zones.middle.m2) },
          edgeRight: { m0: num(zones.edgeRight.m0), m1: num(zones.edgeRight.m1), m2: num(zones.edgeRight.m2) },
        },
      }),
    [cellSizeMode, subWarp, subWeft, openWarp, openWeft, zones],
  )

  function save() {
    if (!productType.trim()) return
    onSave({
      productType: productType.trim(),
      substrateName: substrateName.trim(),
      manufacturedAt: manufacturedAt || undefined,
      testedAt: testedAt || undefined,
      cellSizeMode,
      substrateCellWarp: parseNums(subWarp),
      substrateCellWeft: parseNums(subWeft),
      openCellWarp: parseNums(openWarp),
      openCellWeft: parseNums(openWeft),
      zones: {
        edgeLeft: { m0: num(zones.edgeLeft.m0), m1: num(zones.edgeLeft.m1), m2: num(zones.edgeLeft.m2) },
        middle: { m0: num(zones.middle.m0), m1: num(zones.middle.m1), m2: num(zones.middle.m2) },
        edgeRight: { m0: num(zones.edgeRight.m0), m1: num(zones.edgeRight.m1), m2: num(zones.edgeRight.m2) },
      },
      createdByName: operatorName,
    })
  }

  const rows = [...store.eadCalculations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card title={t('technologist.qc.eadCalc.title')} description={t('technologist.qc.eadCalc.hint')}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('technologist.qc.eadCalc.product')}>
            <Input value={productType} onChange={(e) => setProductType(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.substrate')}>
            <Input value={substrateName} onChange={(e) => setSubstrateName(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.mfgDate')}>
            <Input type="date" value={manufacturedAt} onChange={(e) => setManufacturedAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.testDate')}>
            <Input type="date" value={testedAt} onChange={(e) => setTestedAt(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.cellMode')}>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={cellSizeMode}
              onChange={(e) => setCellSizeMode(e.target.value as CellSizeInputMode)}
            >
              <option value="instrument">{t('technologist.qc.eadCalc.modeInstrument')}</option>
              <option value="manual">{t('technologist.qc.eadCalc.modeManual')}</option>
            </select>
          </FormField>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FormField label={t('technologist.qc.eadCalc.subCellWarp')} hint={t('technologist.qc.eadCalc.readingsHint')}>
            <Input value={subWarp} onChange={(e) => setSubWarp(e.target.value)} placeholder="9962, 9975, 9963" />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.subCellWeft')}>
            <Input value={subWeft} onChange={(e) => setSubWeft(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.openCellWarp')}>
            <Input value={openWarp} onChange={(e) => setOpenWarp(e.target.value)} />
          </FormField>
          <FormField label={t('technologist.qc.eadCalc.openCellWeft')}>
            <Input value={openWeft} onChange={(e) => setOpenWeft(e.target.value)} />
          </FormField>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="bg-stone-50 text-stone-600">
                <th className="border border-grid px-2 py-1">{t('technologist.qc.eadCalc.zone')}</th>
                <th className="border border-grid px-2 py-1">m0</th>
                <th className="border border-grid px-2 py-1">m1</th>
                <th className="border border-grid px-2 py-1">m2</th>
                <th className="border border-grid px-2 py-1">H1</th>
              </tr>
            </thead>
            <tbody>
              {ZONES.map(({ key, labelKey }) => (
                <tr key={key}>
                  <td className="border border-grid px-2 py-1 font-medium">{t(labelKey)}</td>
                  {(['m0', 'm1', 'm2'] as const).map((f) => (
                    <td key={f} className="border border-grid p-0">
                      <input
                        className="w-full border-0 px-2 py-1 font-mono"
                        value={zones[key][f]}
                        onChange={(e) =>
                          setZones((z) => ({ ...z, [key]: { ...z[key], [f]: e.target.value } }))
                        }
                      />
                    </td>
                  ))}
                  <td className="border border-grid px-2 py-1 text-right font-mono">
                    {live.zoneH1[key] != null ? live.zoneH1[key]!.toFixed(4) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 rounded-sm bg-stone-50 p-3 text-sm md:grid-cols-3">
          <div>
            {t('technologist.qc.eadCalc.cellResult')}:{' '}
            <strong>
              {live.substrateCellWarpMm ?? '—'} × {live.substrateCellWeftMm ?? '—'} мм
            </strong>
          </div>
          <div>
            {t('technologist.qc.eadCalc.organic')}:{' '}
            <strong>{live.avgOrganicContent != null ? live.avgOrganicContent.toFixed(4) : '—'}</strong>
          </div>
          <div>
            {t('technologist.qc.eadCalc.moisture')}:{' '}
            <strong>{live.avgResidualMoisture != null ? live.avgResidualMoisture.toFixed(4) : '—'}</strong>
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={save} disabled={!productType.trim()}>
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
                  <th>{t('technologist.qc.eadCalc.product')}</th>
                  <th>{t('technologist.qc.eadCalc.substrate')}</th>
                  <th>{t('technologist.qc.eadCalc.testDate')}</th>
                  <th className="text-right">{t('technologist.qc.eadCalc.organic')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.productType}</td>
                    <td>{r.substrateName || '—'}</td>
                    <td>{r.testedAt || r.manufacturedAt || '—'}</td>
                    <td className="text-right font-mono">
                      {r.computed.avgOrganicContent?.toFixed(4) ?? '—'}
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
