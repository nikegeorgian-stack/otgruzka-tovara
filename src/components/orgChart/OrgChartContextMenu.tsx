import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { formatOrgShortLabel } from '@/lib/orgChart/display'
import type { OrgChartTone } from '@/lib/orgChart/visual'

export type OrgChartMenuAction =
  | 'openDetails'
  | 'showOnChart'
  | 'focusBranch'
  | 'showAll'
  | 'collapseBranch'
  | 'expandBranch'
  | 'expandAllBranch'
  | 'copyName'
  | 'copyShort'
  | 'copyChain'
  | 'printBranch'
  | 'edit'
  | 'addChild'
  | 'addSibling'
  | 'reparent'
  | 'assign'
  | 'replace'
  | 'unassign'
  | 'hrLink'
  | 'autoLayoutBranch'
  | 'remove'
  | 'canvasShowAll'
  | 'canvasFit'
  | 'canvasExpandAll'
  | 'canvasClearFocus'
  | 'canvasPrintAll'
  | 'canvasAdd'
  | 'canvasAutoLayout'

type MenuItem = {
  id: OrgChartMenuAction
  labelKey: string
  danger?: boolean
  disabled?: boolean
  disabledHintKey?: string
  editOnly?: boolean
}

type Props = {
  x: number
  y: number
  mode: 'node' | 'canvas'
  canEdit: boolean
  header?: {
    nameShort: string
    nameFull: string
    employeeLabel: string | null
    tone: OrgChartTone
  }
  collapsed?: boolean
  hasParent?: boolean
  hasChildren?: boolean
  hasEmployee?: boolean
  onAction: (action: OrgChartMenuAction) => void
  onClose: () => void
}

function clampPos(x: number, y: number, w: number, h: number) {
  const pad = 8
  const maxX = window.innerWidth - w - pad
  const maxY = window.innerHeight - h - pad
  return {
    left: Math.max(pad, Math.min(x, maxX)),
    top: Math.max(pad, Math.min(y, maxY)),
  }
}

export function OrgChartContextMenu({
  x,
  y,
  mode,
  canEdit,
  header,
  collapsed,
  hasParent,
  hasChildren,
  hasEmployee,
  onAction,
  onClose,
}: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const z = usePopoverZIndex()
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(clampPos(x, y, el.offsetWidth, el.offsetHeight))
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const viewItems: MenuItem[] =
    mode === 'canvas'
      ? [
          { id: 'canvasShowAll', labelKey: 'orgTree.menu.showAll' },
          { id: 'canvasFit', labelKey: 'orgTree.menu.fit' },
          { id: 'canvasExpandAll', labelKey: 'orgTree.menu.expandAll' },
          { id: 'canvasClearFocus', labelKey: 'orgTree.menu.clearFocus' },
          { id: 'canvasPrintAll', labelKey: 'orgTree.menu.printAll' },
        ]
      : [
          { id: 'openDetails', labelKey: 'orgTree.menu.openDetails' },
          { id: 'showOnChart', labelKey: 'orgTree.menu.showOnChart' },
          { id: 'focusBranch', labelKey: 'orgTree.menu.focusBranch' },
          { id: 'showAll', labelKey: 'orgTree.menu.showAll' },
          {
            id: collapsed ? 'expandBranch' : 'collapseBranch',
            labelKey: collapsed ? 'orgTree.menu.expandBranch' : 'orgTree.menu.collapseBranch',
            disabled: !hasChildren,
            disabledHintKey: 'orgTree.menu.noChildren',
          },
          {
            id: 'expandAllBranch',
            labelKey: 'orgTree.menu.expandAllBranch',
            disabled: !hasChildren,
          },
          { id: 'copyName', labelKey: 'orgTree.menu.copyName' },
          { id: 'copyShort', labelKey: 'orgTree.menu.copyShort' },
          { id: 'copyChain', labelKey: 'orgTree.menu.copyChain' },
          { id: 'printBranch', labelKey: 'orgTree.menu.printBranch' },
        ]

  const editItems: MenuItem[] =
    mode === 'canvas'
      ? [
          { id: 'canvasAdd', labelKey: 'orgTree.menu.addNode', editOnly: true },
          { id: 'canvasAutoLayout', labelKey: 'orgTree.menu.autoLayout', editOnly: true },
        ]
      : [
          { id: 'edit', labelKey: 'orgTree.menu.edit', editOnly: true },
          { id: 'addChild', labelKey: 'orgTree.menu.addChild', editOnly: true },
          {
            id: 'addSibling',
            labelKey: 'orgTree.menu.addSibling',
            editOnly: true,
            disabled: !hasParent,
            disabledHintKey: 'orgTree.menu.noSiblingForRoot',
          },
          { id: 'reparent', labelKey: 'orgTree.menu.reparent', editOnly: true },
          {
            id: hasEmployee ? 'replace' : 'assign',
            labelKey: hasEmployee ? 'orgTree.menu.replaceEmployee' : 'orgTree.menu.assignEmployee',
            editOnly: true,
          },
          {
            id: 'unassign',
            labelKey: 'orgTree.menu.unassign',
            editOnly: true,
            disabled: !hasEmployee,
          },
          { id: 'hrLink', labelKey: 'orgTree.menu.hrLink', editOnly: true },
          { id: 'autoLayoutBranch', labelKey: 'orgTree.menu.autoLayoutBranch', editOnly: true },
          { id: 'remove', labelKey: 'orgTree.menu.remove', editOnly: true, danger: true },
        ]

  const visibleEdit = canEdit ? editItems : []

  const run = (item: MenuItem) => {
    if (item.disabled) return
    onAction(item.id)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed max-h-[min(70vh,28rem)] w-64 overflow-y-auto rounded-md border border-stone-200 bg-white py-1 text-sm shadow-lg"
      style={{ left: pos.left, top: pos.top, zIndex: z }}
    >
      {header ? (
        <div className="border-b border-stone-100 px-3 py-2">
          <div className="flex items-stretch gap-2">
            <div className="w-1 shrink-0 rounded" style={{ background: header.tone.accent }} />
            <div className="min-w-0">
              <div className="font-mono font-bold" style={{ color: header.tone.accent }}>
                {formatOrgShortLabel(header.nameShort)}
              </div>
              <div className="truncate text-stone-800">{header.nameFull}</div>
              <div className="truncate text-xs text-stone-500">
                {header.employeeLabel ?? t('orgTree.vacant')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {viewItems.map((item) => (
        <MenuRow key={item.id} item={item} t={t} onRun={run} />
      ))}

      {visibleEdit.length ? <div className="my-1 border-t border-stone-100" /> : null}
      {visibleEdit.map((item) => (
        <MenuRow key={item.id} item={item} t={t} onRun={run} />
      ))}
    </div>,
    getModalPortalRoot(),
  )
}

function MenuRow({
  item,
  t,
  onRun,
}: {
  item: MenuItem
  t: (k: string) => string
  onRun: (item: MenuItem) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.disabled && item.disabledHintKey ? t(item.disabledHintKey) : undefined}
      className={`block w-full px-3 py-1.5 text-left ${
        item.disabled
          ? 'cursor-not-allowed text-stone-300'
          : item.danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-stone-800 hover:bg-stone-50'
      }`}
      onClick={() => onRun(item)}
    >
      {t(item.labelKey)}
    </button>
  )
}
