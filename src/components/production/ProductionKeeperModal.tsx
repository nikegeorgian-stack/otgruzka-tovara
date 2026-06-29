import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { emptyPackaging } from '@/lib/production/init'
import { summarizeRequest } from '@/lib/production/stats'
import {
  categoryLabel,
  PACKAGING_SECTIONS,
  PRODUCTION_CATEGORIES,
  PRODUCTION_LINES,
  type PackagingRow,
  type PackagingSectionKey,
  type ProductionCategoryCell,
  type ProductionCategoryKey,
  type ProductionRequest,
} from '@/lib/production/types'
import type { Employee } from '@/lib/types'

type Props = {
  request: ProductionRequest
  employees: Employee[]
  brigadeNamesKa: Record<string, string>
  onClose: () => void
  onSave: (r: ProductionRequest) => void
  onPost: (r: ProductionRequest) => void
}

export function ProductionKeeperModal({
  request: initial,
  employees,
  brigadeNamesKa,
  onClose,
  onSave,
  onPost,
}: Props) {
  const { t, locale, employeeName } = useI18n()
  const [form, setForm] = useState<ProductionRequest>(() => ({
    ...initial,
    factRows: initial.factRows.map((r) => ({ ...r })),
    packaging: initial.packaging
      ? {
          ...initial.packaging,
          rolls: initial.packaging.rolls.map((r) => ({ ...r })),
          boxes: initial.packaging.boxes.map((r) => ({ ...r })),
          pallets: initial.packaging.pallets.map((r) => ({ ...r })),
        }
      : undefined,
  }))

  const summary = summarizeRequest(form)
  const line = PRODUCTION_LINES.find((l) => l.id === form.lineId)
  const foreman = employees.find((e) => e.id === form.foremanId)

  function updateCell(
    rowIdx: number,
    cat: ProductionCategoryKey,
    field: keyof ProductionCategoryCell,
    value: string,
  ) {
    setForm((f) => {
      const rows = [...f.factRows]
      const row = { ...rows[rowIdx] }
      const cell = { ...row[cat] }
      if (field === 'note') cell.note = value || undefined
      else cell[field] = value === '' ? undefined : Number(value)
      row[cat] = cell
      rows[rowIdx] = row
      return { ...f, factRows: rows }
    })
  }

  function updatePackagingRow(
    section: PackagingSectionKey,
    idx: number,
    patch: Partial<PackagingRow>,
  ) {
    setForm((f) => {
      const p = f.packaging ?? emptyPackaging()
      const rows = [...p[section]]
      rows[idx] = { ...rows[idx], ...patch }
      return { ...f, packaging: { ...p, [section]: rows } }
    })
  }

  const content = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-900/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-sm bg-white shadow-sm">
        <div className="border-b border-grid px-5 py-4">
          <h2 className="text-lg font-bold">{t('warehouse.production.modalTitle')}</h2>
          <p className="mt-1 text-sm text-stone-500">
            {form.date} · {locale === 'ka' ? line?.labelKa : line?.labelRu} ·{' '}
            {brigadeLabel(form.brigadeName, brigadeNamesKa, locale)}
            {foreman ? ` · ${employeeName(foreman)}` : ''}
          </p>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {form.lineId === 'pack' && form.packaging ? (
            PACKAGING_SECTIONS.map((section) => (
              <div key={section.key} className="mb-4">
                <h3 className="mb-2 text-xs font-bold uppercase text-stone-500">
                  {t(`production.pack.${section.key}`)}
                </h3>
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className="border border-grid px-2 py-1">{t('production.pack.name')}</th>
                      <th className="border border-grid w-24 px-2 py-1">
                        {t('production.pack.factQty')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.packaging![section.key].map((row, idx) => (
                      <tr key={row.id}>
                        <td className="border border-grid px-2 py-1">{row.name || '—'}</td>
                        <td className="border border-grid p-0">
                          <input
                            type="number"
                            min={0}
                            className="w-full border-0 px-2 py-1 text-right font-mono"
                            value={row.factQty ?? ''}
                            onChange={(e) =>
                              updatePackagingRow(section.key, idx, {
                                factQty: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50 text-stone-500">
                    <th className="border border-grid px-2 py-1">№</th>
                    {PRODUCTION_CATEGORIES.map((cat) => (
                      <th key={cat.key} className="border border-grid px-2 py-1" colSpan={2}>
                        {categoryLabel(cat.key, form.lineId, locale)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.factRows.map((row, rowIdx) => (
                    <tr key={row.id}>
                      <td className="border border-grid px-2 py-1 text-center">{rowIdx + 1}</td>
                      {PRODUCTION_CATEGORIES.map((cat) => (
                        <>
                          <td key={`${cat.key}-mp`} className="border border-grid p-0">
                            <input
                              type="number"
                              min={0}
                              className="w-full border-0 px-1 py-1 text-right font-mono"
                              value={row[cat.key].qtyMp ?? ''}
                              onChange={(e) =>
                                updateCell(rowIdx, cat.key, 'qtyMp', e.target.value)
                              }
                            />
                          </td>
                          <td key={`${cat.key}-n`} className="border border-grid p-0">
                            {cat.key === 'defect' ? (
                              <input
                                type="number"
                                min={0}
                                className="w-full border-0 px-1 py-1 text-right font-mono"
                                value={row.defect.qtyKg ?? ''}
                                onChange={(e) =>
                                  updateCell(rowIdx, cat.key, 'qtyKg', e.target.value)
                                }
                              />
                            ) : (
                              <input
                                className="w-full border-0 px-1 py-1"
                                value={row[cat.key].note ?? ''}
                                onChange={(e) =>
                                  updateCell(rowIdx, cat.key, 'note', e.target.value)
                                }
                              />
                            )}
                          </td>
                        </>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-sm text-stone-600">
            {t('production.factLabel')}: <strong>{summary.factMp}</strong> {t('production.unitMp')}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-grid px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => onSave({ ...form, status: 'saved' })}>
            {t('common.save')}
          </Button>
          <Button onClick={() => onPost({ ...form, status: 'saved' })}>
            {t('production.postWarehouse')}
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
