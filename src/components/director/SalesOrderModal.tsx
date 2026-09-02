import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { CloseIcon } from '@/components/ui/icons'
import { useI18n } from '@/context/I18nContext'
import { formatCounterpartyCode } from '@/lib/counterparties/init'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { newId } from '@/lib/production/files'
import { emptySalesLine } from '@/lib/sales/init'
import { areaM2ToQtyMp } from '@/lib/sales/presets'
import type { SalesOrder, SalesOrderLine } from '@/lib/sales/types'

type Props = {
  order: SalesOrder
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  onSave: (order: SalesOrder) => void
  onClose: () => void
  onUpsertCounterparty?: (c: Counterparty) => void
  onOpenCounterpartiesJournal?: () => void
}

function nextCustomerCode(items: Counterparty[]): string {
  const max = items.reduce((m, c) => {
    const match = c.code.match(/(\d+)\s*$/)
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return formatCounterpartyCode(max + 1)
}

const SELECT_CLASS =
  'fc-input w-full rounded-md border-stone-200 bg-white text-sm shadow-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30'

export function SalesOrderModal({
  order,
  counterparties,
  finishedProducts,
  onSave,
  onClose,
  onUpsertCounterparty,
  onOpenCounterpartiesJournal,
}: Props) {
  const { t, tf } = useI18n()
  const [draft, setDraft] = useState<SalesOrder>(order)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [customerMode, setCustomerMode] = useState<'select' | 'new'>('select')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')

  const customers = counterparties.filter(
    (c) => c.active && (c.role === 'customer' || c.role === 'both'),
  )
  const products = finishedProducts.filter((p) => p.active)
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: `${c.code} · ${c.name}`,
      })),
    [customers],
  )

  const totals = useMemo(() => {
    const lines = draft.lines.filter((l) => l.productName.trim() || l.qtyMp > 0)
    const qtyMp = lines.reduce((s, l) => s + (Number(l.qtyMp) || 0), 0)
    const area = lines.reduce((s, l) => s + (Number(l.qtyAreaM2) || 0), 0)
    return { count: lines.length, qtyMp, area }
  }, [draft.lines])

  function markDirty() {
    setDirty(true)
    setError(null)
  }

  function patch(p: Partial<SalesOrder>) {
    markDirty()
    setDraft((d) => ({ ...d, ...p }))
  }

  function patchLine(id: string, p: Partial<SalesOrderLine>) {
    markDirty()
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, ...p } : l)),
    }))
  }

  function selectCustomer(id: string) {
    const c = customers.find((x) => x.id === id)
    patch({ counterpartyId: id || undefined, customer: c?.name ?? draft.customer })
  }

  function createCustomerAndSelect() {
    if (!onUpsertCounterparty) return
    const name = newCustomerName.trim()
    if (!name) {
      setError(t('counterparty.errName'))
      return
    }
    const now = new Date().toISOString()
    const cp: Counterparty = {
      id: newId(),
      code: nextCustomerCode(counterparties),
      name,
      role: 'customer',
      phone: newCustomerPhone.trim() || undefined,
      countryCode: 'GE',
      bankAccounts: [],
      contracts: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    }
    onUpsertCounterparty(cp)
    patch({ counterpartyId: cp.id, customer: cp.name })
    setCustomerMode('select')
    setNewCustomerName('')
    setNewCustomerPhone('')
    setError(null)
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
    markDirty()
    setDraft((d) => ({ ...d, lines: [...d.lines, emptySalesLine()] }))
  }

  function removeLine(id: string) {
    markDirty()
    setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }))
  }

  function handleSave() {
    if (!draft.customer.trim() && !draft.counterpartyId) {
      setError(t('sales.modal.noCustomer'))
      return
    }
    const validLines = draft.lines.filter((l) => l.productName.trim() && l.qtyMp > 0)
    if (validLines.length === 0) {
      setError(t('sales.modal.noLines'))
      return
    }
    setDirty(false)
    onSave({ ...draft, lines: validLines })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      size="preview"
      dirty={dirty}
      onSaveDirty={handleSave}
      title={draft.orderNumber ? t('sales.modal.editTitle') : t('sales.modal.newTitle')}
      subtitle={draft.orderNumber || undefined}
      initialFocus="none"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span className="rounded-md bg-stone-100 px-2.5 py-1 font-medium text-stone-700">
              {tf('sales.modal.linesCount', { count: String(totals.count) })}
            </span>
            {totals.qtyMp > 0 && (
              <span className="tabular-nums">
                {tf('sales.modal.totalMp', { qty: String(Math.round(totals.qtyMp)) })}
              </span>
            )}
            {totals.area > 0 && (
              <span className="tabular-nums">
                {tf('sales.modal.totalArea', { qty: String(Math.round(totals.area)) })}
              </span>
            )}
            {error && <span className="font-medium text-red-600">{error}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} data-coach="director:orderSave">
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-5">
        {/* Шапка заказа */}
        <section className="rounded-xl border border-stone-200/80 bg-gradient-to-br from-stone-50 to-white p-4 shadow-sm">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-stone-400">
            {t('sales.modal.sectionHeader')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-2" data-coach="director:orderCustomer">
              {customerMode === 'select' ? (
                <>
                  <DirectoryFieldPicker
                    label={t('sales.field.customer')}
                    hint={t('sales.customer.pickHint')}
                    value={draft.counterpartyId ?? ''}
                    placeholder={t('sales.customer.pickPlaceholder')}
                    options={customerOptions}
                    onChange={selectCustomer}
                    onAdd={() => onOpenCounterpartiesJournal?.()}
                  />
                  <div className="mt-2 flex flex-wrap gap-3">
                    {onUpsertCounterparty ? (
                      <button
                        type="button"
                        className="text-sm font-semibold text-teal-700 hover:underline"
                        data-coach="director:orderAddCustomer"
                        onClick={() => {
                          setCustomerMode('new')
                          setError(null)
                        }}
                      >
                        + {t('sales.customer.createNew')}
                      </button>
                    ) : null}
                    {onOpenCounterpartiesJournal ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-stone-500 hover:underline"
                        onClick={() => onOpenCounterpartiesJournal()}
                      >
                        {t('sales.customer.openJournal')}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-800">
                    {t('sales.customer.createNew')}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FormField label={`${t('sales.field.customer')} *`} className="sm:col-span-2">
                      <Input
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        placeholder={t('sales.customer.namePh')}
                        autoFocus
                      />
                    </FormField>
                    <FormField label={t('sales.customer.phone')}>
                      <Input
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        placeholder="+995…"
                      />
                    </FormField>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={createCustomerAndSelect}>
                      {t('sales.customer.addAndSelect')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setCustomerMode('select')
                        setNewCustomerName('')
                        setNewCustomerPhone('')
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <FormField label={t('sales.field.priority')}>
              <select
                className={SELECT_CLASS}
                value={draft.priority}
                onChange={(e) =>
                  patch({ priority: e.target.value === 'urgent' ? 'urgent' : 'normal' })
                }
              >
                <option value="normal">{t('sales.priority.normal')}</option>
                <option value="urgent">{t('sales.priority.urgent')}</option>
              </select>
            </FormField>
            <FormField label={t('sales.field.orderDate')}>
              <Input
                type="date"
                value={draft.orderDate}
                onChange={(e) => patch({ orderDate: e.target.value })}
              />
            </FormField>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label={t('sales.field.dueDate')}>
              <Input
                type="date"
                value={draft.dueDate ?? ''}
                onChange={(e) => patch({ dueDate: e.target.value || undefined })}
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
            <FormField label={t('sales.field.region')}>
              <Input
                value={draft.region ?? ''}
                onChange={(e) => patch({ region: e.target.value || undefined })}
                placeholder={t('sales.field.regionHint')}
              />
            </FormField>
            <FormField label={t('sales.field.logistics')}>
              <Input
                value={draft.logistics ?? ''}
                onChange={(e) => patch({ logistics: e.target.value || undefined })}
                placeholder={t('sales.field.logisticsHint')}
              />
            </FormField>
          </div>
        </section>

        {/* Позиции — карточки */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              {t('sales.modal.lines')}
            </h3>
            <Button variant="secondary" size="sm" onClick={addLine}>
              + {t('sales.modal.addLine')}
            </Button>
          </div>

          <div className="space-y-3">
            {draft.lines.map((line, index) => (
              <article
                key={line.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-teal-200/80"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-teal-50 px-2 text-xs font-bold text-teal-800">
                    {index + 1}
                  </span>
                  {draft.lines.length > 1 && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={t('common.delete')}
                      onClick={() => removeLine(line.id)}
                    >
                      <CloseIcon size={16} />
                    </button>
                  )}
                </div>

                <div className="grid gap-3 lg:grid-cols-12">
                  <div className="space-y-2 lg:col-span-5">
                    <FormField label={t('sales.col.product')}>
                      <select
                        className={SELECT_CLASS}
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
                    </FormField>
                    {!line.finishedProductId && (
                      <Input
                        placeholder={t('sales.col.productNameHint')}
                        value={line.productName}
                        onChange={(e) => patchLine(line.id, { productName: e.target.value })}
                      />
                    )}
                    {line.finishedProductId && (
                      <p className="truncate text-xs text-stone-500">{line.productName}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 lg:col-span-3">
                    <FormField label={t('sales.col.areaM2')}>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="text-right tabular-nums"
                        value={line.qtyAreaM2 ?? ''}
                        onChange={(e) =>
                          patchLineQtyFromArea(
                            line.id,
                            Number(e.target.value) || 0,
                            line.rollWidthM,
                          )
                        }
                      />
                    </FormField>
                    <FormField label={t('sales.col.qty')}>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="text-right tabular-nums"
                        value={line.qtyMp || ''}
                        onChange={(e) =>
                          patchLine(line.id, { qtyMp: Number(e.target.value) || 0 })
                        }
                      />
                    </FormField>
                    <FormField label={t('sales.col.gsm')}>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="text-right tabular-nums"
                        value={line.targetGsm ?? ''}
                        onChange={(e) =>
                          patchLine(line.id, {
                            targetGsm: Number(e.target.value) || undefined,
                          })
                        }
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-2">
                    <FormField label={t('sales.col.label')}>
                      <select
                        className={SELECT_CLASS}
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
                    </FormField>
                    <FormField label={t('sales.col.preferLine')}>
                      <select
                        className={SELECT_CLASS}
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
                        <option value="pack">{t('sales.line.pack')}</option>
                      </select>
                    </FormField>
                    {(line.labelType === 'ours' || line.labelType === 'customer') && (
                      <FormField label={t('sales.col.labelNote')} className="sm:col-span-2">
                        <Input
                          placeholder={t('sales.col.labelNote')}
                          value={line.labelNote ?? ''}
                          onChange={(e) => patchLine(line.id, { labelNote: e.target.value })}
                        />
                      </FormField>
                    )}
                    <FormField label={t('common.note')} className="sm:col-span-2">
                      <Input
                        value={line.note ?? ''}
                        onChange={(e) => patchLine(line.id, { note: e.target.value })}
                      />
                    </FormField>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <FormField label={t('sales.modal.orderNote')}>
          <Input
            value={draft.note ?? ''}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder={t('sales.modal.orderNoteHint')}
          />
        </FormField>
      </div>
    </AppDialog>
  )
}
