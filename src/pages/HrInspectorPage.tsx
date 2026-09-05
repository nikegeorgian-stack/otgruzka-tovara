import { useEffect, useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { AttendanceLogPanel } from '@/components/hr/AttendanceLogPanel'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { HrEmploymentContractsPanel } from '@/components/hr/HrEmploymentContractsPanel'
import { HrInspectorForeignPanel } from '@/components/hr/HrInspectorForeignPanel'
import { HrDocumentsMonitorDialog } from '@/components/hr/HrDocumentsMonitorDialog'
import {
  collectDocumentMonitorRows,
  countDocumentMonitorProblems,
  employeesMissingPrimaryContract,
  type DocMonitorCategory,
} from '@/lib/hr/documentMonitor'
import { allEmployeeContracts } from '@/lib/hr/contracts'
import { HrFiredPanel } from '@/components/hr/HrFiredPanel'
import { HrPersonalFile } from '@/components/hr/HrPersonalFile'
import { HrStaffRatesPanel } from '@/components/hr/HrStaffRatesPanel'
import { HrVacationForm } from '@/components/hr/HrVacationForm'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { SharedDataNotice } from '@/components/ui/SharedDataNotice'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { useEmployeeEditorApi } from '@/context/EmployeeEditorContext'
import { hrAbsenceLabel, hrStatusLabel } from '@/lib/hr/labels'
import { collectForeignPersonnelAlerts } from '@/lib/hr/inspector'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import { employeeSearchHr } from '@/lib/hr/sync'
import {
  removeHrContractToTrash,
  removeHrDocumentToTrash,
} from '@/lib/hr/documentTrash'
import {
  allEmployeeAbsences,
  allEmployeeDocuments,
  allEmployeeTrainings,
  computeHrKpis,
  daysUntil,
  isExpiringSoon,
  isOverdue,
} from '@/lib/hr/stats'
import type { DayCode, Employee, HrStatus } from '@/lib/types'

export type HrInspectorSection =
  | 'dashboard'
  | 'employees'
  | 'fired'
  | 'contracts'
  | 'documents'
  | 'trainings'
  | 'absences'
  | 'foreign'
  | 'attendance'
  | 'rates'

type Props = {
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  existingMonthKeys: string[]
  site?: string
  responsible?: string
  webInspectorMode?: boolean
  webUserName?: string
  /** У пользователя также есть раздел Персонал — скрыть дублирующие вкладки */
  compactWithHr?: boolean
  onSaveEmployee: (e: Employee) => void
  onSetEmployeeFactRange: (
    month: string,
    employeeId: string,
    fromDay: number,
    toDay: number,
    code: DayCode,
  ) => void
}

const TABS: { id: HrInspectorSection; labelKey: string }[] = [
  { id: 'dashboard', labelKey: 'hrInspector.tab.dashboard' },
  { id: 'employees', labelKey: 'hrInspector.tab.employees' },
  { id: 'fired', labelKey: 'hr.tab.fired' },
  { id: 'rates', labelKey: 'hrInspector.tab.rates' },
  { id: 'contracts', labelKey: 'hrInspector.tab.contracts' },
  { id: 'documents', labelKey: 'hrInspector.tab.documents' },
  { id: 'trainings', labelKey: 'hrInspector.tab.trainings' },
  { id: 'absences', labelKey: 'hrInspector.tab.absences' },
  { id: 'foreign', labelKey: 'hrInspector.tab.foreign' },
  { id: 'attendance', labelKey: 'hrInspector.tab.attendance' },
]

const COMPACT_TAB_IDS = new Set<HrInspectorSection>([
  'dashboard',
  'contracts',
  'foreign',
  'attendance',
])

export function HrInspectorPage({
  employees,
  brigades: _brigades,
  hrStructuralUnits: _hrStructuralUnits,
  hrPositions: _hrPositions,
  existingMonthKeys,
  site,
  responsible,
  webInspectorMode = false,
  webUserName,
  compactWithHr = false,
  onSaveEmployee,
  onSetEmployeeFactRange,
}: Props) {
  const { t, tf, locale, employeeNameLines, employeePositionLines } = useI18n()
  const { confirm } = useConfirm()
  const employeeEditor = useEmployeeEditorApi()
  const [section, setSection] = useState<HrInspectorSection>('dashboard')
  const [docMonitorOpen, setDocMonitorOpen] = useState(false)
  const [docMonitorCategory, setDocMonitorCategory] = useState<DocMonitorCategory>('all')
  const [q, setQ] = useState('')
  const [docQ, setDocQ] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<HrStatus>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [docFilter, setDocFilter] = useState<'all' | 'expiring' | 'overdue'>('all')
  const [contractFilter, setContractFilter] = useState<'all' | 'expiring' | 'overdue'>('all')
  const firedCount = useMemo(
    () => employees.filter((e) => (e.hrStatus ?? 'active') === 'fired').length,
    [employees],
  )

  const visibleTabs = useMemo(
    () => (compactWithHr ? TABS.filter((tab) => COMPACT_TAB_IDS.has(tab.id)) : TABS),
    [compactWithHr],
  )

  useEffect(() => {
    if (compactWithHr && !COMPACT_TAB_IDS.has(section)) {
      setSection('dashboard')
    }
  }, [compactWithHr, section])

  const kpis = useMemo(() => computeHrKpis(employees), [employees])
  const foreignAlerts = useMemo(() => collectForeignPersonnelAlerts(employees), [employees])
  const docMonitorProblems = useMemo(
    () => countDocumentMonitorProblems(employees),
    [employees],
  )
  const contractProblems = useMemo(
    () => countDocumentMonitorProblems(employees, { category: 'contracts' }),
    [employees],
  )
  const missingContracts = useMemo(
    () => employeesMissingPrimaryContract(employees),
    [employees],
  )
  const contractAlertRows = useMemo(
    () => collectDocumentMonitorRows(employees, { onlyProblems: true, category: 'contracts' }).slice(0, 8),
    [employees],
  )
  const docAlertRows = useMemo(
    () => collectDocumentMonitorRows(employees, { onlyProblems: true, category: 'documents' }).slice(0, 8),
    [employees],
  )
  const allContracts = useMemo(() => allEmployeeContracts(employees), [employees])
  const allDocs = useMemo(() => allEmployeeDocuments(employees), [employees])
  const allAbs = useMemo(() => allEmployeeAbsences(employees), [employees])
  const allTrain = useMemo(() => allEmployeeTrainings(employees), [employees])

  const filteredEmployees = useMemo(() => {
    const s = q.trim().toLowerCase()
    return employees.filter((e) => {
      const status = e.hrStatus ?? 'active'
      if (statusFilters.size > 0) {
        if (!statusFilters.has(status)) return false
      } else if (status === 'fired') {
        return false
      }
      if (!s) return true
      return employeeSearchHr(e).includes(s)
    })
  }, [employees, q, statusFilters])

  const filteredDocs = useMemo(() => {
    const s = docQ.trim().toLowerCase()
    return allDocs.filter(({ employeeName, doc }) => {
      if (doc.docType === 'Трудовой договор') return false
      if (docFilter === 'expiring' && !isExpiringSoon(doc.expiresAt)) return false
      if (docFilter === 'overdue' && !isOverdue(doc.expiresAt)) return false
      if (!s) return true
      return (
        employeeName.toLowerCase().includes(s) ||
        doc.title.toLowerCase().includes(s) ||
        doc.docType.toLowerCase().includes(s)
      )
    })
  }, [allDocs, docQ, docFilter])

  const selected = employees.find((e) => e.id === selectedId) ?? null

  function openMonitor(category: DocMonitorCategory = 'all') {
    setDocMonitorCategory(category)
    setDocMonitorOpen(true)
  }

  function toggleStatus(status: HrStatus) {
    setStatusFilters((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  async function removeContractFromInspector(employeeId: string, contractId: string) {
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return
    const ok = await confirm({
      title: t('hr.contract.removeTitle'),
      message: t('hr.contract.removeConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('planner.cancel'),
      danger: true,
    })
    if (!ok) return
    onSaveEmployee(removeHrContractToTrash(emp, contractId))
  }

  async function removeDocumentFromInspector(employeeId: string, documentId: string) {
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return
    const ok = await confirm({
      title: t('hr.documents.removeTitle'),
      message: t('hr.documents.removeConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('planner.cancel'),
      danger: true,
    })
    if (!ok) return
    onSaveEmployee(removeHrDocumentToTrash(emp, documentId))
  }

  const dashboardKpis = [
    { label: t('hr.kpi.total'), value: kpis.total, onClick: () => { setStatusFilters(new Set()); setSection('employees') } },
    { label: t('hr.kpi.active'), value: kpis.active, tone: 'ok' as const, onClick: () => { setStatusFilters(new Set(['active'])); setSection('employees') } },
    { label: t('hr.kpi.contractMissing'), value: kpis.missingPrimaryContracts, tone: 'warn' as const, onClick: () => { setContractFilter('all'); setSection('contracts') } },
    { label: t('hr.kpi.contractOver'), value: kpis.overdueContracts, tone: 'warn' as const, onClick: () => { setContractFilter('overdue'); setSection('contracts') } },
    { label: t('hr.kpi.contractExp'), value: kpis.expiringContracts, tone: 'warn' as const, onClick: () => { setContractFilter('expiring'); setSection('contracts') } },
    { label: t('hr.kpi.fired'), value: kpis.fired, tone: 'warn' as const, onClick: () => setSection('fired') },
    { label: t('hr.kpi.docOver'), value: kpis.overdueDocs, tone: 'warn' as const, onClick: () => { setDocFilter('overdue'); setSection('documents') } },
    { label: t('hr.kpi.docExp'), value: kpis.expiringDocs, tone: 'warn' as const, onClick: () => { setDocFilter('expiring'); setSection('documents') } },
    { label: t('hr.kpi.trainOver'), value: kpis.overdueTrainings, tone: 'warn' as const, onClick: () => setSection('trainings') },
    { label: t('hrInspector.foreign.alertsTitle'), value: foreignAlerts.length, tone: 'warn' as const, onClick: () => setSection('foreign') },
  ]

  return (
    <PageLayout>
      <PageHeader
        badge={webInspectorMode ? t('web.hrInspector.badge') : t('hrInspector.badge')}
        title={
          webInspectorMode && webUserName
            ? tf('web.hrInspector.welcome', { name: webUserName })
            : t('hrInspector.title')
        }
        subtitle={webInspectorMode ? t('web.hrInspector.subtitle') : t('hrInspector.subtitle')}
        actions={
          <button
            type="button"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
            onClick={() => openMonitor('all')}
          >
            {docMonitorProblems.overdue + docMonitorProblems.expiring > 0
              ? `${t('hr.docMonitor.open')} (${docMonitorProblems.overdue + docMonitorProblems.expiring})`
              : t('hr.docMonitor.open')}
          </button>
        }
      />

      <TabBar
        coachPrefix="hr_inspector"
        tabs={visibleTabs.map((tab) => ({
          id: tab.id,
          label: t(tab.labelKey),
          count: tab.id === 'fired' ? firedCount : undefined,
        }))}
        value={section}
        onChange={setSection}
      />

      {compactWithHr ? (
        <SharedDataNotice>{t('sharedRoot.inspectorCompact')}</SharedDataNotice>
      ) : null}

      {section === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardKpis.map((item) => (
              <button
                key={item.label}
                type="button"
                className="text-left"
                onClick={item.onClick}
              >
                <KpiCard label={item.label} value={item.value} tone={item.tone} />
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                  {t('hrInspector.dashboard.contractsTitle')}
                </h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={() => openMonitor('contracts')}
                >
                  {t('hrInspector.dashboard.openMonitor')}
                </button>
              </div>
              <p className="mt-1 text-xs text-stone-500">{t('hrInspector.dashboard.contractsHint')}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-red-50 px-2 py-1 text-red-800">
                  {t('hr.kpi.contractOver')}: {contractProblems.overdue}
                </span>
                <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                  {t('hr.kpi.contractExp')}: {contractProblems.expiring}
                </span>
                <span className="rounded bg-stone-100 px-2 py-1 text-stone-700">
                  {t('hr.kpi.contractMissing')}: {missingContracts.length}
                </span>
              </div>
              {missingContracts.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-grid pt-3">
                  {missingContracts.slice(0, 6).map((row) => (
                    <li key={row.employeeId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-ink">{row.employeeName}</span>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-accent hover:underline"
                        onClick={() => {
                          setSelectedId(row.employeeId)
                          employeeEditor.openEdit(
                            employees.find((e) => e.id === row.employeeId)!,
                          )
                        }}
                      >
                        {t('hr.openCard')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {contractAlertRows.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-grid pt-3">
                  {contractAlertRows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{r.employeeName}</p>
                        <p className="truncate text-xs text-stone-500">
                          {r.title} · {r.expiresAt}
                          {r.days !== null ? ` (${r.days} ${t('hrInspector.days')})` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          r.severity === 'overdue'
                            ? 'bg-red-700 text-white'
                            : 'bg-amber-600 text-white'
                        }`}
                      >
                        {r.severity === 'overdue'
                          ? t('hr.docMonitor.badgeOverdue')
                          : t('hr.docMonitor.badgeExpiring')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {missingContracts.length === 0 && contractAlertRows.length === 0 && (
                <p className="mt-3 text-sm text-emerald-700">{t('hrInspector.dashboard.contractsOk')}</p>
              )}
            </section>

            <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                  {t('hrInspector.dashboard.docsTitle')}
                </h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={() => openMonitor('documents')}
                >
                  {t('hrInspector.dashboard.openMonitor')}
                </button>
              </div>
              <p className="mt-1 text-xs text-stone-500">{t('hrInspector.dashboard.docsHint')}</p>
              {docAlertRows.length === 0 ? (
                <p className="mt-3 text-sm text-emerald-700">{t('hrInspector.dashboard.docsOk')}</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {docAlertRows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{r.employeeName}</p>
                        <p className="truncate text-xs text-stone-500">
                          {r.docType} · {r.expiresAt}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          r.severity === 'overdue'
                            ? 'bg-red-700 text-white'
                            : 'bg-amber-600 text-white'
                        }`}
                      >
                        {r.severity === 'overdue'
                          ? t('hr.docMonitor.badgeOverdue')
                          : t('hr.docMonitor.badgeExpiring')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {t('hrInspector.dashboard.focus')}
            </h3>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
              <li>{t('hrInspector.dashboard.item1')}</li>
              <li>{t('hrInspector.dashboard.item2')}</li>
              <li>{t('hrInspector.dashboard.item3')}</li>
              <li>{t('hrInspector.dashboard.item4')}</li>
              <li>{t('hrInspector.dashboard.item5')}</li>
              <li>{t('hrInspector.dashboard.item6')}</li>
            </ul>
          </section>
        </div>
      )}

      {section === 'employees' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder={t('hr.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {(['active', 'vacation', 'sick'] as HrStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`rounded-sm border px-2 py-1 text-xs ${
                    statusFilters.has(status)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-grid text-stone-600'
                  }`}
                  onClick={() => toggleStatus(status)}
                >
                  {hrStatusLabel(status, locale)}
                </button>
              ))}
              <button
                type="button"
                className="btn-add"
                onClick={() => employeeEditor.openNew()}
                data-coach="hr_inspector:addEmployee"
              >
                {t('hr.addEmployee')}
              </button>
            </div>
            <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2">{t('hr.col.employee')}</th>
                    <th className="px-3 py-2">{t('hr.col.position')}</th>
                    <th className="px-3 py-2">{t('hr.col.dept')}</th>
                    <th className="px-3 py-2">{t('hr.col.status')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => (
                    <tr
                      key={emp.id}
                      className={`cursor-pointer border-t border-grid ${
                        selectedId === emp.id ? 'bg-sky-50' : 'hover:bg-stone-50'
                      }`}
                      onClick={() => setSelectedId(emp.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <EmployeePhoto
                            photoDataUrl={emp.photoDataUrl}
                            gender={emp.gender ?? 'unknown'}
                            className="h-9 w-9 shrink-0 rounded-sm object-cover ring-1 ring-grid"
                          />
                          <BilingualText
                            lines={employeeNameLines(emp)}
                            className="font-medium leading-snug text-ink"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <BilingualText
                          lines={employeePositionLines(emp)}
                          className="text-xs text-stone-600"
                        />
                      </td>
                      <td className="px-3 py-2">{emp.department ?? emp.brigade ?? '—'}</td>
                      <td className="px-3 py-2">{hrStatusLabel(emp.hrStatus ?? 'active', locale)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent hover:underline"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            setSelectedId(emp.id)
                            employeeEditor.openEdit(emp)
                          }}
                        >
                          {t('hr.openCard')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEmployees.length === 0 && (
                <p className="p-6 text-center text-sm text-stone-500">{t('hr.empty')}</p>
              )}
            </div>
          </div>
          <div>
            {selected ? (
              <HrPersonalFile
                employee={selected}
                onOpenFull={() => employeeEditor.openEdit(selected)}
                onSaveEmployee={onSaveEmployee}
              />
            ) : (
              <p className="rounded-sm border border-dashed border-grid p-6 text-sm text-stone-500">
                {t('hrInspector.pickEmployee')}
              </p>
            )}
          </div>
        </div>
      )}

      {section === 'fired' && (
        <HrFiredPanel
          employees={employees}
          onOpenEmployee={(emp) => employeeEditor.openEdit(emp)}
        />
      )}

      {section === 'rates' && (
        <HrStaffRatesPanel employees={employees} onSaveEmployee={onSaveEmployee} />
      )}

      {section === 'contracts' && (
        <div className="space-y-3">
          <p className="rounded-sm border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs text-teal-950">
            {t('hrInspector.contracts.hint')}
          </p>
          <HrEmploymentContractsPanel
            rows={allContracts}
            contractFilter={contractFilter}
            onContractFilterChange={setContractFilter}
            onRemove={(contractId) => {
              const row = allContracts.find((x) => x.contract.id === contractId)
              if (!row) return
              void removeContractFromInspector(row.employeeId, contractId)
            }}
            onOpenEmployee={(id) => {
              setSelectedId(id)
              employeeEditor.openEdit(employees.find((e) => e.id === id)!)
            }}
          />
        </div>
      )}

      {section === 'documents' && (
        <div className="space-y-3">
          <p className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
            {t('hrInspector.documents.hint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder={t('hr.search')}
              value={docQ}
              onChange={(e) => setDocQ(e.target.value)}
            />
            {(['all', 'expiring', 'overdue'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`rounded-sm border px-2 py-1 text-xs ${
                  docFilter === f ? 'border-accent bg-accent/10 text-accent' : 'border-grid text-stone-600'
                }`}
                onClick={() => setDocFilter(f)}
              >
                {t(`hrInspector.docFilter.${f}`)}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">{t('hr.col.employee')}</th>
                  <th className="px-3 py-2">{t('hr.col.type')}</th>
                  <th className="px-3 py-2">{t('hr.col.doc')}</th>
                  <th className="px-3 py-2">{t('hr.col.expires')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map(({ employeeId, employeeName, doc }) => {
                  const d = daysUntil(doc.expiresAt)
                  return (
                    <tr key={doc.id} className="border-t border-grid">
                      <td className="px-3 py-2">{employeeName}</td>
                      <td className="px-3 py-2">{doc.docType}</td>
                      <td className="px-3 py-2">{doc.title}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {doc.expiresAt ?? '—'}
                        {d !== null && d < 30 && (
                          <span className={`ml-1 ${d < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {d} {t('hrInspector.days')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <HrDocumentOpenButton doc={doc} />
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => void removeDocumentFromInspector(employeeId, doc.id)}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'trainings' && (
        <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('hr.col.name')}</th>
                <th className="px-3 py-2">{t('hr.col.training')}</th>
                <th className="px-3 py-2">{t('hr.col.expires')}</th>
              </tr>
            </thead>
            <tbody>
              {allTrain.map(({ employeeName, training }) => {
                const d = daysUntil(training.validUntil)
                return (
                  <tr key={training.id} className="border-t border-grid">
                    <td className="px-3 py-2">{employeeName}</td>
                    <td className="px-3 py-2">{training.title}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {training.validUntil ?? '—'}
                      {d !== null && d < 30 && (
                        <span className={`ml-1 ${d < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {d} {t('hrInspector.days')}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {section === 'absences' && (
        <div className="space-y-4">
          <HrVacationForm
            employees={employees}
            existingMonthKeys={existingMonthKeys}
            onSaveEmployee={onSaveEmployee}
            onSetEmployeeFactRange={onSetEmployeeFactRange}
          />
          <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">{t('hr.col.employee')}</th>
                  <th className="px-3 py-2">{t('hr.col.type')}</th>
                  <th className="px-3 py-2">{t('hr.col.period')}</th>
                </tr>
              </thead>
              <tbody>
                {allAbs.map(({ employeeName, absence }) => (
                  <tr key={absence.id} className="border-t border-grid">
                    <td className="px-3 py-2">{employeeName}</td>
                    <td className="px-3 py-2">{hrAbsenceLabel(absence.type, locale)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {absence.startDate} — {absence.endDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'foreign' && (
        <HrInspectorForeignPanel
          employees={employees}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            setSection('employees')
          }}
        />
      )}

      {section === 'attendance' && (
        <AttendanceLogPanel employees={employees} site={site ?? ''} responsible={responsible} />
      )}

      <HrDocumentsMonitorDialog
        key={`${docMonitorOpen}-${docMonitorCategory}`}
        open={docMonitorOpen}
        onClose={() => setDocMonitorOpen(false)}
        employees={employees}
        initialCategory={docMonitorCategory}
        onOpenEmployee={(id) => {
          const e = employees.find((x) => x.id === id)
          if (e) employeeEditor.openEdit(e)
        }}
      />
    </PageLayout>
  )
}
