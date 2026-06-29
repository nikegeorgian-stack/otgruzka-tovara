import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { newId } from '@/lib/hr/files'
import type { Employee } from '@/lib/types'
import type { HrContractType, HrPosition } from '@/lib/hr/types'

type Props = {
  positions: HrPosition[]
  employees: Employee[]
  onUpsertPosition: (p: HrPosition) => void
  onRemovePosition: (id: string) => void
}

const CURRENCIES: HrPosition['currency'][] = ['GEL', 'USD', 'RUB']
const CONTRACT_TYPES: HrContractType[] = [
  'full_time',
  'part_time',
  'temporary',
  'internship',
]

type FormState = {
  title: string
  department: string
  grade: string
  salary: number
  currency: HrPosition['currency']
  contractType: HrContractType
  probationMonths: number
  schedule: string
  duties: string
}

const EMPTY_FORM: FormState = {
  title: '',
  department: '',
  grade: '',
  salary: 0,
  currency: 'GEL',
  contractType: 'full_time',
  probationMonths: 0,
  schedule: '',
  duties: '',
}

export function PositionsDirectoryPanel({
  positions,
  employees,
  onUpsertPosition,
  onRemovePosition,
}: Props) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const p of positions) {
      if (p.department.trim()) set.add(p.department.trim())
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [positions])

  const staffCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of employees) {
      const key = (e.position ?? '').trim().toLowerCase()
      if (!key) continue
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [employees])

  const visiblePositions = useMemo(() => {
    const list = showArchived ? positions : positions.filter((p) => !p.archived)
    return [...list].sort(
      (a, b) =>
        a.department.localeCompare(b.department) || a.title.localeCompare(b.title),
    )
  }, [positions, showArchived])

  const archivedCount = positions.filter((p) => p.archived).length

  function countFor(p: HrPosition): number {
    return staffCount.get(p.title.trim().toLowerCase()) ?? 0
  }

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setNotice(null)
    setEditorOpen(true)
  }

  function openEdit(p: HrPosition) {
    setEditingId(p.id)
    setForm({
      title: p.title,
      department: p.department,
      grade: p.grade ?? '',
      salary: p.salary,
      currency: p.currency,
      contractType: p.contractType,
      probationMonths: p.probationMonths ?? 0,
      schedule: p.schedule ?? '',
      duties: p.duties ?? '',
    })
    setNotice(null)
    setEditorOpen(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const title = form.title.trim()
    if (!title) {
      setNotice(t('directories.err.positionTitle'))
      return
    }
    const department = form.department.trim() || t('hr.settings.defaultDept')
    const isDuplicate = positions.some(
      (p) =>
        p.id !== editingId &&
        p.title.trim().toLowerCase() === title.toLowerCase() &&
        p.department.trim().toLowerCase() === department.toLowerCase(),
    )
    if (isDuplicate) {
      setNotice(t('directories.err.positionDuplicate'))
      return
    }
    const existing = editingId ? positions.find((p) => p.id === editingId) : null
    onUpsertPosition({
      id: editingId ?? newId(),
      title,
      department,
      grade: form.grade.trim() || undefined,
      salary: Number(form.salary) || 0,
      currency: form.currency,
      contractType: form.contractType,
      probationMonths: form.probationMonths > 0 ? form.probationMonths : undefined,
      schedule: form.schedule.trim() || undefined,
      duties: form.duties.trim() || undefined,
      archived: existing?.archived,
    })
    setEditorOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
    setNotice(null)
  }

  function toggleArchive(p: HrPosition) {
    onUpsertPosition({ ...p, archived: !p.archived })
  }

  async function remove(p: HrPosition) {
    if (countFor(p) > 0) return
    if (!(await confirm({ message: tf('directories.confirmDeletePosition', { title: p.title }), danger: true }))) {
      return
    }
    onRemovePosition(p.id)
  }

  return (
    <div className="space-y-4">
      {notice && !editorOpen && (
        <FormNotice type="error" message={notice} onDismiss={() => setNotice(null)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">{t('directories.positionsHint')}</p>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {tf('directories.showArchived', { count: archivedCount })}
            </label>
          )}
          <Button variant="success" onClick={openAdd}>
            {t('hr.addPosition')}
          </Button>
        </div>
      </div>
      <div className="fc-table-wrap">
        <table className="fc-table w-full">
          <thead>
            <tr>
              <th>{t('hr.position')}</th>
              <th>{t('hr.col.dept')}</th>
              <th>{t('directories.col.grade')}</th>
              <th>{t('directories.col.contract')}</th>
              <th className="text-right">{t('directories.col.salary')}</th>
              <th className="text-right">{t('directories.col.staff')}</th>
              <th className="text-right">{t('directories.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visiblePositions.map((p) => {
              const used = countFor(p)
              return (
                <tr key={p.id} className={p.archived ? 'opacity-50' : undefined}>
                  <td className="font-medium">
                    {p.title}
                    {p.archived && (
                      <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-500">
                        {t('directories.archivedBadge')}
                      </span>
                    )}
                  </td>
                  <td className="text-stone-600">{p.department}</td>
                  <td className="text-stone-600">{p.grade ?? '—'}</td>
                  <td className="text-stone-600">
                    {t(`hr.contract.${p.contractType}`)}
                  </td>
                  <td className="text-right font-mono text-xs">
                    {p.salary > 0 ? `${p.salary} ${p.currency}` : '—'}
                  </td>
                  <td className="text-right font-mono text-xs">{used || '—'}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="xs" onClick={() => openEdit(p)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => toggleArchive(p)}>
                        {p.archived
                          ? t('directories.unarchive')
                          : t('directories.archive')}
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        disabled={used > 0}
                        title={used > 0 ? t('directories.deleteBlockedByStaff') : undefined}
                        onClick={() => remove(p)}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {visiblePositions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  {t('hr.settings.emptyPositions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AppDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? t('directories.editPosition') : t('hr.addPosition')}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" type="submit" form="position-edit-form">
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <form id="position-edit-form" onSubmit={submit} className="grid gap-3 px-5 py-4">
          {notice && (
            <FormNotice type="error" message={notice} onDismiss={() => setNotice(null)} />
          )}
          <FormField label={t('hr.position')}>
            <Input
              required
              autoFocus
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            />
          </FormField>
          <FormField label={t('hr.col.dept')} hint={t('directories.deptHint')}>
            <Input
              list="position-departments"
              value={form.department}
              onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
            />
            <datalist id="position-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('directories.col.salary')}>
              <Input
                type="number"
                min={0}
                value={form.salary || ''}
                onChange={(e) =>
                  setForm((p) => ({ ...p, salary: Math.max(0, Number(e.target.value)) }))
                }
              />
            </FormField>
            <FormField label={t('directories.field.currency')}>
              <select
                className="fc-input"
                value={form.currency}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('directories.field.contractType')}>
              <select
                className="fc-input"
                value={form.contractType}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
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
            <FormField label={t('directories.field.probation')}>
              <Input
                type="number"
                min={0}
                max={12}
                value={form.probationMonths || ''}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    probationMonths: Math.max(0, Number(e.target.value)),
                  }))
                }
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('directories.col.grade')}>
              <Input
                value={form.grade}
                onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))}
              />
            </FormField>
            <FormField label={t('directories.field.schedule')}>
              <Input
                placeholder={t('directories.field.schedulePh')}
                value={form.schedule}
                onChange={(e) => setForm((p) => ({ ...p, schedule: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label={t('directories.field.duties')}>
            <Input
              as="textarea"
              rows={3}
              value={form.duties}
              onChange={(e) => setForm((p) => ({ ...p, duties: e.target.value }))}
            />
          </FormField>
        </form>
      </AppDialog>
    </div>
  )
}
