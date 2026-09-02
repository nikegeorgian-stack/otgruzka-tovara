import { useMemo, useState } from 'react'
import { OfficeStaffPrintModal } from '@/components/office/OfficeStaffPrintModal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { SortableTableHeader } from '@/components/ui/SortableTableHeader'
import { useI18n } from '@/context/I18nContext'
import { CITIZENSHIP_OPTIONS } from '@/lib/hr/citizenship'
import { hrStatusLabel } from '@/lib/hr/labels'
import type { HrPosition, HrStatus, HrStructuralUnit } from '@/lib/hr/types'
import { sortEmployees, type EmployeeSortKey } from '@/lib/hr/employeeSort'
import { exportOfficeStaffExcel } from '@/lib/office/staffListExcel'
import {
  DEFAULT_OFFICE_STAFF_FIELDS,
  OFFICE_STAFF_GROUPS,
  fieldsForGroup,
  normalizeOfficeStaffFields,
  OFFICE_STAFF_FIELD_META,
  type OfficeStaffFieldId,
} from '@/lib/office/staffListFields'
import {
  EMPTY_OFFICE_STAFF_FILTER,
  filterOfficeStaff,
  type OfficeStaffFilter,
} from '@/lib/office/staffListFilter'
import { officeStaffCellValue, projectOfficeStaffTable } from '@/lib/office/staffListRows'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import { toggleTableSort, type TableSortState } from '@/lib/ui/tableSort'
import type { Employee, ScheduleType } from '@/lib/types'

const FIELDS_STORAGE_KEY = 'fst-office-staff-fields-v1'
const HR_STATUSES: HrStatus[] = ['active', 'vacation', 'sick', 'fired']
const FIELD_SORT_KEY: Partial<Record<OfficeStaffFieldId, EmployeeSortKey>> = {
  fullName: 'name',
  tabNumber: 'tab',
  employeeNumber: 'employeeNumber',
  position: 'position',
  unit: 'department',
  brigade: 'brigade',
  status: 'status',
  schedule: 'schedule',
  citizenship: 'citizenship',
}

function readStoredFields(): OfficeStaffFieldId[] {
  try {
    const raw = localStorage.getItem(FIELDS_STORAGE_KEY)
    if (!raw) return [...DEFAULT_OFFICE_STAFF_FIELDS]
    return normalizeOfficeStaffFields(JSON.parse(raw) as string[])
  } catch {
    return [...DEFAULT_OFFICE_STAFF_FIELDS]
  }
}

