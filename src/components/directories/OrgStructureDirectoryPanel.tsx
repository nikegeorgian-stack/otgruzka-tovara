import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { PositionStaffAssignDialog } from '@/components/hr/PositionStaffAssignDialog'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { newId } from '@/lib/hr/files'
import { employeesOnPosition, slugUnitId } from '@/lib/hr/orgStructure'
import type { Employee, HrPosition, HrStructuralUnit } from '@/lib/types'
import type { HrContractType } from '@/lib/hr/types'

type Props = {
  units: HrStructuralUnit[]
  positions: HrPosition[]
  employees: Employee[]
  onUpsertUnit: (u: HrStructuralUnit) => void
  onRemoveUnit: (id: string) => void
  onUpsertPosition: (p: HrPosition) => void
  onRemovePosition: (id: string) => void
  onImportSeed: () => void
  onSaveEmployee: (e: Employee) => void
}

const CURRENCIES: HrPosition['currency'][] = ['GEL', 'USD', 'RUB']
const CONTRACT_TYPES: HrContractType[] = [
  'full_time',
  'part_time',
  'temporary',
  'internship',
]

type UnitForm = { name: string; sortOrder: number }
type PositionForm = {
  title: string
  structuralUnitId: string
  rank: string
  qualificationClass: string
  salary: number
  currency: HrPosition['currency']
  contractType: HrContractType
  schedule: string
}

const EMPTY_UNIT: UnitForm = { name: '', sortOrder: 0 }
const EMPTY_POSITION: PositionForm = {
  title: '',
  structuralUnitId: '',
  rank: '',
  qualificationClass: '',
  salary: 0,
  currency: 'GEL',
  contractType: 'full_time',
  schedule: '',
}

