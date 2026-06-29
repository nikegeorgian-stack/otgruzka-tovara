import { useMemo, useState, useEffect } from 'react'
import { AttendanceLogPanel } from '@/components/hr/AttendanceLogPanel'
import { BilingualText } from '@/components/employee/BilingualText'
import { CandidatesPanel } from '@/components/hr/CandidatesPanel'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { HrPersonalFile } from '@/components/hr/HrPersonalFile'
import { HrRegistryImportPanel } from '@/components/hr/HrRegistryImportPanel'
import { HrTrashPanel } from '@/components/hr/HrTrashPanel'
import { HrVacationForm } from '@/components/hr/HrVacationForm'
import { PayrollPanel } from '@/components/hr/PayrollPanel'
import { WorkshopMasterRosterPanel } from '@/components/hr/WorkshopMasterRosterPanel'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { isSysAdmin } from '@/lib/access/permissions'
import type { AppUser } from '@/lib/access/types'
import { newId } from '@/lib/hr/files'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { hrStatusLabel } from '@/lib/hr/labels'
import { terminationSegments } from '@/lib/hr/timesheetRange'
import {
  allEmployeeAbsences,
  allEmployeeDocuments,
  allEmployeeTrainings,
  computeHrKpis,
  daysUntil,
  isExpiringSoon,
  isOverdue,
} from '@/lib/hr/stats'
import { employeeSearchHr } from '@/lib/hr/sync'
import type { Candidate, DayCode, HrContractType, HrPosition, HrSection, HrStatus, HrStructuralUnit } from '@/lib/types'
import type { Employee, AppStore } from '@/lib/types'

export type HrPageProps = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  initialSection?: HrSection
  employees: Employee[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  brigades: string[]
  currentUser?: AppUser | null
  candidates: Candidate[]
  onSaveEmployee: (e: Employee) => void
  onRemoveEmployee: (id: string) => void
  onUpsertCandidate: (c: Candidate) => void
  onRemoveCandidate: (id: string) => void
  onHireCandidate: (id: string) => void
  onSetEmployeeFactRange: (
    month: string,
    employeeId: string,
    fromDay: number,
    toDay: number,
    code: DayCode,
  ) => void
  onRestoreTrashEmployee: (deletedAt: string) => void
  onPurgeTrashEmployee: (deletedAt: string) => void
  onRestoreTrashCandidate: (deletedAt: string) => void
  onPurgeTrashCandidate: (deletedAt: string) => void
  onUpsertPosition: (p: HrPosition) => void
  onImportEmployeeRegistry?: (employees: Employee[]) => void
  onClearAllPersonnel?: () => void
  onSectionChange?: (section: HrSection) => void
  /** Облачный кабинет HR — без лишних вкладок */
  webHrMode?: boolean
  /** Мастер цеха — только просмотр списка (ФИО, должность, договор) */
  workshopMasterMode?: boolean
  webUserName?: string
}

const HR_WEB_SECTIONS: HrSection[] = [
  'employees',
  'cards',
  'documents',
  'absences',
  'trainings',
  'pay',
]

const HR_TABS: { id: HrSection; labelKey: string }[] = [
  { id: 'employees', labelKey: 'hr.tab.employees' },
  { id: 'cards', labelKey: 'hr.tab.cards' },
  { id: 'candidates', labelKey: 'hr.tab.candidates' },
  { id: 'documents', labelKey: 'hr.tab.documents' },
  { id: 'absences', labelKey: 'hr.tab.absences' },
  { id: 'trainings', labelKey: 'hr.tab.trainings' },
  { id: 'pay', labelKey: 'hr.tab.pay' },
  { id: 'trash', labelKey: 'hr.tab.trash' },
  { id: 'reports', labelKey: 'hr.tab.reports' },
  { id: 'settings', labelKey: 'hr.tab.settings' },
]

