import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { formatOrgShortLabel } from '@/lib/orgChart/display'
import { orgChartNodeForEmployee } from '@/lib/orgChart/hierarchy'
import { createDefaultOrgChartStore } from '@/lib/orgChart/init'
import type { OrgChartNode } from '@/lib/orgChart/types'
import type { AppStore } from '@/lib/types'

type Props = {
  open: boolean
  store: AppStore
  node: OrgChartNode
  mode: 'assign' | 'replace'
  onClose: () => void
  onConfirm: (employeeId: string) => void
}

export function OrgChartAssignDialog({ open, store, node, mode, onClose, onConfirm }: Props) {
  const { t, locale } = useI18n()
  const [q, setQ] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const org = store.orgChart ?? createDefaultOrgChartStore()

  useEffect(() => {
    if (!open) return
    setQ('')
    setEmployeeId('')
  }, [node.id, open])

  const employees = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return store.employees
      .filter((e) => e.active && e.hrStatus !== 'fired')
      .filter((e) => {
        if (!needle) return true
        return employeeName(e, locale).toLowerCase().includes(needle)
      })
      .slice(0, 80)
  }, [locale, q, store.employees])

  const conflict = employeeId
    ? orgChartNodeForEmployee(org, employeeId)
    : undefined
  const conflictOther = conflict && conflict.id !== node.id ? conflict : undefined

  const unitById = useMemo(
    () => new Map(store.hrStructuralUnits.map((u) => [u.id, u.name])),
    [store.hrStructuralUnits],
  )
  const posById = useMemo(
    () => new Map(store.hrPositions.map((p) => [p.id, p.title])),
    [store.hrPositions],
  )

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      ephemeral
      title={mode === 'replace' ? t('orgTree.replaceTitle') : t('orgTree.assignTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!employeeId}
            onClick={() => onConfirm(employeeId)}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {formatOrgShortLabel(node.nameShort)} — {node.nameFull}
        </p>
        {mode === 'replace' && node.employeeId ? (
          <p className="text-stone-600">
            {t('orgTree.assignCurrent')}:{' '}
            {employeeName(
              store.employees.find((e) => e.id === node.employeeId)!,
              locale,
            )}
          </p>
        ) : null}
        <input
          className="w-full rounded border border-stone-300 px-2 py-1.5"
          placeholder={t('orgTree.searchEmployee')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="w-full rounded border border-stone-300 px-2 py-1.5"
          size={10}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {employeeName(e, locale)}
              {e.positionId && posById.get(e.positionId)
                ? ` · ${posById.get(e.positionId)}`
                : e.position
                  ? ` · ${e.position}`
                  : ''}
              {e.structuralUnitId && unitById.get(e.structuralUnitId)
                ? ` · ${unitById.get(e.structuralUnitId)}`
                : ''}
            </option>
          ))}
        </select>
        {conflictOther ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            {t('orgTree.assignConflict')}: {formatOrgShortLabel(conflictOther.nameShort)} —{' '}
            {conflictOther.nameFull}
          </p>
        ) : null}
        <p className="text-xs text-stone-400">{t('orgTree.assignNoHrCard')}</p>
      </div>
    </AppDialog>
  )
}
