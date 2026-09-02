import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { newId } from '@/lib/hr/files'
import {
  GEORGIAN_BANKS,
  bankName,
  checkGeorgianIban,
  detectBankFromIban,
  normalizeIban,
} from '@/lib/hr/banks'
import { promoteBankAccount } from '@/lib/hr/employeeBank'
import type {
  HrBankAccount,
  HrEducation,
  HrRelative,
  HrWorkExperience,
} from '@/lib/hr/types'
import type { Locale } from '@/i18n/types'

const fieldClass = 'w-full rounded-sm border border-grid px-3 py-2 text-sm'
const addBtnClass =
  'rounded-sm border border-dashed border-accent/60 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/5'
const removeBtnClass = 'text-xs text-red-600 hover:underline'

/* ------------------------------- Образование ------------------------------ */

export function EducationSection({
  items,
  onChange,
}: {
  items: HrEducation[]
  onChange: (next: HrEducation[]) => void
}) {
  const { t } = useI18n()
  const add = () =>
    onChange([...items, { id: newId(), institution: '' }])
  const update = (id: string, patch: Partial<HrEducation>) =>
    onChange(items.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const remove = (id: string) => onChange(items.filter((e) => e.id !== id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{t('hr.edu.title')}</h4>
        <button type="button" className={addBtnClass} onClick={add}>
          + {t('hr.edu.add')}
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-stone-400">{t('hr.edu.empty')}</p>}
      {items.map((e) => (
        <div key={e.id} className="rounded-sm border border-grid p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder={t('hr.edu.institution')}
              value={e.institution}
              onChange={(ev) => update(e.id, { institution: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.edu.level')}
              value={e.level ?? ''}
              onChange={(ev) => update(e.id, { level: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.edu.specialty')}
              value={e.specialty ?? ''}
              onChange={(ev) => update(e.id, { specialty: ev.target.value })}
            />
            <div className="flex gap-2">
              <input
                className={fieldClass}
                placeholder="2015"
                value={e.startYear ?? ''}
                onChange={(ev) => update(e.id, { startYear: ev.target.value })}
              />
              <input
                className={fieldClass}
                placeholder="2019"
                value={e.endYear ?? ''}
                onChange={(ev) => update(e.id, { endYear: ev.target.value })}
              />
            </div>
          </div>
          <div className="mt-2 text-right">
            <button type="button" className={removeBtnClass} onClick={() => remove(e.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------- Опыт ----------------------------------- */

export function ExperienceSection({
  items,
  onChange,
}: {
  items: HrWorkExperience[]
  onChange: (next: HrWorkExperience[]) => void
}) {
  const { t } = useI18n()
  const add = () => onChange([...items, { id: newId(), company: '' }])
  const update = (id: string, patch: Partial<HrWorkExperience>) =>
    onChange(items.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const remove = (id: string) => onChange(items.filter((e) => e.id !== id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{t('hr.exp.title')}</h4>
        <button type="button" className={addBtnClass} onClick={add}>
          + {t('hr.exp.add')}
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-stone-400">{t('hr.exp.empty')}</p>}
      {items.map((e) => (
        <div key={e.id} className="rounded-sm border border-grid p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder={t('hr.exp.company')}
              value={e.company}
              onChange={(ev) => update(e.id, { company: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.exp.position')}
              value={e.position ?? ''}
              onChange={(ev) => update(e.id, { position: ev.target.value })}
            />
            <input
              type="date"
              className={fieldClass}
              value={e.startDate ?? ''}
              onChange={(ev) => update(e.id, { startDate: ev.target.value })}
            />
            <input
              type="date"
              className={fieldClass}
              value={e.endDate ?? ''}
              onChange={(ev) => update(e.id, { endDate: ev.target.value })}
            />
            <input
              className={`${fieldClass} sm:col-span-2`}
              placeholder={t('hr.exp.note')}
              value={e.note ?? ''}
              onChange={(ev) => update(e.id, { note: ev.target.value })}
            />
          </div>
          <div className="mt-2 text-right">
            <button type="button" className={removeBtnClass} onClick={() => remove(e.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------- Банк ----------------------------------- */

function namesOverlap(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-zа-яёგ-ჰ\s]/giu, '')
      .split(/\s+/)
      .filter((w) => w.length > 1)
  const wa = new Set(norm(a))
  const wb = norm(b)
  if (wa.size === 0 || wb.length === 0) return false
  const hits = wb.filter((w) => wa.has(w)).length
  return hits >= Math.min(2, wb.length)
}

function BankAccountRow({
  acc,
  employeeName,
  locale,
  onUpdate,
  onRemove,
  onPromote,
}: {
  acc: HrBankAccount
  employeeName: string
  locale: Locale
  onUpdate: (patch: Partial<HrBankAccount>) => void
  onRemove: () => void
  onPromote?: () => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const check = acc.iban ? checkGeorgianIban(acc.iban) : null
  const holderMatch =
    acc.holderName && employeeName ? namesOverlap(acc.holderName, employeeName) : null

  async function copyIban() {
    try {
      await navigator.clipboard.writeText(normalizeIban(acc.iban))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard недоступен */
    }
  }

  return (
    <div className="rounded-sm border border-grid p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="flex gap-2">
            <input
              className={`${fieldClass} font-mono`}
              placeholder="GE00XX0000000000000000"
              value={acc.iban}
              onChange={(ev) => {
                const iban = ev.target.value.toUpperCase()
                onUpdate({ iban, bankCode: detectBankFromIban(iban)?.code })
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-sm border border-grid px-3 py-2 text-xs font-semibold hover:bg-paper-dark disabled:opacity-40"
              onClick={copyIban}
              disabled={!acc.iban}
            >
              {copied ? t('hr.bank.copied') : t('hr.bank.copy')}
            </button>
          </div>
          {acc.iban && check && (
            <p
              className={`mt-1 text-xs ${check.ok ? 'text-teal-700' : 'text-red-600'}`}
            >
              {check.ok
                ? `${t('hr.bank.valid')} · ${bankName(check.bank?.code, locale)} (${check.bank?.bic})`
                : t(check.errorKey ?? 'hr.bank.ibanFormat')}
            </p>
          )}
        </div>

        <label className="block text-xs font-medium text-stone-500">
          {t('hr.bank.bank')}
          <select
            className={`${fieldClass} mt-1`}
            value={acc.bankCode ?? ''}
            onChange={(ev) => onUpdate({ bankCode: ev.target.value || undefined })}
          >
            <option value="">{t('hr.bank.bankAuto')}</option>
            {GEORGIAN_BANKS.map((b) => (
              <option key={b.code} value={b.code}>
                {locale === 'ka' ? b.nameKa : b.nameRu}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-500">
          {t('hr.bank.currency')}
          <select
            className={`${fieldClass} mt-1`}
            value={acc.currency ?? 'GEL'}
            onChange={(ev) =>
              onUpdate({ currency: ev.target.value as HrBankAccount['currency'] })
            }
          >
            <option value="GEL">GEL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="RUB">RUB</option>
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
          {t('hr.bank.holder')}
          <input
            className={`${fieldClass} mt-1`}
            placeholder={t('hr.bank.holderHint')}
            value={acc.holderName ?? ''}
            onChange={(ev) => onUpdate({ holderName: ev.target.value })}
          />
          {holderMatch !== null && (
            <span
              className={`mt-1 block text-xs ${holderMatch ? 'text-teal-700' : 'text-amber-600'}`}
            >
              {holderMatch ? `✓ ${t('hr.bank.holderMatch')}` : `⚠ ${t('hr.bank.holderMismatch')}`}
            </span>
          )}
        </label>

        <label className="block text-xs font-medium text-stone-500">
          {t('hr.bank.validFrom')}
          <input
            type="date"
            className={`${fieldClass} mt-1`}
            value={acc.validFrom ?? ''}
            onChange={(ev) => onUpdate({ validFrom: ev.target.value || undefined })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-500">
          {t('hr.bank.validUntil')}
          <input
            type="date"
            className={`${fieldClass} mt-1`}
            value={acc.validUntil ?? ''}
            onChange={(ev) => onUpdate({ validUntil: ev.target.value || undefined })}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={acc.isPrimary ?? false}
              onChange={(ev) => onUpdate({ isPrimary: ev.target.checked })}
            />
            {t('hr.bank.primary')}
          </label>
          {onPromote ? (
            <button
              type="button"
              className="rounded-sm border border-teal-700 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50"
              onClick={onPromote}
            >
              {t('hr.bank.promoteToday')}
            </button>
          ) : null}
        </div>
        <button type="button" className={removeBtnClass} onClick={onRemove}>
          {t('hr.bank.remove')}
        </button>
      </div>
    </div>
  )
}

export function BankSection({
  items,
  employeeName,
  onChange,
}: {
  items: HrBankAccount[]
  employeeName: string
  onChange: (next: HrBankAccount[]) => void
}) {
  const { t, locale } = useI18n()
  const today = new Date().toISOString().slice(0, 10)

  const add = () =>
    onChange([
      ...items,
      {
        id: newId(),
        iban: '',
        currency: 'GEL',
        isPrimary: items.length === 0,
        validFrom: today,
      },
    ])

  const update = (id: string, patch: Partial<HrBankAccount>) =>
    onChange(items.map((a) => (a.id === id ? { ...a, ...patch } : a)))

  const remove = (id: string) => {
    const acc = items.find((a) => a.id === id)
    if (acc?.iban?.trim() && !acc.validUntil) {
      onChange(
        items.map((a) =>
          a.id === id ? { ...a, isPrimary: false, validUntil: today } : a,
        ),
      )
      return
    }
    onChange(items.filter((a) => a.id !== id))
  }

  const promote = (id: string) => onChange(promoteBankAccount(items, id, today))

  const sorted = [...items].sort((a, b) => {
    const aClosed = a.validUntil && a.validUntil < today ? 1 : 0
    const bClosed = b.validUntil && b.validUntil < today ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed
    if ((a.isPrimary ? 1 : 0) !== (b.isPrimary ? 1 : 0)) return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)
    return (b.validFrom || '').localeCompare(a.validFrom || '')
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('hr.bank.title')}</h4>
          <p className="text-xs text-stone-500">{t('hr.bank.periodHint')}</p>
        </div>
        <button type="button" className={addBtnClass} onClick={add}>
          + {t('hr.bank.add')}
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-stone-400">{t('hr.bank.empty')}</p>}
      {sorted.map((acc) => {
        const closed = Boolean(acc.validUntil && acc.validUntil < today)
        return (
          <div key={acc.id} className={closed ? 'opacity-70' : undefined}>
            {closed ? (
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                {t('hr.bank.archived')}
              </p>
            ) : null}
            <BankAccountRow
              acc={acc}
              employeeName={employeeName}
              locale={locale as Locale}
              onUpdate={(patch) => update(acc.id, patch)}
              onRemove={() => remove(acc.id)}
              onPromote={closed ? undefined : () => promote(acc.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------ Родственники ------------------------------ */

export function RelativesSection({
  items,
  onChange,
}: {
  items: HrRelative[]
  onChange: (next: HrRelative[]) => void
}) {
  const { t } = useI18n()
  const add = () => onChange([...items, { id: newId(), name: '' }])
  const update = (id: string, patch: Partial<HrRelative>) =>
    onChange(items.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange(items.filter((r) => r.id !== id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{t('hr.rel.title')}</h4>
        <button type="button" className={addBtnClass} onClick={add}>
          + {t('hr.rel.add')}
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-stone-400">{t('hr.rel.empty')}</p>}
      {items.map((r) => (
        <div key={r.id} className="rounded-sm border border-grid p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder={t('hr.rel.name')}
              value={r.name}
              onChange={(ev) => update(r.id, { name: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.rel.relation')}
              value={r.relation ?? ''}
              onChange={(ev) => update(r.id, { relation: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.rel.phone')}
              value={r.phone ?? ''}
              onChange={(ev) => update(r.id, { phone: ev.target.value })}
            />
            <input
              className={fieldClass}
              placeholder={t('hr.rel.note')}
              value={r.note ?? ''}
              onChange={(ev) => update(r.id, { note: ev.target.value })}
            />
          </div>
          <div className="mt-2 text-right">
            <button type="button" className={removeBtnClass} onClick={() => remove(r.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
