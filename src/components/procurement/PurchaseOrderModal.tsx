import { useMemo, useState } from 'react'
import { CloseIcon } from '@/components/ui/icons'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { ContainerTrackingPanel } from '@/components/procurement/ContainerTrackingPanel'
import { PurchaseOrderDocumentsTab } from '@/components/procurement/PurchaseOrderDocumentsTab'
import { PurchaseOrderStatusJournalTab } from '@/components/procurement/PurchaseOrderStatusJournalTab'
import { TransportModeBadge } from '@/components/procurement/TransportModeIcon'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import type { DirectorySection } from '@/lib/directories/types'
import { useI18n } from '@/context/I18nContext'
import { countriesSorted, countryLabel, countryLabelByCode } from '@/lib/counterparties/countries'
import { orderTotalAmount } from '@/lib/procurement/codes'
import {
  syncOrderBeforeSave,
  type PendingContract,
  type PendingSupplier,
} from '@/lib/procurement/orderSync'
import { ORDER_STATUS_FLOW } from '@/lib/procurement/status'
import { syncOrderFromCarrier } from '@/lib/procurement/tracking/syncOrder'
import type {
  OrderCategory,
  ProcurementScope,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  ShipmentLeg,
  TransportMode,
} from '@/lib/procurement/types'
import type { Counterparty, CounterpartyStore } from '@/lib/counterparties/types'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type ModalTab = 'main' | 'lines' | 'logistics' | 'documents' | 'tracking' | 'journal'

type Props = {
  order: PurchaseOrder
  isNew: boolean
  counterparties: CounterpartyStore
  warehouse: WarehouseStore
  onClose: () => void
  onUpsertCounterparty: (c: Counterparty) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onNavigateToDirectory: (section: DirectorySection) => void
  onSave: (order: PurchaseOrder, statusNote?: string) => void
  onSyncPersist?: (order: PurchaseOrder) => void
}

const CATEGORIES: OrderCategory[] = [
  'raw_material',
  'packaging',
  'spare_parts',
  'equipment',
  'consumables',
  'other',
]

const TRANSPORTS: TransportMode[] = ['truck', 'rail', 'sea', 'air', 'mixed']

function newLine(): PurchaseOrderLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    unit: 'шт',
    receivedQty: 0,
  }
}

function newLeg(seq: number): ShipmentLeg {
  return {
    id: crypto.randomUUID(),
    sequence: seq,
    transportMode: 'sea',
    origin: '',
    destination: '',
  }
}

