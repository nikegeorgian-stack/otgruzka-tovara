import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { formatOrgShortLabel } from '@/lib/orgChart/display'
import { orgChartChildren } from '@/lib/orgChart/hierarchy'
import { orgChartCountDescendants, orgChartDescendants, orgChartIsRoot } from '@/lib/orgChart/subtree'
import type { OrgChartNode } from '@/lib/orgChart/types'
import type { OrgChartRemoveMode } from '@/lib/orgChart/validate'
import { useEffect, useState } from 'react'

type Props = {
  open: boolean
  node: OrgChartNode
  nodes: OrgChartNode[]
  onClose: () => void
  onConfirm: (mode: OrgChartRemoveMode) => void
}

export function OrgChartDeleteDialog({ open, node, nodes, onClose, onConfirm }: Props) {
  const { t } = useI18n()
  const kids = orgChartChildren(nodes, node.id)
  const descCount = orgChartCountDescendants(nodes, node.id)
  const isRoot = orgChartIsRoot(nodes, node.id)
  const [mode, setMode] = useState<OrgChartRemoveMode>(kids.length ? 'node' : 'node')
  const [subtreeAck, setSubtreeAck] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('node')
    setSubtreeAck(false)
  }, [node.id, open])

  const nodeModeBlocked = isRoot && kids.length > 0
  const previewKids = kids.slice(0, 6)
  const previewSubtree = orgChartDescendants(nodes, node.id).slice(0, 8)

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      ephemeral
      title={t('orgTree.deleteTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={
              (mode === 'node' && nodeModeBlocked) || (mode === 'subtree' && kids.length > 0 && !subtreeAck)
            }
            onClick={() => onConfirm(mode)}
          >
            {t('orgTree.deleteConfirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          <span className="font-mono font-semibold">{formatOrgShortLabel(node.nameShort)}</span>
          {' — '}
          {node.nameFull}
        </p>

        {!kids.length ? (
          <p className="text-stone-600">{t('orgTree.deleteLeafHint')}</p>
        ) : (
          <>
            <label className={`flex gap-2 rounded border p-2 ${nodeModeBlocked ? 'opacity-50' : ''}`}>
              <input
                type="radio"
                name="del-mode"
                checked={mode === 'node'}
                disabled={nodeModeBlocked}
                onChange={() => setMode('node')}
              />
              <span>
                <span className="font-medium">{t('orgTree.deleteReparent')}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {t('orgTree.deleteReparentHint')}
                </span>
                {mode === 'node' && !nodeModeBlocked ? (
                  <ul className="mt-1 list-inside list-disc text-xs text-stone-600">
                    {previewKids.map((k) => (
                      <li key={k.id}>
                        {formatOrgShortLabel(k.nameShort)} → {node.parentId ?? '—'}
                      </li>
                    ))}
                    {kids.length > previewKids.length ? (
                      <li>… +{kids.length - previewKids.length}</li>
                    ) : null}
                  </ul>
                ) : null}
                {nodeModeBlocked ? (
                  <span className="mt-1 block text-xs text-amber-700">{t('orgTree.deleteRootBlock')}</span>
                ) : null}
              </span>
            </label>

            <label className="flex gap-2 rounded border border-red-200 bg-red-50/50 p-2">
              <input
                type="radio"
                name="del-mode"
                checked={mode === 'subtree'}
                onChange={() => setMode('subtree')}
              />
              <span>
                <span className="font-medium text-red-700">{t('orgTree.deleteSubtree')}</span>
                <span className="mt-0.5 block text-xs text-stone-600">
                  {t('orgTree.deleteSubtreeHint').replace('{n}', String(descCount + 1))}
                </span>
                {mode === 'subtree' ? (
                  <>
                    <ul className="mt-1 list-inside list-disc text-xs text-stone-600">
                      <li>
                        {formatOrgShortLabel(node.nameShort)} — {node.nameFull}
                      </li>
                      {previewSubtree.map((k) => (
                        <li key={k.id}>
                          {formatOrgShortLabel(k.nameShort)} — {k.nameFull}
                        </li>
                      ))}
                      {descCount > previewSubtree.length ? (
                        <li>… +{descCount - previewSubtree.length}</li>
                      ) : null}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 text-xs text-red-800">
                      <input
                        type="checkbox"
                        checked={subtreeAck}
                        onChange={(e) => setSubtreeAck(e.target.checked)}
                      />
                      {t('orgTree.deleteSubtreeAck')}
                    </label>
                  </>
                ) : null}
              </span>
            </label>
          </>
        )}
      </div>
    </AppDialog>
  )
}
