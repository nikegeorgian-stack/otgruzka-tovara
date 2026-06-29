import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { formatCounterpartyCode } from '@/lib/counterparties/init'
import type { Counterparty, CounterpartyRole } from '@/lib/counterparties/types'
import { newId } from '@/lib/production/files'
import {
  counterpartyOptionLabel,
  counterpartyOptionsForPickFilter,
  type CounterpartyPickFilter,
} from '@/lib/warehouse/documentValidation'

type Mode = 'pick' | 'new'

type Props = {
  counterparties: Counterparty[]
  purposeFilter?: CounterpartyPickFilter
  onPick: (id: string) => void
  onUpsertCounterparty: (c: Counterparty) => void
  onOpenDirectory?: () => void
  onClose: () => void
}

function nextCode(items: Counterparty[]): string {
  const max = items.reduce((m, c) => {
    const match = c.code.match(/(\d+)\s*$/)
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return formatCounterpartyCode(max + 1)
}

function defaultRole(filter: CounterpartyPickFilter): CounterpartyRole {
  return filter === 'purchase' ? 'supplier' : 'customer'
}

function roleAllowed(filter: CounterpartyPickFilter, role: CounterpartyRole): boolean {
  if (filter === 'loading') return role === 'customer' || role === 'both'
  if (filter === 'purchase') return role === 'supplier' || role === 'both'
  return true
}

export function LoadingPickCounterpartyModal({
  counterparties,
  purposeFilter = 'loading',
  onPick,
  onUpsertCounterparty,
  onOpenDirectory,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('pick')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<CounterpartyRole>(() => defaultRole(purposeFilter))
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(
    () => counterpartyOptionsForPickFilter(counterparties, purposeFilter),
    [counterparties, purposeFilter],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.taxId?.toLowerCase().includes(q),
    )
  }, [options, query])

  const titleKey =
    purposeFilter === 'purchase'
      ? 'warehouse.doc.pickSupplierTitle'
      : purposeFilter === 'return'
        ? 'warehouse.doc.pickReturnCounterpartyTitle'
        : 'warehouse.loading.pickCustomerTitle'

  const hintKey =
    purposeFilter === 'purchase'
      ? 'warehouse.doc.pickSupplierHint'
      : purposeFilter === 'return'
        ? 'warehouse.doc.pickReturnCounterpartyHint'
        : 'warehouse.loading.pickCustomerHint'

  const emptyKey =
    purposeFilter === 'loading'
      ? 'warehouse.loading.pickCustomerEmpty'
      : 'warehouse.doc.pickCounterpartyEmpty'

  const roleErrorKey =
    purposeFilter === 'purchase'
      ? 'warehouse.doc.counterpartyRolePurchaseOnly'
      : purposeFilter === 'loading'
        ? 'warehouse.loading.counterpartyRoleLoadingOnly'
        : null

  function saveNew() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('counterparty.errName'))
      return
    }
    if (!roleAllowed(purposeFilter, role)) {
      setError(t(roleErrorKey ?? 'warehouse.doc.errCounterpartyPick'))
      return
    }
    setError(null)
    const now = new Date().toISOString()
    const cp: Counterparty = {
      id: newId(),
      code: nextCode(counterparties),
      name: trimmed,
      role,
      countryCode: 'GE',
      bankAccounts: [],
      contracts: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    }
    onUpsertCounterparty(cp)
    onPick(cp.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stone-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-sm border border-grid bg-white shadow-sm">
        <div className="border-b border-grid px-5 py-4">
          <h3 className="text-lg font-bold text-ink">{t(titleKey)}</h3>
          <p className="mt-1 text-sm text-stone-500">{t(hintKey)}</p>
        </div>

        <div className="flex gap-1 border-b border-grid px-5 py-2">
          {(
            [
              ['pick', t('warehouse.loading.pickTabCatalog')],
              ['new', t('warehouse.loading.pickTabNewCounterparty')],
            ] as [Mode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                mode === id ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
              onClick={() => {
                setMode(id)
                setError(null)
                setRole(defaultRole(purposeFilter))
              }}
            >
              {label}
            </button>
          ))}
          {onOpenDirectory && (
            <button
              type="button"
              className="ml-auto rounded-sm px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50"
              onClick={() => {
                onOpenDirectory()
                onClose()
              }}
            >
              {t('warehouse.loading.openCounterparties')}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {error && (
            <div className="mb-3">
              <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {mode === 'pick' && (
            <>
              <input
                type="search"
                autoFocus
                className="mb-3 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                placeholder={t('warehouse.loading.pickSearch')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {filtered.length === 0 ? (
                <p className="rounded-sm border border-dashed border-grid bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
                  {t(emptyKey)}
                </p>
              ) : (
                <ul className="divide-y divide-grid/60 rounded-sm border border-grid">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 text-left text-sm hover:bg-teal-50"
                        onClick={() => {
                          onPick(c.id)
                          onClose()
                        }}
                      >
                        {counterpartyOptionLabel(c, t)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {mode === 'new' && (
            <div className="space-y-3">
              <p className="text-sm text-stone-500">{t('warehouse.loading.pickNewCounterpartyHint')}</p>
              <label className="block text-xs font-semibold text-stone-500">
                {t('counterparty.name')}
                <input
                  type="text"
                  autoFocus
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('counterparty.role')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as CounterpartyRole)}
                >
                  <option value="customer">{t('counterparty.role.customer')}</option>
                  <option value="both">{t('counterparty.role.both')}</option>
                  <option value="supplier">{t('counterparty.role.supplier')}</option>
                </select>
              </label>
              {roleErrorKey && !roleAllowed(purposeFilter, role) && (
                <p className="text-xs text-amber-700">{t(roleErrorKey)}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-grid px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {mode === 'new' && (
            <Button
              variant="primary"
              size="sm"
              onClick={saveNew}
              disabled={!roleAllowed(purposeFilter, role)}
            >
              {t('warehouse.loading.pickCreateCounterparty')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
