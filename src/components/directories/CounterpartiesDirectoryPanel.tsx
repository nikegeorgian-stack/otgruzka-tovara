import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  countriesSorted,
  countryLabel,
  countryLabelByCode,
  resolveCountryCode,
} from '@/lib/counterparties/countries'
import {
  emptyCounterparty,
  nextCounterpartyCode,
} from '@/lib/counterparties/init'
import { newId } from '@/lib/production/files'
import type {
  Counterparty,
  CounterpartyBankAccount,
  CounterpartyContract,
  CounterpartyRole,
  CounterpartyStore,
} from '@/lib/counterparties/types'

type Props = {
  store: CounterpartyStore
  onUpsert: (c: Counterparty) => void
  onRemove: (id: string) => void
}

type ModalTab = 'main' | 'accounts' | 'contracts'

export function CounterpartiesDirectoryPanel({ store, onUpsert, onRemove }: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const countryOptions = countriesSorted(locale)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Counterparty | null>(null)
  const [tab, setTab] = useState<ModalTab>('main')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return store.items.filter((c) => c.active)
    return store.items.filter(
      (c) =>
        c.active &&
        (c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.taxId?.toLowerCase().includes(q) ||
          (countryLabelByCode(c.countryCode, locale) || '')
            .toLowerCase()
            .includes(q)),
    )
  }, [store.items, search])

  function openNew() {
    setEditing(emptyCounterparty(store))
    setTab('main')
  }

  function openEdit(c: Counterparty) {
    setEditing({ ...c })
    setTab('main')
  }

  function save() {
    if (!editing) return
    if (!editing.name.trim()) {
      setNotice(t('counterparty.errName'))
      return
    }
    onUpsert({
      ...editing,
      code: editing.code || nextCounterpartyCode(store),
      updatedAt: new Date().toISOString(),
    })
    setEditing(null)
    setNotice(t('counterparty.saved'))
  }

  function patch(partial: Partial<Counterparty>) {
    setEditing((e) => (e ? { ...e, ...partial } : e))
  }

  function addAccount() {
    if (!editing) return
    const acc: CounterpartyBankAccount = {
      id: newId(),
      bankName: '',
      accountNumber: '',
      currency: 'GEL',
      isPrimary: editing.bankAccounts.length === 0,
    }
    patch({ bankAccounts: [...editing.bankAccounts, acc] })
  }

  function updateAccount(id: string, partial: Partial<CounterpartyBankAccount>) {
    if (!editing) return
    patch({
      bankAccounts: editing.bankAccounts.map((a) =>
        a.id === id ? { ...a, ...partial } : a,
      ),
    })
  }

  function removeAccount(id: string) {
    if (!editing) return
    patch({ bankAccounts: editing.bankAccounts.filter((a) => a.id !== id) })
  }

  function addContract() {
    if (!editing) return
    const c: CounterpartyContract = {
      id: newId(),
      number: '',
      signedAt: new Date().toISOString().slice(0, 10),
      subject: '',
    }
    patch({ contracts: [...editing.contracts, c] })
  }

  function updateContract(id: string, partial: Partial<CounterpartyContract>) {
    if (!editing) return
    patch({
      contracts: editing.contracts.map((c) =>
        c.id === id ? { ...c, ...partial } : c,
      ),
    })
  }

  function removeContract(id: string) {
    if (!editing) return
    patch({ contracts: editing.contracts.filter((c) => c.id !== id) })
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="min-w-[200px] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('counterparty.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn-add"
          onClick={openNew}
        >
          {t('counterparty.add')}
        </button>
      </div>

      <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('counterparty.col.code')}</th>
              <th className="px-4 py-3">{t('counterparty.col.name')}</th>
              <th className="px-4 py-3">{t('counterparty.col.country')}</th>
              <th className="px-4 py-3">{t('counterparty.col.role')}</th>
              <th className="px-4 py-3">{t('counterparty.col.accounts')}</th>
              <th className="px-4 py-3">{t('counterparty.col.contracts')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                  {t('counterparty.empty')}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-grid/60 hover:bg-stone-50/50">
                <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-stone-600">
                  {c.countryCode ? countryLabelByCode(c.countryCode, locale) : '—'}
                </td>
                <td className="px-4 py-3 text-stone-600">{t(`counterparty.role.${c.role}`)}</td>
                <td className="px-4 py-3">{c.bankAccounts.length}</td>
                <td className="px-4 py-3">{c.contracts.length}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-accent hover:underline"
                    onClick={() => openEdit(c)}
                  >
                    {t('counterparty.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ModalBackdrop
          open
          onClose={() => setEditing(null)}
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          panelClassName="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-sm border border-grid bg-white shadow-sm"
        >
            <div className="border-b border-grid px-5 py-4">
              <h3 className="text-lg font-bold text-ink">
                {editing.name || t('counterparty.new')}
              </h3>
              <p className="font-mono text-xs text-stone-500">{editing.code}</p>
              <div className="mt-3 flex gap-1">
                {(
                  [
                    ['main', 'counterparty.tab.main'],
                    ['accounts', 'counterparty.tab.accounts'],
                    ['contracts', 'counterparty.tab.contracts'],
                  ] as const
                ).map(([id, key]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                      tab === id ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === 'main' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('counterparty.name')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.legalName')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.legalName ?? ''}
                      onChange={(e) => patch({ legalName: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.role')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.role}
                      onChange={(e) => patch({ role: e.target.value as CounterpartyRole })}
                    >
                      <option value="customer">{t('counterparty.role.customer')}</option>
                      <option value="supplier">{t('counterparty.role.supplier')}</option>
                      <option value="both">{t('counterparty.role.both')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.taxId')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.taxId ?? ''}
                      onChange={(e) => patch({ taxId: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.country')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={
                        editing.countryCode ||
                        resolveCountryCode(
                          (editing as typeof editing & { country?: string }).country,
                        ) ||
                        ''
                      }
                      onChange={(e) => patch({ countryCode: e.target.value || undefined })}
                    >
                      <option value="">{t('counterparty.countryPick')}</option>
                      {countryOptions.map((c) => (
                        <option key={c.code} value={c.code}>
                          {countryLabel(c, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.phone')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.phone ?? ''}
                      onChange={(e) => patch({ phone: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.email')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.email ?? ''}
                      onChange={(e) => patch({ email: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('counterparty.contact')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.contactPerson ?? ''}
                      onChange={(e) => patch({ contactPerson: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('counterparty.address')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.address ?? ''}
                      onChange={(e) => patch({ address: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('counterparty.note')}
                    <textarea
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      rows={2}
                      value={editing.note ?? ''}
                      onChange={(e) => patch({ note: e.target.value })}
                    />
                  </label>
                </div>
              )}

              {tab === 'accounts' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    className="btn-add-outline"
                    onClick={addAccount}
                  >
                    + {t('counterparty.addAccount')}
                  </button>
                  {editing.bankAccounts.length === 0 && (
                    <p className="text-sm text-stone-500">{t('counterparty.noAccounts')}</p>
                  )}
                  {editing.bankAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="grid gap-2 rounded-sm border border-grid bg-stone-50/50 p-3 sm:grid-cols-2"
                    >
                      <input
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        placeholder={t('counterparty.bankName')}
                        value={acc.bankName}
                        onChange={(e) => updateAccount(acc.id, { bankName: e.target.value })}
                      />
                      <input
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm font-mono"
                        placeholder={t('counterparty.accountNumber')}
                        value={acc.accountNumber}
                        onChange={(e) =>
                          updateAccount(acc.id, { accountNumber: e.target.value })
                        }
                      />
                      <input
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        placeholder="GEL"
                        value={acc.currency}
                        onChange={(e) => updateAccount(acc.id, { currency: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={acc.isPrimary}
                          onChange={(e) =>
                            updateAccount(acc.id, { isPrimary: e.target.checked })
                          }
                        />
                        {t('counterparty.primaryAccount')}
                      </label>
                      <button
                        type="button"
                        className="text-xs text-red-600 sm:col-span-2"
                        onClick={() => removeAccount(acc.id)}
                      >
                        {t('counterparty.removeRow')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'contracts' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    className="btn-add-outline"
                    onClick={addContract}
                  >
                    + {t('counterparty.addContract')}
                  </button>
                  {editing.contracts.length === 0 && (
                    <p className="text-sm text-stone-500">{t('counterparty.noContracts')}</p>
                  )}
                  {editing.contracts.map((c) => (
                    <div
                      key={c.id}
                      className="grid gap-2 rounded-sm border border-grid bg-stone-50/50 p-3 sm:grid-cols-2"
                    >
                      <input
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        placeholder={t('counterparty.contractNumber')}
                        value={c.number}
                        onChange={(e) => updateContract(c.id, { number: e.target.value })}
                      />
                      <input
                        type="date"
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        value={c.signedAt}
                        onChange={(e) => updateContract(c.id, { signedAt: e.target.value })}
                      />
                      <input
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm sm:col-span-2"
                        placeholder={t('counterparty.contractSubject')}
                        value={c.subject}
                        onChange={(e) => updateContract(c.id, { subject: e.target.value })}
                      />
                      <input
                        type="date"
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        value={c.validUntil ?? ''}
                        onChange={(e) => updateContract(c.id, { validUntil: e.target.value })}
                      />
                      <input
                        type="number"
                        className="rounded-sm border border-grid px-2 py-1.5 text-sm"
                        placeholder={t('counterparty.contractAmount')}
                        value={c.amount ?? ''}
                        onChange={(e) =>
                          updateContract(c.id, { amount: Number(e.target.value) || undefined })
                        }
                      />
                      <button
                        type="button"
                        className="text-xs text-red-600 sm:col-span-2"
                        onClick={() => removeContract(c.id)}
                      >
                        {t('counterparty.removeRow')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-grid px-5 py-4">
              <button
                type="button"
                className="text-sm text-red-600"
                onClick={async () => {
                  if (editing.id && (await confirm({ message: t('counterparty.deleteConfirm'), danger: true }))) {
                    onRemove(editing.id)
                    setEditing(null)
                  }
                }}
              >
                {t('counterparty.delete')}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-grid px-4 py-2 text-sm"
                  onClick={() => setEditing(null)}
                >
                  {t('planner.cancel')}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
                  onClick={save}
                >
                  {t('planner.save')}
                </button>
              </div>
            </div>
        </ModalBackdrop>
      )}
    </div>
  )
}
