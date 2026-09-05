import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { useI18n } from '@/context/I18nContext'
import {
  contractIsExpiringSoon,
  contractIsOverdue,
  contractStatusLabel,
} from '@/lib/hr/contracts'
import { daysUntil } from '@/lib/hr/stats'
import { employmentAgreementLabel, hrContractLabel } from '@/lib/hr/labels'
import type { HrEmploymentContract } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

type ContractRow = {
  employeeId: string
  employeeName: string
  employeeStatus?: Employee['hrStatus']
  contract: HrEmploymentContract
}

type Props = {
  rows: ContractRow[]
  contractFilter?: 'all' | 'expiring' | 'overdue'
  onContractFilterChange?: (f: 'all' | 'expiring' | 'overdue') => void
  onOpenEmployee?: (employeeId: string) => void
  compact?: boolean
  /** Показать и предыдущие договоры (карточка сотрудника). */
  showAll?: boolean
  onEdit?: (contract: HrEmploymentContract) => void
  onRemove?: (contractId: string) => void
}

function contractDocs(contract: HrEmploymentContract) {
  const urls = [
    ...(contract.documentUrls ?? []),
    ...(contract.documentUrl ? [contract.documentUrl] : []),
  ]
  const seen = new Set<string>()
  const unique = urls.filter((u) => {
    const t = u.trim()
    if (!t || seen.has(t)) return false
    seen.add(t)
    return true
  })
  const title = contract.contractNumber
    ? `Трудовой договор № ${contract.contractNumber}`
    : contract.position
  return unique.map((fileUrl, i) => ({
    id: `${contract.id}-att-${i}`,
    title: unique.length > 1 ? `${title} (${i + 1})` : title,
    docType: 'contract',
    uploadedAt: '',
    uploadedBy: 'registry-import',
    fileUrl,
    fileName: i === 0 ? contract.documentFileName : undefined,
    expiresAt: contract.endDate,
  }))
}

export function HrEmploymentContractsPanel({
  rows,
  contractFilter = 'all',
  onContractFilterChange,
  onOpenEmployee,
  compact = false,
  showAll = false,
  onEdit,
  onRemove,
}: Props) {
  const { t, locale } = useI18n()

  const filtered = rows.filter(({ contract, employeeStatus }) => {
    const isFired = employeeStatus === 'fired'
    if (!contract.isPrimary && compact && !showAll) return false
    if (isFired) return false
    if (contractFilter === 'expiring') {
      return contractIsExpiringSoon(contract.endDate) && !contractIsOverdue(contract.endDate)
    }
    if (contractFilter === 'overdue') return contractIsOverdue(contract.endDate)
    return true
  })

  return (
    <div className="space-y-3">
      {onContractFilterChange && (
        <div className="flex flex-wrap gap-2">
          {(['all', 'expiring', 'overdue'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onContractFilterChange(f)}
              className={`rounded-sm border px-3 py-1.5 text-xs font-semibold ${
                contractFilter === f
                  ? 'border-accent bg-accent text-white'
                  : 'border-grid bg-white text-stone-600 hover:border-accent/60'
              }`}
            >
              {t(`hr.contractFilter.${f}`)}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              {!compact && <th className="px-3 py-2">{t('hr.col.employee')}</th>}
              <th className="px-3 py-2">{t('hr.contract.col.position')}</th>
              <th className="px-3 py-2">{t('hr.contract.col.number')}</th>
              <th className="px-3 py-2">{t('hr.contract.col.effective')}</th>
              <th className="px-3 py-2">{t('hr.col.expires')}</th>
              <th className="px-3 py-2">{t('hr.contract.col.term')}</th>
              <th className="px-3 py-2">{t('hr.contract.col.kind')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ employeeId, employeeName, contract }) => {
              const docs = contractDocs(contract)
              const d = daysUntil(contract.endDate)
              const warn =
                contract.isPrimary &&
                (contractIsExpiringSoon(contract.endDate) || contractIsOverdue(contract.endDate))
              return (
                <tr key={`${employeeId}-${contract.id}`} className="border-t border-grid">
                  {!compact && (
                    <td className="px-3 py-2">
                      {onOpenEmployee ? (
                        <button
                          type="button"
                          className="text-left text-accent hover:underline"
                          onClick={() => onOpenEmployee(employeeId)}
                        >
                          {employeeName}
                        </button>
                      ) : (
                        employeeName
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {contract.position || '—'}
                    {contract.isPrimary && (
                      <span className="ml-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        {t('hr.contract.primary')}
                      </span>
                    )}
                    {!contract.isPrimary && (
                      <span className="ml-1 text-[10px] text-stone-400">
                        {contractStatusLabel(contract.status, locale)}
                      </span>
                    )}
                    {contract.hasInsurance && (
                      <span className="ml-1 text-[10px] text-sky-700">{t('hr.contract.insuranceShort')}</span>
                    )}
                    {(contract.hasBonusThirteenth || contract.bonusThirteenth) && (
                      <span className="ml-1 text-[10px] text-amber-700">{t('hr.contract.bonus13Short')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{contract.contractNumber || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{contract.effectiveDate ?? '—'}</td>
                  <td className={`px-3 py-2 font-mono text-xs ${warn ? 'text-amber-700' : ''}`}>
                    {contract.endDate ?? '—'}
                    {warn && d !== null && (
                      <span className="ml-1 text-[10px]">
                        ({d < 0 ? t('hr.contract.overdue') : `${d} дн.`})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{contract.term || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {employmentAgreementLabel(contract.agreementKind, locale)}
                    {contract.contractType && (
                      <span className="mt-0.5 block text-[10px] text-stone-400">
                        {hrContractLabel(contract.contractType, locale)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {docs.map((doc) => (
                        <HrDocumentOpenButton key={doc.id} doc={doc} compact />
                      ))}
                      {onEdit && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent hover:underline"
                          onClick={() => onEdit(contract)}
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      {onRemove && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-600 hover:underline"
                          onClick={() => onRemove(contract.id)}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                      {docs.length === 0 && !onEdit && !onRemove ? '—' : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-stone-500">{t('hr.contract.empty')}</p>
        )}
      </div>
    </div>
  )
}

export function employeeContractRows(employee: Employee): ContractRow[] {
  return (employee.hrContracts ?? []).map((contract) => ({
    employeeId: employee.id,
    employeeName: employee.fullName,
    employeeStatus: employee.hrStatus,
    contract,
  }))
}