export function HrPage({
  store,
  month,
  onMonthChange,
  initialSection = 'employees',
  employees,
  hrStructuralUnits,
  hrPositions,
  brigades,
  currentUser,
  candidates,
  onSaveEmployee,
  onRemoveEmployee,
  onUpsertCandidate,
  onRemoveCandidate,
  onHireCandidate,
  onSetEmployeeFactRange,
  onRestoreTrashEmployee,
  onPurgeTrashEmployee,
  onRestoreTrashCandidate,
  onPurgeTrashCandidate,
  onUpsertPosition,
  onImportEmployeeRegistry,
  onClearAllPersonnel,
  onSectionChange,
  webHrMode = false,
  workshopMasterMode = false,
  webUserName,
}: HrPageProps) {
  const { t, tf, locale, employeeNameLines, employeePositionLines } = useI18n()
  const { confirm } = useConfirm()
  const admin = isSysAdmin(currentUser)
  const visibleTabs = useMemo(
    () =>
      webHrMode
        ? HR_TABS.filter((tab) =>
            [...HR_WEB_SECTIONS, ...(admin ? (['settings'] as HrSection[]) : [])].includes(
              tab.id,
            ),
          )
        : HR_TABS.filter((tab) => (tab.id === 'trash' ? admin : true)),
    [webHrMode, admin],
  )
  const [section, setSection] = useState<HrSection>(initialSection)
  const [q, setQ] = useState('')
  const [docQ, setDocQ] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<HrStatus>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function toggleStatus(s: HrStatus) {
    setStatusFilters((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }
  const employeeEditor = useEmployeeEditor(brigades, employees)
  const [showPosition, setShowPosition] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [newPos, setNewPos] = useState({
    title: '',
    department: '',
    grade: '',
    salary: 0,
    currency: 'GEL' as const,
    contractType: 'full_time' as HrContractType,
    probationMonths: 0,
    schedule: '',
    duties: '',
  })

  const kpis = useMemo(() => computeHrKpis(employees), [employees])

  const departments = useMemo(() => {
    const s = new Set<string>()
    for (const e of employees) {
      if (e.department) s.add(e.department)
      else if (e.brigade) s.add(e.brigade)
    }
    return [...s].sort()
  }, [employees])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return employees.filter((e) => {
      if (deptFilter && (e.department ?? e.brigade) !== deptFilter) return false
      if (statusFilters.size > 0 && !statusFilters.has(e.hrStatus ?? 'active')) return false
      if (!s) return true
      return employeeSearchHr(e).includes(s)
    })
  }, [employees, q, deptFilter, statusFilters])

  const selected = employees.find((e) => e.id === selectedId) ?? null
  const allDocs = useMemo(() => allEmployeeDocuments(employees), [employees])
  const allAbs = useMemo(() => allEmployeeAbsences(employees), [employees])
  const allTrain = useMemo(() => allEmployeeTrainings(employees), [employees])

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  function submitPosition(e: React.FormEvent) {
    e.preventDefault()
    if (!newPos.title.trim()) {
      setNotice('Укажите название должности')
      return
    }
    onUpsertPosition({
      id: newId(),
      title: newPos.title.trim(),
      department: newPos.department.trim() || t('hr.settings.defaultDept'),
      grade: newPos.grade.trim() || undefined,
      salary: Number(newPos.salary) || 0,
      currency: newPos.currency,
      contractType: newPos.contractType,
      probationMonths: newPos.probationMonths || undefined,
      schedule: newPos.schedule.trim() || undefined,
      duties: newPos.duties.trim() || undefined,
    })
    setShowPosition(false)
    setNewPos({
      title: '',
      department: '',
      grade: '',
      salary: 0,
      currency: 'GEL',
      contractType: 'full_time',
      probationMonths: 0,
      schedule: '',
      duties: '',
    })
    setNotice(null)
  }

  function handleSaveEmployee(updated: Employee) {
    const prev = employees.find((e) => e.id === updated.id)
    onSaveEmployee(updated)
    // Увольнение: очищаем факт в табеле с даты увольнения и далее.
    if (updated.hrStatus === 'fired' && updated.terminationDate) {
      const changed =
        !prev ||
        prev.hrStatus !== 'fired' ||
        prev.terminationDate !== updated.terminationDate
      if (changed) {
        const segs = terminationSegments(Object.keys(store.months), updated.terminationDate)
        for (const seg of segs) {
          onSetEmployeeFactRange(seg.monthKey, updated.id, seg.fromDay, seg.toDay, '')
        }
      }
    }
  }

  async function handleDeleteEmployee(e: Employee) {
    const ok = await confirm({
      message: t('hr.deleteConfirm').replace('{name}', e.fullName || '—'),
      danger: true,
    })
    if (!ok) return
    if (selectedId === e.id) setSelectedId(null)
    onRemoveEmployee(e.id)
  }

  type KpiAction =
    | { kind: 'status'; statuses: HrStatus[] }
    | { kind: 'clear' }
    | { kind: 'section'; section: HrSection }
    | undefined

  const kpiItems: {
    label: string
    value: number
    tone?: 'ok' | 'warn'
    action?: KpiAction
    active?: boolean
  }[] = [
    { label: t('hr.kpi.total'), value: kpis.total, action: { kind: 'clear' }, active: statusFilters.size === 0 },
    {
      label: t('hr.kpi.active'),
      value: kpis.active,
      tone: 'ok',
      action: { kind: 'status', statuses: ['active'] },
      active: statusFilters.has('active'),
    },
    {
      label: t('hr.kpi.leave'),
      value: kpis.vacationSick,
      action: { kind: 'status', statuses: ['vacation', 'sick'] },
      active: statusFilters.has('vacation') || statusFilters.has('sick'),
    },
    {
      label: t('hr.kpi.fired'),
      value: kpis.fired,
      action: { kind: 'status', statuses: ['fired'] },
      active: statusFilters.has('fired'),
    },
    { label: t('hr.kpi.candidates'), value: candidates.length, action: { kind: 'section', section: 'candidates' } },
    { label: t('hr.kpi.docExp'), value: kpis.expiringDocs, tone: 'warn', action: { kind: 'section', section: 'documents' } },
    { label: t('hr.kpi.docOver'), value: kpis.overdueDocs, tone: 'warn', action: { kind: 'section', section: 'documents' } },
    { label: t('hr.kpi.trainOver'), value: kpis.overdueTrainings, tone: 'warn', action: { kind: 'section', section: 'trainings' } },
  ]

  function runKpiAction(action: KpiAction) {
    if (!action) return
    if (action.kind === 'clear') {
      setStatusFilters(new Set())
      if (section !== 'employees' && section !== 'cards') changeSection('employees')
      return
    }
    if (action.kind === 'status') {
      setStatusFilters(new Set(action.statuses))
      if (section !== 'employees' && section !== 'cards') changeSection('employees')
      return
    }
    if (action.kind === 'section') changeSection(action.section)
  }

  function changeSection(id: HrSection) {
    setSection(id)
    onSectionChange?.(id)
  }

  if (workshopMasterMode) {
    return (
      <PageLayout>
        <PageHeader
          badge={t('web.workshopMaster.badge')}
          title={
            webUserName
              ? tf('web.workshopMaster.welcome', { name: webUserName })
              : t('web.workshopMaster.title')
          }
          subtitle={t('web.workshopMaster.pageSubtitle')}
        />
        <WorkshopMasterRosterPanel employees={employees} />
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <PageHeader
        badge={webHrMode ? t('web.hr.badge') : t('hr.badge')}
        title={
          webHrMode && webUserName
            ? tf('web.hr.welcome', { name: webUserName })
            : t('hr.title')
        }
        subtitle={webHrMode ? t('web.hr.pageSubtitle') : t('hr.subtitle')}
      />

      {notice && (
        <FormNotice type="error" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {kpiItems.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => runKpiAction(k.action)}
              className={`rounded-sm text-left transition focus:outline-none ${
                k.action ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : 'cursor-default'
              } ${k.active ? 'ring-2 ring-accent ring-offset-1' : ''}`}
            >
              <KpiCard label={k.label} value={k.value} tone={k.tone ?? 'default'} />
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-stone-400">{t('hr.kpi.filterHint')}</p>
      </div>

      <TabBar
        tabs={visibleTabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
        value={section}
        onChange={(id) => changeSection(id)}
      />

      {(section === 'employees' || section === 'cards') && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="min-w-[14rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
              placeholder={t('hr.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="">{t('hr.allDepartments')}</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-1.5" title={t('hr.filterStatusHint')}>
              {(['active', 'vacation', 'sick', 'fired'] as HrStatus[]).map((s) => {
                const on = statusFilters.has(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-semibold transition ${
                      on
                        ? 'border-accent bg-accent text-white'
                        : 'border-grid bg-white text-stone-600 hover:border-accent/60'
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] ${
                        on ? 'border-white bg-white/20' : 'border-stone-300'
                      }`}
                    >
                      {on ? '✓' : ''}
                    </span>
                    {hrStatusLabel(s, locale)}
                  </button>
                )
              })}
              {statusFilters.size > 0 && (
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 text-xs text-stone-400 hover:text-stone-600"
                  onClick={() => setStatusFilters(new Set())}
                >
                  ✕ {t('hr.allStatuses')}
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn-add"
              onClick={() => employeeEditor.openNew()}
            >
              {t('hr.addEmployee')}
            </button>
            <button
              type="button"
              className="btn-add-outline px-4 py-2 text-sm"
              onClick={() => setShowPosition(true)}
            >
              {t('hr.addPosition')}
            </button>
          </div>

          <div
            className={
              section === 'cards' && selected
                ? 'grid gap-4 lg:grid-cols-2'
                : ''
            }
          >
            <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2">ФИО</th>
                    <th className="px-3 py-2">№</th>
                    <th className="px-3 py-2">{t('hr.col.dept')}</th>
                    <th className="px-3 py-2">{t('hr.col.status')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      className={`border-t border-grid cursor-pointer hover:bg-orange-50/40 ${
                        selectedId === e.id ? 'bg-orange-50' : ''
                      }`}
                      onClick={() => {
                        setSelectedId(e.id)
                        if (section === 'employees') employeeEditor.openEdit(e)
                      }}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <EmployeePhoto
                            photoDataUrl={e.photoDataUrl}
                            gender={e.gender ?? 'unknown'}
                            className="h-9 w-9 shrink-0 rounded-sm object-cover ring-1 ring-grid"
                          />
                          <div className="min-w-0 flex flex-col gap-1">
                            <BilingualText
                              lines={employeeNameLines(e)}
                              className="font-medium leading-snug text-ink"
                            />
                            <BilingualText
                              lines={employeePositionLines(e)}
                              className="text-xs leading-snug text-stone-400"
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-stone-500">{e.tabNumber}</td>
                      <td className="px-3 py-2.5 text-xs">{e.department ?? e.brigade}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                            (e.hrStatus ?? 'active') === 'fired'
                              ? 'bg-red-100 text-red-700'
                              : (e.hrStatus ?? 'active') === 'active'
                                ? 'bg-teal-100 text-teal-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {hrStatusLabel(e.hrStatus ?? 'active', locale)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            className="text-xs font-semibold text-accent hover:underline"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              employeeEditor.openEdit(e)
                            }}
                          >
                            {t('hr.openCard')}
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              void handleDeleteEmployee(e)
                            }}
                          >
                            {t('hr.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="p-6 text-center text-sm text-stone-500">{t('hr.empty')}</p>
              )}
            </div>

            {section === 'cards' && selected && (
              <HrPersonalFile
                employee={selected}
                onOpenFull={() => employeeEditor.openEdit(selected)}
              />
            )}
          </div>
        </>
      )}

      {section === 'documents' && (
        <div className="space-y-3">
          <input
            className="w-full max-w-md rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            placeholder={t('hr.docSearch')}
            value={docQ}
            onChange={(e) => setDocQ(e.target.value)}
          />
          <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('hr.col.employee')}</th>
                <th className="px-3 py-2">{t('hr.col.doc')}</th>
                <th className="px-3 py-2">{t('hr.col.expires')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {allDocs
                .filter(({ employeeName, doc }) => {
                  const s = docQ.trim().toLowerCase()
                  if (!s) return true
                  return `${employeeName} ${doc.title} ${doc.docType}`.toLowerCase().includes(s)
                })
                .map(({ employeeId, employeeName, doc }) => (
                <tr key={`${employeeId}-${doc.id}`} className="border-t border-grid">
                  <td className="px-3 py-2">{employeeName}</td>
                  <td className="px-3 py-2">
                    {doc.title}{' '}
                    <span className="text-xs text-stone-500">{doc.docType}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {doc.expiresAt ?? '—'}
                    {doc.expiresAt && isOverdue(doc.expiresAt) && (
                      <span className="ml-1 text-red-600">!</span>
                    )}
                    {doc.expiresAt && isExpiringSoon(doc.expiresAt) && !isOverdue(doc.expiresAt) && (
                      <span className="ml-1 text-amber-600">⚠</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <HrDocumentOpenButton doc={doc} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {section === 'candidates' && (
        <CandidatesPanel
          candidates={candidates}
          onUpsert={onUpsertCandidate}
          onRemove={onRemoveCandidate}
          onHire={onHireCandidate}
        />
      )}

      {section === 'trash' && (
        <HrTrashPanel
          admin={admin}
          trash={store.trash}
          onRestoreEmployee={onRestoreTrashEmployee}
          onPurgeEmployee={onPurgeTrashEmployee}
          onRestoreCandidate={onRestoreTrashCandidate}
          onPurgeCandidate={onPurgeTrashCandidate}
        />
      )}

      {section === 'absences' && (
        <div className="space-y-4">
          <HrVacationForm
            employees={employees}
            existingMonthKeys={Object.keys(store.months)}
            onSaveEmployee={onSaveEmployee}
            onSetEmployeeFactRange={onSetEmployeeFactRange}
          />
          <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
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
                  <td className="px-3 py-2">{absence.type}</td>
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

      {section === 'trainings' && (
        <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('hr.col.employee')}</th>
                <th className="px-3 py-2">{t('hr.col.training')}</th>
                <th className="px-3 py-2">{t('hr.col.validUntil')}</th>
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
                        <span className="ml-1 text-amber-600">{d} дн.</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {section === 'pay' && (
        <div className="space-y-4">
          <AttendanceLogPanel
            employees={employees}
            site={store.settings.site}
            responsible={store.settings.responsible}
          />
          <PayrollPanel store={store} month={month} onMonthChange={onMonthChange} />
        </div>
      )}

      {section === 'reports' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: t('hr.report.headcount'), value: kpis.total },
            { title: t('hr.report.active'), value: kpis.active },
            { title: t('hr.report.leave'), value: kpis.vacationSick },
            { title: t('hr.report.fired'), value: kpis.fired },
            { title: t('hr.report.docAlerts'), value: kpis.expiringDocs + kpis.overdueDocs },
            { title: t('hr.report.trainAlerts'), value: kpis.expiringTrainings + kpis.overdueTrainings },
          ].map((r) => (
            <section
              key={r.title}
              className="rounded-sm border border-grid bg-white p-5 shadow-sm"
            >
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                {r.title}
              </h3>
              <p className="mt-2 font-mono text-3xl font-bold text-ink">{r.value}</p>
            </section>
          ))}
          </div>
        </div>
      )}

      {section === 'settings' && (
        <div className="space-y-4">
          {onImportEmployeeRegistry && (!webHrMode || admin) && (
            <HrRegistryImportPanel
              employees={employees}
              brigades={brigades}
              onImport={onImportEmployeeRegistry}
              onClearAllPersonnel={onClearAllPersonnel}
            />
          )}
          <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {t('hr.settings.positions')}
            </h3>
            <p className="mt-1 text-xs text-stone-500">{t('directories.positionsHint')}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {hrPositions.map((p) => (
                <li key={p.id} className="flex justify-between border-b border-grid py-2">
                  <span>
                    {p.title} · {p.department}
                  </span>
                  <span className="font-mono text-xs text-stone-500">
                    {p.salary} {p.currency}
                  </span>
                </li>
              ))}
              {hrPositions.length === 0 && (
                <li className="text-stone-500">{t('hr.settings.emptyPositions')}</li>
              )}
            </ul>
          </section>
          <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {t('hr.settings.departments')}
            </h3>
            <p className="mt-2 text-sm text-stone-600">{departments.join(', ') || '—'}</p>
          </section>
          <p className="text-xs text-stone-500">{t('hr.settings.hint')}</p>
        </div>
      )}

      <AppDialog
        open={showPosition}
        onClose={() => setShowPosition(false)}
        title={t('hr.addPosition')}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowPosition(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" type="submit" form="hr-position-form">
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <form id="hr-position-form" onSubmit={submitPosition} className="grid gap-3 px-5 py-4">
          <Input
            required
            placeholder={t('hr.position')}
            value={newPos.title}
            onChange={(e) => setNewPos((p) => ({ ...p, title: e.target.value }))}
          />
          <Input
            placeholder={t('hr.col.dept')}
            value={newPos.department}
            onChange={(e) => setNewPos((p) => ({ ...p, department: e.target.value }))}
          />
          <Input
            type="number"
            placeholder={t('directories.col.salary')}
            value={newPos.salary || ''}
            onChange={(e) => setNewPos((p) => ({ ...p, salary: Number(e.target.value) }))}
          />
        </form>
      </AppDialog>

      <EmployeeEditorHost
        ctx={employeeEditor.ctx}
        employees={employees}
        brigades={brigades}
        hrStructuralUnits={hrStructuralUnits}
        hrPositions={hrPositions}
        onSave={(e) => {
          handleSaveEmployee(e)
          employeeEditor.close()
        }}
        onClose={employeeEditor.close}
      />
    </PageLayout>
  )
}
