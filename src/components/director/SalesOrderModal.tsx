import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { emptySalesLine } from '@/lib/sales/init'
import { areaM2ToQtyMp } from '@/lib/sales/presets'
import type { SalesOrder, SalesOrderLine } from '@/lib/sales/types'

type Props = {
  order: SalesOrder
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  onSave: (order: SalesOrder) => void
  onClose: () => void
}

export function SalesOrderModal({
  order,
  counterparties,
  finishedProducts,
  onSave,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<SalesOrder>(order)
  const [error, setError] = useState<string | null>(null)

  const customers = counterparties.filter(
    (c) => c.active && (c.role === 'customer' || c.role === 'both'),
  )
  const products = finishedProducts.filter((p) => p.active)

  function patch(p: Partial<SalesOrder>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  function patchLine(id: string, p: Partial<SalesOrderLine>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, ...p } : l)),
    }))
  }

  function selectCustomer(id: string) {
    const c = customers.find((x) => x.id === id)
    patch({ counterpartyId: id || undefined, customer: c?.name ?? draft.customer })
  }

  function selectProduct(lineId: string, productId: string) {
    const p = products.find((x) => x.id === productId)
    if (!p) {
      patchLine(lineId, { finishedProductId: undefined })
      return
    }
    patchLine(lineId, {
      finishedProductId: p.id,
      productName: p.name,
      category: p.category,
      colorLogo: p.colorLogo,
      productColor: p.productColor,
      targetGsm: p.grammageGsm,
      rollWidthM: p.rollWidthM,
    })
  }

  function patchLineQtyFromArea(lineId: string, areaM2: number, rollWidthM?: number) {
    const line = draft.lines.find((l) => l.id === lineId)
    const width = rollWidthM ?? line?.rollWidthM
    const qtyMp = width && width > 0 ? areaM2ToQtyMp(areaM2, width) : line?.qtyMp ?? 0
    patchLine(lineId, { qtyAreaM2: areaM2 || undefined, qtyMp })
  }

  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, emptySalesLine()] }))
  }

  function removeLine(id: string) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }))
  }

  function handleSave() {
    if (!draft.customer.trim()) {
      setError(t('sales.modal.noCustomer'))
      return
    }
    const validLines = draft.lines.filter((l) => l.productName.trim() && l.qtyMp > 0)
    if (validLines.length === 0) {
      setError(t('sales.modal.noLines'))
      return
    }
    onSave({ ...draft, lines: validLines })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      size="xl"
      title={draft.orderNumber ? t('sales.modal.editTitle') : t('sales.modal.newTitle')}
      subtitle={draft.orderNumber || undefined}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('sales.field.customer')}>
            <select
              className="fc-input"
              value={draft.counterpartyId ?? ''}
              onChange={(e) => selectCustomer(e.target.value)}
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('sales.field.orderDate')}>
            <Input
              type="date"
              value={draft.orderDate}
              onChange={(e) => patch({ orderDate: e.target.value })}
            />
          </FormField>
          <FormField label={t('sales.field.dueDate')}>
            <Input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(e) => patch({ dueDate: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('sales.field.priority')}>
            <select
              className="fc-input"
              value={draft.priority}
              onChange={(e) =>
                patch({ priority: e.target.value === 'urgent' ? 'urgent' : 'normal' })
              }
            >
              <option value="normal">{t('sales.priority.normal')}</option>
              <option value="urgent">{t('sales.priority.urgent')}</option>
            </select>
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('sales.field.region')}>
            <Input
              value={draft.region ?? ''}
              onChange={(e) => patch({ region: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('sales.field.logistics')}>
            <Input
              value={draft.logistics ?? ''}
              onChange={(e) => patch({ logistics: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('sales.field.suggestedStart')}>
            <Input
              type="date"
              value={draft.suggestedProductionStart ?? ''}
              onChange={(e) =>
                patch({ suggestedProductionStart: e.target.value || undefined })
              }
            />
          </FormField>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-stone-700">{t('sales.modal.lines')}</h4>
            <Button variant="secondary" size="sm" onClick={addLine}>
              {t('sales.modal.addLine')}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('sales.col.product')}</th>
                  <th className="text-right">{t('sales.col.areaM2')}</th>
                  <th className="text-right">{t('sales.col.qty')}</th>
                  <th className="text-right">{t('sales.col.gsm')}</th>
                  <th>{t('sales.col.label')}</th>
                  <th>{t('sales.col.preferLine')}</th>
                  <th>{t('common.note')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="min-w-[220px]">
                      <select
                        className="fc-input"
                        value={line.finishedProductId ?? ''}
                        onChange={(e) => selectProduct(line.id, e.target.value)}
                      >
                        <option value="">{t('sales.col.manualProduct')}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </option>
                        ))}
                      </select>
                      {!line.finishedProductId && (
                        <Input
                          className="mt-1"
                          placeholder={t('sales.col.product')}
                          value={line.productName}
                          onChange={(e) => patchLine(line.id, { productName: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-24 text-right"
                        value={line.qtyAreaM2 ?? ''}
                        onChange={(e) =>
                          patchLineQtyFromArea(
                            line.id,
                            Number(e.target.value) || 0,
                            line.rollWidthM,
                          )
                        }
                      />
                    </td>
                    <td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-24 text-right"
                        value={line.qtyMp || ''}
                        onChange={(e) =>
                          patchLine(line.id, { qtyMp: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-20 text-right"
                        value={line.targetGsm ?? ''}
                        onChange={(e) =>
                          patchLine(line.id, {
                            targetGsm: Number(e.target.value) || undefined,
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="fc-input mb-1 w-full min-w-[120px]"
                        value={line.labelType ?? 'none'}
                        onChange={(e) =>
                          patchLine(line.id, {
                            labelType: e.target.value as SalesOrderLine['labelType'],
                          })
                        }
                      >
                        <option value="none">{t('sales.label.none')}</option>
                        <option value="ours">{t('sales.label.ours')}</option>
                        <option value="customer">{t('sales.label.customer')}</option>
                      </select>
                      <Input
                        placeholder={t('sales.col.labelNote')}
                        value={line.labelNote ?? ''}
                        onChange={(e) => patchLine(line.id, { labelNote: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="fc-input w-24"
                        value={line.preferredLineId ?? ''}
                        onChange={(e) =>
                          patchLine(line.id, {
                            preferredLineId: (e.target.value || undefined) as
                              | SalesOrderLine['preferredLineId'],
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </td>
                    <td>
                      <Input
                        value={line.note ?? ''}
                        onChange={(e) => patchLine(line.id, { note: e.target.value })}
                      />
                    </td>
                    <td className="text-right">
                      {draft.lines.length > 1 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => removeLine(line.id)}
                        >
                          ✕
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <FormField label={t('common.note')}>
          <Input value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
        </FormField>
      </div>
    </AppDialog>
  )
}
