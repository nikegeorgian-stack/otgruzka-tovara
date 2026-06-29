import { useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { useI18n } from '@/context/I18nContext'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { SecretValue } from '@/components/ui/SecretValue'
import { bankName, formatIban, normalizeIban } from '@/lib/hr/banks'
import { hrStatusLabel } from '@/lib/hr/labels'
import type { Locale } from '@/i18n/types'
import type { Employee } from '@/lib/types'

function Row({
  label,
  value,
  children,
}: {
  label: string
  value?: string | null
  children?: React.ReactNode
}) {
  if (!children && !value) return null
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-stone-400">{label}</span>
      <span className="text-right font-medium text-ink">{children ?? value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-stone-400">{title}</h4>
      <div className="divide-y divide-grid/60">{children}</div>
    </div>
  )
}

export function HrPersonalFile({
  employee,
  onOpenFull,
}: {
  employee: Employee
  onOpenFull: () => void
}) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
  const loc = locale as Locale
  const [copied, setCopied] = useState<string | null>(null)
  const status = employee.hrStatus ?? 'active'
  const primaryBank =
    (employee.bankAccounts ?? []).find((a) => a.isPrimary) ?? (employee.bankAccounts ?? [])[0]

  const maritalLabel = employee.maritalStatus
    ? t(`hr.marital.${employee.maritalStatus}`)
    : null

  async function copyIban(iban: string) {
    try {
      await navigator.clipboard.writeText(normalizeIban(iban))
      setCopied(iban)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* clipboard недоступен */
    }
  }

  const genderLabel = employee.gender
    ? t(`hr.gender.${employee.gender}`)
    : t('hr.gender.unknown')

  return (
    <div className="overflow-hidden rounded-sm border border-grid bg-white">
      {/* «Корешок» личного дела */}
      <div className="flex gap-4 border-b border-grid bg-stone-50 p-5">
        <EmployeePhoto
          photoDataUrl={employee.photoDataUrl}
          gender={employee.gender ?? 'unknown'}
          className="h-28 w-24 shrink-0 rounded-sm object-cover ring-1 ring-grid"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
            {t('hr.card.passport')}
          </p>
          <BilingualText
            lines={employeeNameLines(employee)}
            className="mt-1 text-lg font-bold leading-tight text-ink"
          />
          <BilingualText
            lines={employeePositionLines(employee)}
            className="mt-1 text-sm font-medium leading-tight text-stone-500"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-stone-500">№ {employee.tabNumber || '—'}</span>
            <span
              className={`fc-badge ${
                status === 'fired'
                  ? 'border-red-200 bg-red-100 text-red-700'
                  : status === 'active'
                    ? 'border-teal-200 bg-teal-100 text-teal-700'
                    : 'border-amber-200 bg-amber-100 text-amber-700'
              }`}
            >
              {hrStatusLabel(status, loc)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <Section title={t('hr.card.personalData')}>
          <Row label={t('hr.cec.citizenship')} value={employee.citizenship} />
          <Row label={t('hr.cec.personalId')} value={employee.personalId} />
          <Row label={t('hr.gender.label')} value={genderLabel} />
          <Row label="Дата рождения" value={employee.birthDate} />
          <Row label={t('hr.extra.maritalStatus')} value={maritalLabel} />
          <Row label="Адрес" value={employee.actualAddress ?? employee.address} />
        </Section>

        <Section title={t('hr.card.contacts')}>
          <Row label="Телефон" value={employee.phone} />
          <Row label={t('hr.email')} value={employee.email} />
          {(employee.relatives ?? []).slice(0, 3).map((r) => (
            <Row
              key={r.id}
              label={r.relation || t('hr.rel.title')}
              value={[r.name, r.phone].filter(Boolean).join(', ')}
            />
          ))}
        </Section>

        <Section title={t('hr.card.work')}>
          <Row label={t('hr.col.dept')} value={employee.department ?? employee.brigade} />
          <Row label="Дата приёма" value={employee.hireDate} />
          {employee.terminationDate && (
            <Row label={t('hr.fireDate')} value={employee.terminationDate} />
          )}
          {employee.monthlySalary ? (
            <Row label="Оклад">
              <SecretValue
                value={`${employee.monthlySalary} ${employee.currency ?? 'GEL'}`}
              />
            </Row>
          ) : null}
        </Section>

        <Section title={t('hr.bank.title')}>
          {primaryBank?.iban ? (
            <div className="py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-ink">{formatIban(primaryBank.iban)}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-sm border border-grid px-2 py-1 text-[11px] font-semibold hover:bg-paper-dark"
                  onClick={() => copyIban(primaryBank.iban)}
                >
                  {copied === primaryBank.iban ? t('hr.card.copied') : t('hr.card.copyIban')}
                </button>
              </div>
              <p className="mt-0.5 text-xs text-stone-400">
                {bankName(primaryBank.bankCode, loc)}
                {primaryBank.holderName ? ` · ${primaryBank.holderName}` : ''}
              </p>
            </div>
          ) : (
            <p className="py-1 text-xs text-stone-400">{t('hr.bank.empty')}</p>
          )}
        </Section>

        {(employee.education ?? []).length > 0 && (
          <Section title={t('hr.edu.title')}>
            {(employee.education ?? []).map((e) => (
              <Row
                key={e.id}
                label={[e.startYear, e.endYear].filter(Boolean).join('–') || '—'}
                value={[e.institution, e.specialty].filter(Boolean).join(', ')}
              />
            ))}
          </Section>
        )}

        {(employee.workExperience ?? []).length > 0 && (
          <Section title={t('hr.exp.title')}>
            {(employee.workExperience ?? []).map((e) => (
              <Row
                key={e.id}
                label={[e.startDate, e.endDate].filter(Boolean).join('–') || '—'}
                value={[e.company, e.position].filter(Boolean).join(', ')}
              />
            ))}
          </Section>
        )}
      </div>

      <div className="border-t border-grid p-4">
        <button
          type="button"
          className="w-full rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
          onClick={onOpenFull}
        >
          {t('hr.openFullCard')}
        </button>
      </div>
    </div>
  )
}
