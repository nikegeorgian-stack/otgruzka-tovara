import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { hrStatusLabel } from '@/lib/hr/labels'
import { formatOrgShortLabel } from '@/lib/orgChart/display'
import { orgChartDirectReports, orgChartReportsToChain } from '@/lib/orgChart/hierarchy'
import type { OrgChartHrLinkStatus } from '@/lib/orgChart/ops'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'
import { orgChartToneForNode } from '@/lib/orgChart/visual'
import type { Employee } from '@/lib/types'

type Props = {
  node: OrgChartNode | null
  nodes: OrgChartNode[]
  employees: Employee[]
  unitNameById: Map<string, string>
  positionTitleById: Map<string, string>
  displayMode: OrgChartDisplayMode
  canEdit: boolean
  hrLinkStatus: OrgChartHrLinkStatus | null
  onSelectNode: (id: string) => void
  onCopyName: () => void
  onCopyShort: () => void
  onCopyChain: () => void
  onShowOnChart: () => void
  onPrintBranch: () => void
  onOpenEdit: () => void
  onAddChild: () => void
  onAssign: () => void
  onUnassign: () => void
  onReparent: () => void
  onAutoLayoutBranch: () => void
  onRemove: () => void
}

const HR_STATUS_TONE: Record<OrgChartHrLinkStatus, string> = {
  linked: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  broken: 'border-red-200 bg-red-50 text-red-700',
  none: 'border-stone-200 bg-stone-50 text-stone-600',
}

export function OrgChartSidePanel({
  node,
  nodes,
  employees,
  unitNameById,
  positionTitleById,
  displayMode,
  canEdit,
  hrLinkStatus,
  onSelectNode,
  onCopyName,
  onCopyShort,
  onCopyChain,
  onShowOnChart,
  onPrintBranch,
  onOpenEdit,
  onAddChild,
  onAssign,
  onUnassign,
  onReparent,
  onAutoLayoutBranch,
  onRemove,
}: Props) {
  const { t, locale } = useI18n()

  if (!node) {
    return (
      <aside className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <p className="text-sm font-semibold text-stone-800">{t('orgTree.sidePanelTitle')}</p>
        <p className="mt-2 text-stone-500">{t('orgTree.selectNode')}</p>
      </aside>
    )
  }

  const tone = orgChartToneForNode(nodes, node.id)
  const employee = node.employeeId ? employees.find((item) => item.id === node.employeeId) ?? null : null
  const chain = orgChartReportsToChain(nodes, node.id).slice().reverse()
  const directReports = orgChartDirectReports(nodes, node.id)
  const vacant = !node.employeeId
  const hrStatus = hrLinkStatus ?? 'none'

  return (
    <aside className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-10 w-2 shrink-0 rounded-full" style={{ background: tone.accent }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('orgTree.sidePanelTitle')}
            </p>
            <p className="mt-1 font-mono text-sm font-bold" style={{ color: tone.accent }}>
              {formatOrgShortLabel(node.nameShort)}
            </p>
            <h3 className="mt-1 text-base font-semibold text-stone-900">{node.nameFull}</h3>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-stone-200 bg-white px-2 py-1 text-stone-700">
            {t('orgTree.field.tone')}: <span className="font-medium">{formatOrgShortLabel(node.nameShort)}</span>
          </span>
          <span
            className={`rounded-full border px-2 py-1 font-medium ${HR_STATUS_TONE[hrStatus]}`}
            title={t(`orgTree.hrStatus.${hrStatus}.hint`)}
          >
            {t(`orgTree.hrStatus.${hrStatus}.label`)}
          </span>
          <span
            className={`rounded-full border px-2 py-1 font-medium ${
              vacant
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {vacant ? t('orgTree.vacant') : t('orgTree.list.occupied')}
          </span>
        </div>

        <dl className="mt-3 space-y-2 text-xs text-stone-600">
          <div>
            <dt className="font-medium text-stone-700">{t('orgTree.field.nameShort')}</dt>
            <dd className="mt-0.5 font-mono">{formatOrgShortLabel(node.nameShort)}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-700">{t('orgTree.field.nameFull')}</dt>
            <dd className="mt-0.5">{node.nameFull}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-700">{t('orgTree.field.structuralUnit')}</dt>
            <dd className="mt-0.5">
              {node.structuralUnitId ? unitNameById.get(node.structuralUnitId) ?? node.structuralUnitId : '—'}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-700">{t('orgTree.field.position')}</dt>
            <dd className="mt-0.5">
              {node.positionId ? positionTitleById.get(node.positionId) ?? node.positionId : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-stone-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('orgTree.sidePanel.employee')}
        </p>
        {employee ? (
          <div className="mt-2 space-y-1">
            <p className="font-medium text-stone-900">{employeeName(employee, locale)}</p>
            <p className="text-xs text-stone-500">{hrStatusLabel(employee.hrStatus ?? 'active', locale)}</p>
            {employee.position ? <p className="text-xs text-stone-500">{employee.position}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-stone-500">{t('orgTree.vacant')}</p>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('orgTree.sidePanel.reports')}
        </p>
        <div className="mt-2">
          <p className="text-xs font-medium text-stone-700">{t('orgTree.chain')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {chain.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-full border px-2 py-1 text-left text-xs transition ${
                  item.id === node.id
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50'
                }`}
                onClick={() => onSelectNode(item.id)}
                title={item.nameFull}
              >
                {displayMode === 'full' ? item.nameFull : formatOrgShortLabel(item.nameShort)}
                {index < chain.length - 1 ? ' ->' : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <p className="text-xs font-medium text-stone-700">{t('orgTree.directReports')}</p>
          {directReports.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {directReports.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="rounded-full border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
                  onClick={() => onSelectNode(item.id)}
                  title={item.nameFull}
                >
                  {displayMode === 'full' ? item.nameFull : formatOrgShortLabel(item.nameShort)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-stone-500">{t('orgTree.sidePanel.noDirectReports')}</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('orgTree.sidePanel.quickActions')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onShowOnChart}>
            {t('orgTree.menu.showOnChart')}
          </Button>
          <Button size="sm" variant="secondary" onClick={onPrintBranch}>
            {t('orgTree.menu.printBranch')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopyName}>
            {t('orgTree.menu.copyName')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopyShort}>
            {t('orgTree.menu.copyShort')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopyChain}>
            {t('orgTree.menu.copyChain')}
          </Button>
        </div>

        {canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={onOpenEdit}>
              {t('orgTree.menu.edit')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onAddChild}>
              {t('orgTree.menu.addChild')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onAssign}>
              {node.employeeId ? t('orgTree.menu.replaceEmployee') : t('orgTree.menu.assignEmployee')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onUnassign} disabled={!node.employeeId}>
              {t('orgTree.menu.unassign')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReparent}>
              {t('orgTree.menu.reparent')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onAutoLayoutBranch}>
              {t('orgTree.menu.autoLayoutBranch')}
            </Button>
            <Button size="sm" variant="danger" onClick={onRemove}>
              {t('orgTree.menu.remove')}
            </Button>
          </div>
        ) : null}
      </section>
    </aside>
  )
}