function writeStoredFields(ids: OfficeStaffFieldId[]) {
  try {
    localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
}

type Props = {
  employees: Employee[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  brigades: string[]
  site?: string
}

export function OfficePage({
  employees,
  hrStructuralUnits,
  hrPositions,
  brigades,
  site = '',
}: Props) {
  const { t, tf, locale } = useI18n()
  const [filter, setFilter] = useState<OfficeStaffFilter>(EMPTY_OFFICE_STAFF_FILTER)
  const [fields, setFields] = useState<OfficeStaffFieldId[]>(readStoredFields)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<TableSortState<EmployeeSortKey>>({ key: 'name', dir: 'asc' })
  const [printOpen, setPrintOpen] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const [exportError, setExportError] = useState(false)

  const units = useMemo(
    () => [...hrStructuralUnits].filter((u) => !u.archived).sort((a, b) => a.sortOrder - b.sortOrder),
    [hrStructuralUnits],
  )

  const positionOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of hrPositions) if (p.title.trim()) set.add(p.title.trim())
    for (const e of employees) if (e.position.trim()) set.add(e.position.trim())
    return [...set].sort((a, b) => a.localeCompare(b, locale === 'ka' ? 'ka' : 'ru'))
  }, [employees, hrPositions, locale])

  const filtered = useMemo(() => {
    const list = filterOfficeStaff(employees, units, filter)
    return sortEmployees(list, sort, locale)
  }, [employees, units, filter, sort, locale])

  const fieldLabels = useMemo(() => {
    const out = {} as Record<OfficeStaffFieldId, string>
    for (const id of fields) out[id] = t(OFFICE_STAFF_FIELD_META[id].labelKey)
    return out
  }, [fields, t])

  const rowCtx = useMemo(
    () => ({
      locale,
      units,
      genderLabel: (g: string | undefined) => {
        if (g === 'male' || g === 'female' || g === 'unknown') return t(`hr.gender.${g}`)
        return t('hr.gender.unknown')
      },
    }),
    [locale, units, t],
  )

  const exportEmployees = useMemo(() => {
    if (selected.size === 0) return filtered
    return filtered.filter((e) => selected.has(e.id))
  }, [filtered, selected])

  const table = useMemo(
    () => projectOfficeStaffTable(exportEmployees, fields, rowCtx, fieldLabels),
    [exportEmployees, fields, rowCtx, fieldLabels],
  )

  function patchFilter(patch: Partial<OfficeStaffFilter>) {
    setFilter((prev) => ({ ...prev, ...patch }))
  }

  function setFieldOn(id: OfficeStaffFieldId, on: boolean) {
    setFields((prev) => {
      const next = on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)
      const normalized = normalizeOfficeStaffFields(next.length ? next : [id])
      writeStoredFields(normalized)
      return normalized
    })
  }

  function resetFields() {
    setFields([...DEFAULT_OFFICE_STAFF_FIELDS])
    writeStoredFields([...DEFAULT_OFFICE_STAFF_FIELDS])
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((e) => selected.has(e.id))

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(filtered.map((e) => e.id)))
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openPrint() {
    if (exportEmployees.length === 0 || fields.length === 0) {
      setExportError(true)
      return
    }
    setExportError(false)
    setPrintOpen(true)
  }

  async function downloadExcel() {
    if (exportEmployees.length === 0 || fields.length === 0) {
      setExportError(true)
      return
    }
    setExportError(false)
    setExcelBusy(true)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      await exportOfficeStaffExcel({
        headers: table.headers,
        rows: table.rows,
        fields,
        filename: `office-staff-${stamp}.xlsx`,
        locale,
        site,
      })
    } finally {
      setExcelBusy(false)
    }
  }

  return (
    <PageLayout>
      <PageHeader
        badge={t('office.badge')}
        title={t('office.title')}
        subtitle={t('office.subtitle')}
        density="compact"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="print" size="sm" type="button" onClick={openPrint}>
              {t('office.print')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={excelBusy}
              onClick={() => void downloadExcel()}
            >
              {t('office.excel')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('office.kpi.total')} value={employees.length} />
        <KpiCard label={t('office.kpi.filtered')} value={filtered.length} />
        <KpiCard
          label={t('office.kpi.selected')}
          value={selected.size === 0 ? filtered.length : selected.size}
          hint={selected.size === 0 ? t('office.kpi.allFilteredHint') : undefined}
        />
      </div>

      <section className="space-y-3 rounded-sm border border-grid bg-white p-3 sm:p-4">
        <p className="text-sm font-semibold text-ink">{t('office.filters')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            value={filter.query}
            onChange={(e) => patchFilter({ query: e.target.value })}
            placeholder={t('office.search')}
            className="min-w-[14rem] flex-1"
          />
          <select
            className="rounded-sm border border-grid bg-white px-3 py-2 text-sm min-w-[10rem]"
            value={filter.unitIds[0] ?? ''}
            onChange={(e) => patchFilter({ unitIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('office.allUnits')}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-sm border border-grid bg-white px-3 py-2 text-sm min-w-[10rem]"
            value={filter.positions[0] ?? ''}
            onChange={(e) => patchFilter({ positions: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('office.allPositions')}</option>
            {positionOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            className="min-w-[9rem] rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={filter.brigades[0] ?? ''}
            onChange={(e) => patchFilter({ brigades: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('office.allBrigades')}</option>
            {brigades.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            className="min-w-[8rem] rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={filter.schedules[0] ?? ''}
            onChange={(e) =>
              patchFilter({
                schedules: e.target.value ? [e.target.value as ScheduleType] : [],
              })
            }
          >
            <option value="">{t('office.allSchedules')}</option>
            {SCHEDULE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="min-w-[8rem] rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={filter.citizenships[0] ?? ''}
            onChange={(e) => patchFilter({ citizenships: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('office.allCitizenships')}</option>
            {CITIZENSHIP_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {locale === 'ka' ? c.labelKa : c.labelRu}
              </option>
            ))}
          </select>
          <select
            className="min-w-[8rem] rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={filter.genders[0] ?? ''}
            onChange={(e) => patchFilter({ genders: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('office.allGenders')}</option>
            <option value="male">{t('hr.gender.male')}</option>
            <option value="female">{t('hr.gender.female')}</option>
            <option value="unknown">{t('hr.gender.unknown')}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-stone-600">
            {t('office.hireFrom')}
            <Input
              type="date"
              value={filter.hireFrom}
              onChange={(e) => patchFilter({ hireFrom: e.target.value })}
              className="w-[9.5rem]"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-stone-600">
            {t('office.hireTo')}
            <Input
              type="date"
              value={filter.hireTo}
              onChange={(e) => patchFilter({ hireTo: e.target.value })}
              className="w-[9.5rem]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {HR_STATUSES.map((s) => {
            const on = filter.statuses.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => patchFilter({ statuses: toggleInList(filter.statuses, s) })}
                className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-semibold transition ${
                  on
                    ? 'border-accent bg-accent text-white'
                    : 'border-grid bg-white text-stone-600 hover:border-accent/60'
                }`}
              >
                {hrStatusLabel(s, locale)}
              </button>
            )
          })}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={filter.includeFired}
              onChange={(e) => patchFilter({ includeFired: e.target.checked })}
            />
            {t('office.includeFired')}
          </label>
        </div>
      </section>

      <section className="space-y-2 rounded-sm border border-grid bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{t('office.columns')}</p>
          <Button variant="ghost" size="xs" type="button" onClick={resetFields}>
            {t('office.columnsReset')}
          </Button>
        </div>
        {OFFICE_STAFF_GROUPS.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-28 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t(g.labelKey)}
            </span>
            {fieldsForGroup(g.id).map((id) => {
              const on = fields.includes(id)
              return (
                <label key={id} className="flex items-center gap-1.5 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setFieldOn(id, e.target.checked)}
                  />
                  {t(OFFICE_STAFF_FIELD_META[id].labelKey)}
                </label>
              )
            })}
          </div>
        ))}
      </section>

      {exportError ? (
        <p className="text-sm text-red-700">{t('office.exportEmpty')}</p>
      ) : null}

      <div className="overflow-auto rounded-sm border border-grid bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  aria-label={t('office.selectAll')}
                />
              </th>
              {fields.map((id) => {
                const sortKey = FIELD_SORT_KEY[id]
                if (!sortKey) {
                  return (
                    <th key={id} className="px-2 py-2 font-semibold">
                      {fieldLabels[id]}
                    </th>
                  )
                }
                return (
                  <SortableTableHeader
                    key={id}
                    label={fieldLabels[id]}
                    sortKey={sortKey}
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={(key) => setSort((prev) => toggleTableSort(prev, key))}
                    className="px-2 py-2"
                  />
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-stone-500" colSpan={fields.length + 1}>
                  {t('office.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="border-t border-grid hover:bg-stone-50">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggleRow(e.id)}
                    />
                  </td>
                  {fields.map((id) => (
                    <td key={id} className="whitespace-nowrap px-2 py-1.5 text-ink">
                      {officeStaffCellValue(e, id, rowCtx) || '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        {tf('office.tableHint', { n: filtered.length })}
        {selected.size > 0 ? ` · ${tf('office.selectedHint', { n: selected.size })}` : ''}
      </p>
      {printOpen ? (
        <OfficeStaffPrintModal
          headers={table.headers}
          rows={table.rows}
          site={site}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}
    </PageLayout>
  )
}
