import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { formatOrgShortLabel } from '@/lib/orgChart/display'
import type { OrgChartNode, OrgChartNodeDraft } from '@/lib/orgChart/types'
import type { AppStore } from '@/lib/types'

type Props = {
  open: boolean
  store: AppStore
  node: OrgChartNode | null
  parentOptions: OrgChartNode[]
  defaultParentId?: string
  onClose: () => void
  onSave: (draft: OrgChartNodeDraft) => void
  onArchive?: () => void
}

export function OrgChartNodeDialog({
  open,
  store,
  node,
  parentOptions,
  defaultParentId,
  onClose,
  onSave,
  onArchive,
}: Props) {
  const { t, locale } = useI18n()
  const [nameFull, setNameFull] = useState('')
  const [nameShort, setNameShort] = useState('')
  const [parentId, setParentId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [structuralUnitId, setStructuralUnitId] = useState('')
  const [positionId, setPositionId] = useState('')

  useEffect(() => {
    if (!open) return
    setNameFull(node?.nameFull ?? '')
    setNameShort(node?.nameShort ?? '')
    setParentId(node?.parentId ?? defaultParentId ?? '')
    setEmployeeId(node?.employeeId ?? '')
    setStructuralUnitId(node?.structuralUnitId ?? '')
    setPositionId(node?.positionId ?? '')
  }, [defaultParentId, node, open])

  const employees = store.employees.filter((e) => e.active && e.hrStatus !== 'fired')
  const units = store.hrStructuralUnits
    .filter((item) => !item.archived)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
  const positions = store.hrPositions
    .filter((item) => !item.archived)
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const selectedPosition = positions.find((item) => item.id === positionId)

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={node ? t('orgTree.editNode') : t('orgTree.addNode')}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {node && onArchive ? (
            <Button type="button" variant="ghost" onClick={onArchive}>
              {t('orgTree.archiveNode')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSave({
                id: node?.id,
                parentId: parentId || undefined,
                nameFull,
                nameShort,
                employeeId: employeeId || undefined,
                structuralUnitId: structuralUnitId || undefined,
                positionId: positionId || undefined,
                layoutX: node?.layoutX,
                layoutY: node?.layoutY,
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.nameFull')}</span>
          <div className="flex gap-2">
            <input
              className="w-full rounded border border-stone-300 px-2 py-1.5"
              value={nameFull}
              onChange={(e) => setNameFull(e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!selectedPosition}
              onClick={() => {
                if (!selectedPosition) return
                if (window.confirm(t('orgTree.field.fillFromPositionConfirm'))) {
                  setNameFull(selectedPosition.title)
                }
              }}
            >
              {t('orgTree.field.fillFromPosition')}
            </Button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.nameShort')}</span>
          <input
            className="w-full rounded border border-stone-300 px-2 py-1.5 font-mono"
            value={nameShort}
            onChange={(e) => setNameShort(e.target.value)}
            placeholder="ГД"
          />
          <span className="mt-0.5 block text-xs text-stone-500">{t('orgTree.field.shortHint')}</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.parent')}</span>
          <select
            className="w-full rounded border border-stone-300 px-2 py-1.5"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">{t('orgTree.noParent')}</option>
            {parentOptions
              .filter((p) => p.id !== node?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {formatOrgShortLabel(p.nameShort)} — {p.nameFull}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.employee')}</span>
          <select
            className="w-full rounded border border-stone-300 px-2 py-1.5"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">{t('orgTree.noEmployee')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeName(e, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.structuralUnit')}</span>
          <select
            className="w-full rounded border border-stone-300 px-2 py-1.5"
            value={structuralUnitId}
            onChange={(e) => setStructuralUnitId(e.target.value)}
          >
            <option value="">{t('orgTree.field.none')}</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-600">{t('orgTree.field.position')}</span>
          <select
            className="w-full rounded border border-stone-300 px-2 py-1.5"
            value={positionId}
            onChange={(e) => {
              const next = e.target.value
              setPositionId(next)
              const picked = positions.find((item) => item.id === next)
              if (picked?.structuralUnitId && !structuralUnitId) {
                setStructuralUnitId(picked.structuralUnitId)
              }
            }}
          >
            <option value="">{t('orgTree.field.none')}</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </AppDialog>
  )
}
