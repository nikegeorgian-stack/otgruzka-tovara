import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { formatOrgShortLabel, orgNodeDisplayLabel } from '@/lib/orgChart/display'
import { orgChartParent, orgChartReportsToChain } from '@/lib/orgChart/hierarchy'
import { orgChartDescendantIds } from '@/lib/orgChart/subtree'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'
import { validateOrgChartReparent } from '@/lib/orgChart/validate'

type Props = {
  open: boolean
  node: OrgChartNode
  nodes: OrgChartNode[]
  displayMode: OrgChartDisplayMode
  onClose: () => void
  onConfirm: (parentId: string | undefined) => void
}

export function OrgChartReparentDialog({
  open,
  node,
  nodes,
  displayMode,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [parentId, setParentId] = useState(node.parentId ?? '')
  const blocked = orgChartDescendantIds(nodes, node.id)
  blocked.add(node.id)

  useEffect(() => {
    if (!open) return
    setQ('')
    setParentId(node.parentId ?? '')
  }, [node.id, node.parentId, open])

  const current = orgChartParent(nodes, node.id)

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return nodes
      .filter((n) => !blocked.has(n.id))
      .filter((n) => {
        if (!needle) return true
        return (
          n.nameFull.toLowerCase().includes(needle) ||
          n.nameShort.toLowerCase().includes(needle)
        )
      })
  }, [blocked, nodes, q])

  const previewParent = parentId ? nodes.find((n) => n.id === parentId) : undefined
  const check = validateOrgChartReparent(nodes, node.id, parentId || undefined)
  const previewChain = previewParent
    ? [
        ...orgChartReportsToChain(nodes, previewParent.id).slice().reverse(),
        node,
      ]
        .map((n) => orgNodeDisplayLabel(n.nameFull, n.nameShort, displayMode))
        .join(' → ')
    : orgNodeDisplayLabel(node.nameFull, node.nameShort, displayMode)

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      ephemeral
      title={t('orgTree.reparentTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!check.ok || !parentId}
            onClick={() => onConfirm(parentId || undefined)}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-stone-600">
          {t('orgTree.reparentCurrent')}:{' '}
          {current
            ? `${formatOrgShortLabel(current.nameShort)} — ${current.nameFull}`
            : t('orgTree.noParent')}
        </p>
        <input
          className="w-full rounded border border-stone-300 px-2 py-1.5"
          placeholder={t('orgTree.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="w-full rounded border border-stone-300 px-2 py-1.5"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          size={8}
        >
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {formatOrgShortLabel(n.nameShort)} — {n.nameFull}
            </option>
          ))}
        </select>
        <p className="text-xs text-stone-500">
          {t('orgTree.reparentPreview')}: {previewChain}
        </p>
        {!check.ok ? (
          <p className="text-xs text-red-600">{t(`orgTree.validate.${check.issue}`)}</p>
        ) : null}
      </div>
    </AppDialog>
  )
}
