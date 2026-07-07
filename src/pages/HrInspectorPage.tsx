import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { AttendanceLogPanel } from '@/components/hr/AttendanceLogPanel'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { HrInspectorForeignPanel } from '@/components/hr/HrInspectorForeignPanel'
import { HrPersonalFile } from '@/components/hr/HrPersonalFile'
import { HrVacationForm } from '@/components/hr/HrVacationForm'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { hrAbsenceLabel, hrStatusLabel } from '@/lib/hr/labels'
import { collectForeignPersonnelAlerts } from '@/lib/hr/inspector'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import { employeeSearchHr } from '@/lib/hr/sync'
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
  | 'cards'
  | 'documents'
  | 'trainings'
  | 'absences'
  | 'foreign'
  | 'attendance'

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
  { id: 'cards', labelKey: 'hrInspector.tab.cards' },
  { id: 'documents', labelKey: 'hrInspector.tab.documents' },
  { id: 'trainings', labelKey: 'hrInspector.tab.trainings' },
  { id: 'absences', labelKey: 'hrInspector.tab.absences' },
  { id: 'foreign', labelKey: 'hrInspector.tab.foreign' },
  { id: 'attendance', labelKey: 'hrInspector.tab.attendance' },
]

export function HrInspectorPage({
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  existingMonthKeys,
  site,
  responsible,
  webInspectorMode = false,
  webUserName,
  onSaveEmployee,
  onSetEmployeeFactRange,
}: Props) {
  const { t, tf, locale, employeeNameLines, employeePositionLines } = useI18n()
  const employeeEditor = useEmployeeEditor(brigades, employees)
  const [section, setSection] = useState<HrInspectorSection>('dashboard')
  const [q, setQ] = useState('')
  const [docQ, setDocQ] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<HrStatus>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [docFilter, setDocFilter] = useState<'all' | 'expiring' | 'overdue'>('all')

  const kpis = useMemo(() => computeHrKpis(employees), [employees])
  const foreignAlerts = useMemo(() => collectForeignPersonnelAlerts(employees), [employees])
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

  function toggleStatus(status: HrStatus) {
    setStatusFilters((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const dashboardKpis = [
    { label: t('hr.kpi.total'), value: kpis.total, onClick: () => { setStatusFilters(new Set()); setSection('employees') } },
    { label: t('hr.kpi.active'), value: kpis.active, tone: 'ok' as const, onClick: () => { setStatusFilters(new Set(['active'])); setSection('employees') } },
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
      />

      <TabBar
        tabs={TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
        value={section}
        onChange={setSection}
      />

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
            </ul>
          </section>
        </div>
      )}

      {(section === 'employees' || section === 'cards') && (
        <div
          className={
            section === 'cards' && selected ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]' : 'space-y-3'
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder={t('hr.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {(['active', 'vacation', 'sick', 'fired'] as HrStatus[]).map((status) => (
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
                      onClick={() => {
                        setSelectedId(emp.id)
                        employeeEditor.openEdit(emp)
                      }}
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
          {section === 'cards' && (
            <div>
              {selected ? (
                <HrPersonalFile
                  employee={selected}
                  onOpenFull={() => employeeEditor.openEdit(selected)}
                />
              ) : (
                <p className="rounded-sm border border-dashed border-grid p-6 text-sm text-stone-500">
                  {t('hrInspector.pickEmployee')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {section === 'documents' && (
        <div className="space-y-3">
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
                {filteredDocs.map(({ employeeName, doc }) => {
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
                        <HrDocumentOpenButton doc={doc} />
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

      <EmployeeEditorHost
        ctx={employeeEditor.ctx}
        employees={employees}
        brigades={brigades}
        hrStructuralUnits={hrStructuralUnits}
        hrPositions={hrPositions}
        onSave={(e) => {
          onSaveEmployee(e)
          employeeEditor.close()
        }}
        onClose={employeeEditor.close}
      />
    </PageLayout>
  )
}