export function PurchaseOrderModal({
  order: initial,
  isNew,
  counterparties,
  warehouse,
  onClose,
  onUpsertCounterparty,
  onUpsertWarehouseItem,
  onNavigateToDirectory,
  onSave,
  onSyncPersist,
}: Props) {
  const { t, locale } = useI18n()
  const countryOptions = countriesSorted(locale)
  const [draft, setDraft] = useState<PurchaseOrder>(initial)
  const [tab, setTab] = useState<ModalTab>('main')
  const [error, setError] = useState<string | null>(null)
  const [supplierMode, setSupplierMode] = useState<'select' | 'new'>(() =>
    initial.counterpartyId ? 'select' : 'select',
  )
  const [pickItemId, setPickItemId] = useState('')
  const [statusChangeNote, setStatusChangeNote] = useState('')
  const [journalSyncing, setJournalSyncing] = useState(false)
  const statusChanged = !isNew && draft.status !== initial.status
  const canRefreshJournal = Boolean(
    draft.containerTracking?.reference.trim() &&
      draft.scope === 'international',
  )
  const [pendingSupplier, setPendingSupplier] = useState<PendingSupplier>({
    name: '',
    countryCode: initial.originCountry === 'CN' || initial.scope === 'international' ? 'CN' : 'GE',
  })
  const [showNewContract, setShowNewContract] = useState(false)
  const [pendingContract, setPendingContract] = useState<PendingContract>({
    number: '',
    subject: 'Поставка сырья и материалов',
    signedAt: new Date().toISOString().slice(0, 10),
    currency: initial.currency,
  })
  const [linesToNomenclature, setLinesToNomenclature] = useState<Set<string>>(() => new Set())

  const suppliers = useMemo(
    () =>
      counterparties.items.filter(
        (c) => c.active && (c.role === 'supplier' || c.role === 'both'),
      ),
    [counterparties.items],
  )

  const total = orderTotalAmount(draft)

  const selectedSupplier = useMemo(
    () => counterparties.items.find((c) => c.id === draft.counterpartyId),
    [counterparties.items, draft.counterpartyId],
  )

  const supplierContracts = selectedSupplier?.contracts ?? []

  async function refreshFromCarrier(persist = false) {
    if (!draft.containerTracking?.reference.trim()) return
    setJournalSyncing(true)
    try {
      const result = await syncOrderFromCarrier(draft)
      if (result) {
        setDraft(result.order)
        if (persist) onSyncPersist?.(result.order)
      }
    } finally {
      setJournalSyncing(false)
    }
  }

  function save() {
    if (supplierMode === 'select' && !draft.counterpartyId) {
      setError(t('procurement.err.supplierRequired'))
      setTab('main')
      return
    }
    if (supplierMode === 'new' && !pendingSupplier.name.trim()) {
      setError(t('procurement.err.supplierNameRequired'))
      setTab('main')
      return
    }
    if (showNewContract && !pendingContract.number.trim()) {
      setError(t('procurement.err.contractNumberRequired'))
      setTab('main')
      return
    }
    if (!draft.lines.length || draft.lines.every((l) => !l.name.trim())) {
      setError(t('procurement.err.linesRequired'))
      setTab('lines')
      return
    }
    setError(null)

    const prepared = syncOrderBeforeSave(
      {
        order: {
          ...draft,
          lines: draft.lines.filter((l) => l.name.trim()),
          legs: draft.legs.map((l, i) => ({ ...l, sequence: i + 1 })),
        },
        pendingSupplier: supplierMode === 'new' ? pendingSupplier : null,
        pendingContract: showNewContract ? pendingContract : null,
        linesToNomenclature,
        counterparties: counterparties.items,
        counterpartyStore: counterparties,
        warehouse,
      },
      {
        upsertCounterparty: onUpsertCounterparty,
        upsertWarehouseItem: onUpsertWarehouseItem,
      },
    )

    onSave(
      prepared.order,
      statusChanged ? statusChangeNote.trim() || undefined : undefined,
    )
  }

  function toggleNomenclature(lineId: string, on: boolean) {
    setLinesToNomenclature((prev) => {
      const next = new Set(prev)
      if (on) next.add(lineId)
      else next.delete(lineId)
      return next
    })
  }

  function addLineFromItem(itemId: string) {
    const item = warehouse.items.find((i) => i.id === itemId)
    if (!item) return
    setDraft((d) => ({
      ...d,
      lines: [
        ...d.lines,
        {
          id: crypto.randomUUID(),
          warehouseItemId: item.id,
          name: item.name,
          quantity: 1,
          unit: item.unit,
          receivedQty: 0,
        },
      ],
    }))
  }

  const tabs: { id: ModalTab; label: string }[] = [
    { id: 'main', label: t('procurement.modal.tabMain') },
    { id: 'lines', label: t('procurement.modal.tabLines') },
    { id: 'logistics', label: t('procurement.modal.tabLogistics') },
    { id: 'documents', label: t('procurement.modal.tabDocuments') },
    { id: 'tracking', label: t('procurement.modal.tabTracking') },
    { id: 'journal', label: t('procurement.modal.tabJournal') },
  ]

  return (
    <ModalBackdrop
      open
      onClose={onClose}
      className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
      panelClassName="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm bg-white shadow-sm"
    >
        <div className="flex items-start justify-between gap-4 border-b border-grid px-6 py-4">
          <div>
            <p className="font-mono text-xs font-semibold text-teal-700">{draft.orderNumber}</p>
            <h3 className="text-lg font-bold">
              {isNew ? t('procurement.newOrder') : t('procurement.editOrder')}
            </h3>
            <div className="mt-1">
              <OrderStatusBadge status={draft.status} />
            </div>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            className="text-stone-400 hover:text-stone-600"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-grid px-4">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={`border-b-2 px-4 py-2.5 text-sm font-medium ${
                tab === tb.id
                  ? 'border-teal-600 text-teal-800'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4">
              <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {tab === 'main' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 rounded-sm border border-grid bg-stone-50/60 p-4">
                {supplierMode === 'select' ? (
                  <>
                    <DirectoryFieldPicker
                      label={`${t('procurement.col.supplier')} *`}
                      hint={t('procurement.supplier.pickHint')}
                      value={draft.counterpartyId}
                      placeholder={t('procurement.selectSupplier')}
                      options={suppliers.map((s) => ({
                        value: s.id,
                        label: `${s.code} · ${s.name}${
                          s.countryCode ? ` · ${countryLabelByCode(s.countryCode, locale)}` : ''
                        }`,
                      }))}
                      onChange={(id) =>
                        setDraft({ ...draft, counterpartyId: id, contractId: undefined })
                      }
                      onAdd={() => onNavigateToDirectory('counterparties')}
                    />
                    <button
                      type="button"
                      className="mt-2 text-sm font-semibold text-teal-700 hover:underline"
                      onClick={() => setSupplierMode('new')}
                    >
                      + {t('procurement.supplier.createNew')}
                    </button>
                  </>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
                      {t('procurement.supplier.name')} *
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={pendingSupplier.name}
                        onChange={(e) =>
                          setPendingSupplier({ ...pendingSupplier, name: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-xs font-semibold text-stone-500">
                      {t('procurement.supplier.legalName')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={pendingSupplier.legalName ?? ''}
                        onChange={(e) =>
                          setPendingSupplier({ ...pendingSupplier, legalName: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-xs font-semibold text-stone-500">
                      {t('procurement.col.originCountry')}
                      <select
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={pendingSupplier.countryCode ?? 'CN'}
                        onChange={(e) =>
                          setPendingSupplier({ ...pendingSupplier, countryCode: e.target.value })
                        }
                      >
                        {countryOptions.map((c) => (
                          <option key={c.code} value={c.code}>
                            {countryLabel(c, locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-stone-500">
                      {t('procurement.supplier.taxId')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={pendingSupplier.taxId ?? ''}
                        onChange={(e) =>
                          setPendingSupplier({ ...pendingSupplier, taxId: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-xs font-semibold text-stone-500">
                      {t('procurement.supplier.contact')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={pendingSupplier.contactPerson ?? ''}
                        onChange={(e) =>
                          setPendingSupplier({ ...pendingSupplier, contactPerson: e.target.value })
                        }
                      />
                    </label>
                    <p className="sm:col-span-2 text-[11px] text-teal-700">
                      {t('procurement.supplier.saveHint')}
                    </p>
                    <button
                      type="button"
                      className="sm:col-span-2 text-sm font-semibold text-stone-600 hover:underline"
                      onClick={() => setSupplierMode('select')}
                    >
                      ← {t('procurement.supplier.selectExisting')}
                    </button>
                  </div>
                )}
              </div>

              {supplierMode === 'select' && draft.counterpartyId && (
                <div className="sm:col-span-2 rounded-sm border border-grid p-4">
                  {!showNewContract ? (
                    <>
                      <DirectoryFieldPicker
                        label={t('procurement.col.contract')}
                        hint={t('procurement.contract.pickHint')}
                        value={draft.contractId ?? ''}
                        placeholder={t('procurement.contract.none')}
                        options={supplierContracts.map((c) => ({
                          value: c.id,
                          label: `${c.number} — ${c.subject}${c.signedAt ? ` (${c.signedAt})` : ''}`,
                        }))}
                        onChange={(id) =>
                          setDraft({ ...draft, contractId: id || undefined })
                        }
                        onAdd={() => onNavigateToDirectory('counterparties')}
                      />
                      <button
                        type="button"
                        className="mt-2 text-sm font-semibold text-teal-700 hover:underline"
                        onClick={() => setShowNewContract(true)}
                      >
                        + {t('procurement.contract.createNew')}
                      </button>
                    </>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-sm border border-grid px-3 py-2 text-sm"
                        placeholder={t('procurement.contract.number')}
                        value={pendingContract.number}
                        onChange={(e) =>
                          setPendingContract({ ...pendingContract, number: e.target.value })
                        }
                      />
                      <input
                        type="date"
                        className="rounded-sm border border-grid px-3 py-2 text-sm"
                        value={pendingContract.signedAt}
                        onChange={(e) =>
                          setPendingContract({ ...pendingContract, signedAt: e.target.value })
                        }
                      />
                      <input
                        className="sm:col-span-2 rounded-sm border border-grid px-3 py-2 text-sm"
                        placeholder={t('procurement.contract.subject')}
                        value={pendingContract.subject}
                        onChange={(e) =>
                          setPendingContract({ ...pendingContract, subject: e.target.value })
                        }
                      />
                      <p className="sm:col-span-2 text-[11px] text-teal-700">
                        {t('procurement.contract.saveHint')}
                      </p>
                      <button
                        type="button"
                        className="sm:col-span-2 text-sm font-semibold text-stone-600 hover:underline"
                        onClick={() => setShowNewContract(false)}
                      >
                        ← {t('procurement.contract.pickExisting')}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.scope')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.scope}
                  onChange={(e) => {
                    const scope = e.target.value as ProcurementScope
                    setDraft((d) => ({
                      ...d,
                      scope,
                      currency: scope === 'international' ? d.currency || 'CNY' : d.currency || 'GEL',
                      originCountry: scope === 'international' ? d.originCountry || 'CN' : d.originCountry,
                    }))
                  }}
                >
                  <option value="domestic">{t('procurement.scope.domestic')}</option>
                  <option value="international">{t('procurement.scope.international')}</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.category')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value as OrderCategory })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`procurement.category.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <label className="block text-xs font-semibold text-stone-500">
                  {t('procurement.col.status')}
                  <select
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value as PurchaseOrderStatus })
                    }
                  >
                    {ORDER_STATUS_FLOW.concat('cancelled').map((s) => (
                      <option key={s} value={s}>
                        {t(`procurement.status.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {statusChanged && (
                  <label className="mt-2 block text-xs font-semibold text-amber-700">
                    {t('procurement.statusChangeNote')}
                    <input
                      className="mt-1 w-full rounded-sm border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm text-stone-800"
                      value={statusChangeNote}
                      placeholder={t('procurement.statusChangeNotePlaceholder')}
                      onChange={(e) => setStatusChangeNote(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.orderDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.orderDate}
                  onChange={(e) => setDraft({ ...draft, orderDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.requestedDelivery')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.requestedDeliveryDate ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, requestedDeliveryDate: e.target.value || undefined })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.confirmedDelivery')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.confirmedDeliveryDate ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, confirmedDeliveryDate: e.target.value || undefined })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.supplierRef')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  placeholder="PI-2025-001"
                  value={draft.supplierReference ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, supplierReference: e.target.value || undefined })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.currency')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.currency ?? 'CNY'}
                  onChange={(e) => {
                    const currency = e.target.value
                    setDraft({ ...draft, currency })
                    setPendingContract((c) => ({ ...c, currency }))
                  }}
                >
                  {['CNY', 'USD', 'EUR', 'GEL', 'RUB', 'HKD'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.paymentTerms')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  placeholder={t('procurement.paymentTermsPlaceholder')}
                  value={draft.paymentTerms ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, paymentTerms: e.target.value || undefined })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.exchangeRate')}
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  placeholder="GEL"
                  value={draft.exchangeRate ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      exchangeRate: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('procurement.col.exchangeRateDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.exchangeRateDate ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, exchangeRateDate: e.target.value || undefined })
                  }
                />
              </label>
              {draft.scope === 'international' && (
                <>
                  <label className="block text-xs font-semibold text-stone-500">
                    Incoterms
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={draft.incoterms ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, incoterms: e.target.value || undefined })
                      }
                    >
                      <option value="">—</option>
                      {['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'].map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    {t('procurement.col.originCountry')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={draft.originCountry ?? 'CN'}
                      onChange={(e) =>
                        setDraft({ ...draft, originCountry: e.target.value || undefined })
                      }
                    >
                      {countryOptions.map((c) => (
                        <option key={c.code} value={c.code}>
                          {countryLabel(c, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    {t('procurement.col.portLoading')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder="Shanghai, Ningbo…"
                      value={draft.portOfLoading ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, portOfLoading: e.target.value || undefined })
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    {t('procurement.col.portDischarge')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder="Poti, Batumi…"
                      value={draft.portOfDischarge ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, portOfDischarge: e.target.value || undefined })
                      }
                    />
                  </label>
                </>
              )}
              <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
                {t('procurement.col.warehouse')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.destinationWarehouseId ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, destinationWarehouseId: e.target.value || undefined })
                  }
                >
                  <option value="">—</option>
                  {warehouse.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
                {t('procurement.col.note')}
                <textarea
                  rows={2}
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={draft.note ?? ''}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value || undefined })}
                />
              </label>
              {total > 0 && (
                <p className="sm:col-span-2 text-sm text-stone-600">
                  {t('procurement.col.total')}:{' '}
                  <strong className="tabular-nums">
                    {total.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}{' '}
                    {draft.currency}
                  </strong>
                  {draft.exchangeRate != null && draft.exchangeRate > 0 && (
                    <span className="ml-2 text-stone-500">
                      ≈ {(total * draft.exchangeRate).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}{' '}
                      GEL
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {tab === 'lines' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1">
                  <DirectoryFieldPicker
                    label={t('procurement.addFromNomenclature')}
                    hint={t('procurement.nomenclaturePickHint')}
                    value={pickItemId}
                    placeholder={t('procurement.pickItem')}
                    options={warehouse.items
                      .filter((i) => i.active)
                      .map((i) => ({
                        value: i.id,
                        label: `${i.internalCode || '—'} · ${i.name}`,
                      }))}
                    onChange={(id) => {
                      setPickItemId(id)
                      if (id) {
                        addLineFromItem(id)
                        setPickItemId('')
                      }
                    }}
                    onAdd={() => onNavigateToDirectory('nomenclature')}
                  />
                </div>
                <button
                  type="button"
                  className="btn-add shrink-0"
                  onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, newLine()] }))}
                >
                  + {t('procurement.addLine')}
                </button>
              </div>
              <div className="overflow-x-auto rounded-sm border border-grid">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                    <tr>
                      <th className="px-3 py-2 text-left">{t('procurement.col.item')}</th>
                      <th className="w-28 px-2 py-2">{t('procurement.col.supplierSku')}</th>
                      <th className="w-20 px-2 py-2">{t('procurement.col.qty')}</th>
                      <th className="w-14 px-2 py-2">{t('procurement.col.unit')}</th>
                      <th className="w-20 px-2 py-2 text-right">{t('procurement.col.price')}</th>
                      <th className="w-16 px-2 py-2 text-right">{t('procurement.col.received')}</th>
                      <th className="w-24 px-2 py-2 text-center">{t('procurement.col.toNomenclature')}</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line) => (
                      <tr key={line.id} className="border-t border-grid/60">
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full rounded border border-grid px-2 py-1 text-sm"
                            value={line.name}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id
                                    ? { ...l, name: e.target.value, warehouseItemId: undefined }
                                    : l,
                                ),
                              }))
                            }
                          />
                          {line.warehouseItemId && (
                            <span className="text-[10px] text-teal-600">
                              {t('procurement.fromNomenclature')}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full rounded border border-grid px-2 py-1 font-mono text-xs"
                            placeholder="SKU"
                            value={line.supplierSku ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id ? { ...l, supplierSku: e.target.value } : l,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            className="w-full rounded border border-grid px-2 py-1 text-sm text-right"
                            value={line.quantity}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id
                                    ? { ...l, quantity: Number(e.target.value) || 0 }
                                    : l,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full rounded border border-grid px-2 py-1 text-sm"
                            value={line.unit}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id ? { ...l, unit: e.target.value } : l,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded border border-grid px-2 py-1 text-sm text-right"
                            value={line.unitPrice ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id
                                    ? {
                                        ...l,
                                        unitPrice: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                      }
                                    : l,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            className="w-full rounded border border-grid px-2 py-1 text-sm text-right"
                            value={line.receivedQty}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.map((l) =>
                                  l.id === line.id
                                    ? { ...l, receivedQty: Number(e.target.value) || 0 }
                                    : l,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {!line.warehouseItemId && line.name.trim() ? (
                            <label className="inline-flex items-center gap-1 text-[10px] text-stone-600">
                              <input
                                type="checkbox"
                                checked={linesToNomenclature.has(line.id)}
                                onChange={(e) => toggleNomenclature(line.id, e.target.checked)}
                              />
                              {t('procurement.nomenclatureShort')}
                            </label>
                          ) : (
                            <span className="text-[10px] text-stone-300">—</span>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            className="text-red-600"
                            onClick={() => {
                              toggleNomenclature(line.id, false)
                              setDraft((d) => ({
                                ...d,
                                lines: d.lines.filter((l) => l.id !== line.id),
                              }))
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-500">{t('procurement.linesNomenclatureHint')}</p>
            </div>
          )}

          {tab === 'documents' && (
            <PurchaseOrderDocumentsTab
              attachments={draft.attachments}
              onChange={(attachments) => setDraft({ ...draft, attachments })}
            />
          )}

          {tab === 'logistics' && (
            <div className="space-y-4">
              {draft.scope === 'international' && (
                <ContainerTrackingPanel
                  order={draft}
                  onChange={setDraft}
                  onPersist={onSyncPersist}
                />
              )}
              <p className="text-sm text-stone-500">{t('procurement.logisticsHint')}</p>
              <button
                type="button"
                className="rounded-sm border border-teal-600 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    legs: [...d.legs, newLeg(d.legs.length + 1)],
                  }))
                }
              >
                + {t('procurement.addLeg')}
              </button>
              {draft.legs.length === 0 ? (
                <p className="text-sm text-stone-400">{t('procurement.noLegs')}</p>
              ) : (
                draft.legs.map((leg, idx) => (
                  <div key={leg.id} className="rounded-sm border border-grid bg-stone-50/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-stone-700">
                        {t('procurement.leg')} {idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <TransportModeBadge mode={leg.transportMode} />
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.filter((l) => l.id !== leg.id),
                            }))
                          }
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.transport')}
                        <select
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.transportMode}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id
                                  ? { ...l, transportMode: e.target.value as TransportMode }
                                  : l,
                              ),
                            }))
                          }
                        >
                          {TRANSPORTS.map((m) => (
                            <option key={m} value={m}>
                              {t(`procurement.transport.${m}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.carrier')}
                        <input
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.carrier ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id ? { ...l, carrier: e.target.value } : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.vesselTrain')}
                        <input
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          placeholder={t('procurement.vesselPlaceholder')}
                          value={leg.vesselOrTrain ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id ? { ...l, vesselOrTrain: e.target.value } : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.tracking')}
                        <input
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.trackingNumber ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id ? { ...l, trackingNumber: e.target.value } : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.origin')}
                        <input
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.origin}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id ? { ...l, origin: e.target.value } : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.destination')}
                        <input
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.destination}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id ? { ...l, destination: e.target.value } : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.plannedShipment')}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.plannedDepartureDate ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id
                                  ? { ...l, plannedDepartureDate: e.target.value || undefined }
                                  : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.actualShipment')}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.actualDepartureDate ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id
                                  ? { ...l, actualDepartureDate: e.target.value || undefined }
                                  : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.eta')}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.etaDate ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id
                                  ? { ...l, etaDate: e.target.value || undefined }
                                  : l,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-stone-500">
                        {t('procurement.col.actualArrival')}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                          value={leg.actualArrivalDate ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              legs: d.legs.map((l) =>
                                l.id === leg.id
                                  ? { ...l, actualArrivalDate: e.target.value || undefined }
                                  : l,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'journal' && (
            <div className="space-y-3">
              <p className="text-sm text-stone-500">{t('procurement.statusJournal.hint')}</p>
              <PurchaseOrderStatusJournalTab
                entries={draft.statusHistory ?? []}
                canRefreshFromCarrier={canRefreshJournal}
                refreshing={journalSyncing}
                onRefreshFromCarrier={() => refreshFromCarrier(true)}
              />
            </div>
          )}

          {tab === 'tracking' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
                  placeholder={t('procurement.milestoneNote')}
                  id="milestone-note"
                />
                <button
                  type="button"
                  className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => {
                    const el = document.getElementById('milestone-note') as HTMLInputElement
                    const note = el?.value?.trim()
                    setDraft((d) => ({
                      ...d,
                      milestones: [
                        {
                          id: crypto.randomUUID(),
                          at: new Date().toISOString(),
                          status: d.status,
                          note: note || t('procurement.milestoneDefault'),
                        },
                        ...d.milestones,
                      ],
                    }))
                    if (el) el.value = ''
                  }}
                >
                  {t('procurement.addMilestone')}
                </button>
              </div>
              {draft.milestones.length === 0 ? (
                <p className="text-sm text-stone-400">{t('procurement.noMilestones')}</p>
              ) : (
                <ul className="space-y-2">
                  {[...draft.milestones]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((m) => (
                      <li
                        key={m.id}
                        className="flex gap-3 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                      >
                        <time className="shrink-0 font-mono text-xs text-stone-500">
                          {new Date(m.at).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                        <div className="min-w-0 flex-1">
                          <OrderStatusBadge status={m.status as PurchaseOrderStatus} />
                          {m.location && (
                            <span className="ml-2 text-xs text-stone-500">{m.location}</span>
                          )}
                          {m.note && <p className="mt-1 text-stone-700">{m.note}</p>}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-grid px-6 py-4">
          <button type="button" className="rounded-sm border border-grid px-4 py-2 text-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            onClick={save}
          >
            {t('common.save')}
          </button>
        </div>
    </ModalBackdrop>
  )
}