export function OrgStructureDirectoryPanel({
  units,
  positions,
  employees,
  onUpsertUnit,
  onRemoveUnit,
  onUpsertPosition,
  onRemovePosition,
  onImportSeed,
  onSaveEmployee,
}: Props) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const [unitFilter, setUnitFilter] = useState('')
  const [positionQ, setPositionQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [unitEditorOpen, setUnitEditorOpen] = useState(false)
  const [positionEditorOpen, setPositionEditorOpen] = useState(false)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null)
  const [unitForm, setUnitForm] = useState<UnitForm>(EMPTY_UNIT)
  const [positionForm, setPositionForm] = useState<PositionForm>(EMPTY_POSITION)
  const [staffAssignPosition, setStaffAssignPosition] = useState<HrPosition | null>(null)

  const activeUnits = useMemo(
    () =>
      [...units]
        .filter((u) => showArchived || !u.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
    [units, showArchived],
  )

  const staffAssignUnit = staffAssignPosition
    ? activeUnits.find(
        (u) =>
          u.id === staffAssignPosition.structuralUnitId ||
          u.name === staffAssignPosition.department,
      )
    : undefined

  const grouped = useMemo(() => {
    const q = positionQ.trim().toLowerCase()
    return activeUnits
      .filter((u) => !unitFilter || u.id === unitFilter)
      .map((unit) => {
        const rows = positions
          .filter((p) => p.structuralUnitId === unit.id || p.department === unit.name)
          .filter((p) => showArchived || !p.archived)
          .filter((p) => {
            if (!q) return true
            const hay = [p.title, p.rank, p.qualificationClass, p.grade]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
            return hay.includes(q)
          })
          .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
        return { unit, rows }
      })
      .filter((g) => g.rows.length > 0 || !unitFilter)
  }, [activeUnits, positions, unitFilter, positionQ, showArchived])

  function countForPosition(p: HrPosition): number {
    return employeesOnPosition(employees, p).length
  }

  function openStaffAssign(p: HrPosition) {
    setStaffAssignPosition(p)
  }

  function openAddUnit() {
    setEditingUnitId(null)
    setUnitForm({ name: '', sortOrder: activeUnits.length })
    setNotice(null)
    setUnitEditorOpen(true)
  }

  function openEditUnit(u: HrStructuralUnit) {
    setEditingUnitId(u.id)
    setUnitForm({ name: u.name, sortOrder: u.sortOrder })
    setNotice(null)
    setUnitEditorOpen(true)
  }

  function saveUnit() {
    const name = unitForm.name.trim()
    if (!name) {
      setNotice(t('orgStructure.err.unitName'))
      return
    }
    const id = editingUnitId ?? slugUnitId(name)
    onUpsertUnit({
      id,
      name,
      sortOrder: unitForm.sortOrder,
      archived: units.find((u) => u.id === id)?.archived,
    })
    setUnitEditorOpen(false)
  }

  function openAddPosition(unitId?: string) {
    setEditingPositionId(null)
    setPositionForm({
      ...EMPTY_POSITION,
      structuralUnitId: unitId ?? activeUnits[0]?.id ?? '',
    })
    setNotice(null)
    setPositionEditorOpen(true)
  }

  function openEditPosition(p: HrPosition) {
    setEditingPositionId(p.id)
    setPositionForm({
      title: p.title,
      structuralUnitId: p.structuralUnitId ?? activeUnits.find((u) => u.name === p.department)?.id ?? '',
      rank: p.rank ?? p.grade ?? '',
      qualificationClass: p.qualificationClass ?? '',
      salary: p.salary,
      currency: p.currency,
      contractType: p.contractType,
      schedule: p.schedule ?? '',
    })
    setNotice(null)
    setPositionEditorOpen(true)
  }

  function savePosition() {
    const title = positionForm.title.trim()
    const unit = activeUnits.find((u) => u.id === positionForm.structuralUnitId)
    if (!title) {
      setNotice(t('orgStructure.err.positionTitle'))
      return
    }
    if (!unit) {
      setNotice(t('orgStructure.err.unitRequired'))
      return
    }
    onUpsertPosition({
      id: editingPositionId ?? newId(),
      title,
      structuralUnitId: unit.id,
      department: unit.name,
      rank: positionForm.rank.trim() || undefined,
      qualificationClass: positionForm.qualificationClass.trim() || undefined,
      grade: positionForm.rank.trim() || undefined,
      salary: positionForm.salary,
      currency: positionForm.currency,
      contractType: positionForm.contractType,
      schedule: positionForm.schedule.trim() || undefined,
      archived: positions.find((p) => p.id === editingPositionId)?.archived,
    })
    setPositionEditorOpen(false)
  }

  async function removeUnit(u: HrStructuralUnit) {
    const linked = positions.filter((p) => p.structuralUnitId === u.id).length
    if (
      !(await confirm({
        message: tf('orgStructure.confirmRemoveUnit', { name: u.name, count: linked }),
      }))
    ) {
      return
    }
    onRemoveUnit(u.id)
  }

  async function removePosition(p: HrPosition) {
    const n = countForPosition(p)
    if (n > 0) {
      setNotice(tf('orgStructure.err.positionInUse', { n }))
      return
    }
    if (!(await confirm({ message: tf('orgStructure.confirmRemovePosition', { title: p.title }) }))) {
      return
    }
    onRemovePosition(p.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">{t('orgStructure.title')}</h2>
          <p className="mt-1 text-sm text-stone-600">{t('orgStructure.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={openAddUnit}>
            {t('orgStructure.addUnit')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => openAddPosition()}>
            {t('orgStructure.addPosition')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onImportSeed}>
            {t('orgStructure.importSeed')}
          </Button>
        </div>
      </div>

      {notice ? <FormNotice type="info" message={notice} /> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-grid bg-white p-3 shadow-sm">
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
        >
          <option value="">{t('orgStructure.allUnits')}</option>
          {activeUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <Input
          value={positionQ}
          onChange={(e) => setPositionQ(e.target.value)}
          placeholder={t('orgStructure.searchPosition')}
          className="min-w-[14rem] flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {t('orgStructure.showArchived')}
        </label>
      </div>

      <div className="space-y-4">
        {grouped.map(({ unit, rows }) => (
          <section
            key={unit.id}
            className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-grid bg-stone-50 px-4 py-3">
              <div>
                <h3 className="font-semibold text-ink">{unit.name}</h3>
                <p className="text-xs text-stone-500">
                  {tf('orgStructure.positionsCount', { n: rows.length })}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="xs" onClick={() => openAddPosition(unit.id)}>
                  {t('orgStructure.addPositionShort')}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => openEditUnit(unit)}>
                  {t('common.edit')}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void removeUnit(unit)}>
                  {t('common.delete')}
                </Button>
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white text-left text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2">{t('orgStructure.col.title')}</th>
                    <th className="px-3 py-2">{t('orgStructure.col.rank')}</th>
                    <th className="px-3 py-2">{t('orgStructure.col.class')}</th>
                    <th className="px-3 py-2">{t('orgStructure.col.staff')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-stone-500">
                        {t('orgStructure.emptyUnit')}
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => (
                      <tr key={p.id} className="border-t border-grid hover:bg-stone-50/80">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-left font-medium text-ink hover:text-accent hover:underline"
                            onClick={() => openStaffAssign(p)}
                            title={t('orgStructure.assignStaff')}
                          >
                            {p.title}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-stone-600">{p.rank ?? p.grade ?? '—'}</td>
                        <td className="px-3 py-2 text-stone-600">{p.qualificationClass ?? '—'}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="font-mono text-xs text-accent hover:underline"
                            onClick={() => openStaffAssign(p)}
                          >
                            {countForPosition(p)}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="xs" onClick={() => openStaffAssign(p)}>
                            {t('orgStructure.assignStaffShort')}
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => openEditPosition(p)}>
                            {t('common.edit')}
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => void removePosition(p)}>
                            {t('common.delete')}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {grouped.length === 0 ? (
          <p className="rounded-sm border border-dashed border-grid bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
            {t('orgStructure.empty')}
          </p>
        ) : null}
      </div>

      <AppDialog
        open={unitEditorOpen}
        title={editingUnitId ? t('orgStructure.editUnit') : t('orgStructure.addUnit')}
        onClose={() => setUnitEditorOpen(false)}
      >
        <div className="space-y-3">
          <FormField label={t('orgStructure.unitName')}>
            <Input
              value={unitForm.name}
              onChange={(e) => setUnitForm((f) => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <FormField label={t('orgStructure.sortOrder')}>
            <Input
              type="number"
              value={unitForm.sortOrder}
              onChange={(e) =>
                setUnitForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))
              }
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setUnitEditorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={saveUnit}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </AppDialog>

      <AppDialog
        open={positionEditorOpen}
        title={editingPositionId ? t('orgStructure.editPosition') : t('orgStructure.addPosition')}
        onClose={() => setPositionEditorOpen(false)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('orgStructure.col.title')} className="sm:col-span-2">
            <Input
              value={positionForm.title}
              onChange={(e) => setPositionForm((f) => ({ ...f, title: e.target.value }))}
            />
          </FormField>
          <FormField label={t('orgStructure.unitName')} className="sm:col-span-2">
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={positionForm.structuralUnitId}
              onChange={(e) =>
                setPositionForm((f) => ({ ...f, structuralUnitId: e.target.value }))
              }
            >
              <option value="">{t('orgStructure.chooseUnit')}</option>
              {activeUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('orgStructure.col.rank')}>
            <Input
              value={positionForm.rank}
              onChange={(e) => setPositionForm((f) => ({ ...f, rank: e.target.value }))}
            />
          </FormField>
          <FormField label={t('orgStructure.col.class')}>
            <Input
              value={positionForm.qualificationClass}
              onChange={(e) =>
                setPositionForm((f) => ({ ...f, qualificationClass: e.target.value }))
              }
            />
          </FormField>
          <FormField label={t('hr.settings.salary')}>
            <Input
              type="number"
              value={positionForm.salary}
              onChange={(e) =>
                setPositionForm((f) => ({ ...f, salary: parseFloat(e.target.value) || 0 }))
              }
            />
          </FormField>
          <FormField label={t('hr.settings.currency')}>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={positionForm.currency}
              onChange={(e) =>
                setPositionForm((f) => ({
                  ...f,
                  currency: e.target.value as HrPosition['currency'],
                }))
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('hr.settings.contractType')}>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={positionForm.contractType}
              onChange={(e) =>
                setPositionForm((f) => ({
                  ...f,
                  contractType: e.target.value as HrContractType,
                }))
              }
            >
              {CONTRACT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`hr.contract.${c}`)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('hr.settings.schedule')} className="sm:col-span-2">
            <Input
              value={positionForm.schedule}
              onChange={(e) => setPositionForm((f) => ({ ...f, schedule: e.target.value }))}
            />
          </FormField>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => setPositionEditorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={savePosition}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </AppDialog>

      <PositionStaffAssignDialog
        position={staffAssignPosition}
        unit={staffAssignUnit}
        units={units}
        employees={employees}
        onSaveEmployee={onSaveEmployee}
        onClose={() => setStaffAssignPosition(null)}
      />
    </div>
  )
}
