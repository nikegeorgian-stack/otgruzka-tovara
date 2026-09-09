import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/context/I18nContext'
import { roleLabel } from '@/lib/access/roles'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import {
  clearProductionCycleContext,
  deriveProductionCycle,
  loadProductionCycleContext,
  mergeProductionCycleContext,
  saveProductionCycleContext,
  type ProductionCycleContext,
  type ProductionCycleSnapshot,
  type ProductionCycleStageState,
} from '@/lib/productionCycle'
import type { AppStore, ViewId } from '@/lib/types'

const STATE_CLASS: Record<ProductionCycleStageState, string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  current: 'border-accent bg-accent-soft text-ink ring-1 ring-accent/40',
  blocked: 'border-amber-300 bg-amber-50 text-amber-950',
  waiting: 'border-stone-200 bg-stone-50 text-stone-500',
  cancelled: 'border-stone-300 bg-stone-100 text-stone-400 line-through',
}

type Props = {
  store: AppStore
  access?: AccessStore | null
  user?: AppUser | null
  adminCabinet?: AdminCabinetId | null
  /** Внешний якорь (например, открытый ЗК на Director). */
  seedContext?: ProductionCycleContext | null
  onNavigate?: (view: ViewId) => void
  compact?: boolean
  className?: string
}

function hasAnchor(ctx: ProductionCycleContext | null | undefined): boolean {
  if (!ctx) return false
  return Boolean(ctx.salesOrderId || ctx.productionOrderId || ctx.lotId || ctx.finishedProductId)
}

export function ProductionCyclePanel({
  store,
  access = null,
  user = null,
  adminCabinet = null,
  seedContext = null,
  onNavigate,
  compact = false,
  className = '',
}: Props) {
  const { t, tf, locale } = useI18n()
  const [picked, setPicked] = useState<ProductionCycleContext | null>(() => loadProductionCycleContext())
  const [expanded, setExpanded] = useState(!compact)

  const context = useMemo(
    () => mergeProductionCycleContext(picked, seedContext ?? {}),
    [picked, seedContext],
  )

  const activeContext = hasAnchor(context) ? context : null

  useEffect(() => {
    if (!activeContext) return
    saveProductionCycleContext(activeContext)
  }, [activeContext])

  const snapshot: ProductionCycleSnapshot | null = useMemo(() => {
    if (!activeContext) return null
    return deriveProductionCycle(store, activeContext, { access, user, adminCabinet })
  }, [store, activeContext, access, user, adminCabinet])

  const salesOptions = useMemo(() => {
    return (store.sales?.orders ?? [])
      .filter((o) => o.status !== 'cancelled')
      .slice()
      .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNumber.localeCompare(a.orderNumber))
      .slice(0, 40)
  }, [store.sales?.orders])

  const selectSalesOrder = (salesOrderId: string) => {
    if (!salesOrderId) {
      clearProductionCycleContext()
      setPicked(null)
      return
    }
    const next = { salesOrderId }
    saveProductionCycleContext(next)
    setPicked(next)
  }

  const clear = () => {
    clearProductionCycleContext()
    setPicked(null)
  }

  const missingText = (key?: string, params?: Record<string, string | number>) => {
    if (!key) return null
    try {
      return params ? tf(key, params) : t(key)
    } catch {
      return key
    }
  }

  return (
    <Card
      title={t('productionCycle.title')}
      description={t('productionCycle.hint')}
      className={className}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {compact && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('productionCycle.collapse') : t('productionCycle.expand')}
            </Button>
          )}
          {activeContext && (
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('productionCycle.clear')}
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-stone-600">
          <span>{t('productionCycle.pickOrder')}</span>
          <select
            className="h-9 rounded-sm border border-grid bg-white px-2 text-sm text-ink"
            value={activeContext?.salesOrderId ?? ''}
            onChange={(e) => selectSalesOrder(e.target.value)}
            data-testid="production-cycle-order-select"
          >
            <option value="">{t('productionCycle.pickOrderPlaceholder')}</option>
            {salesOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} · {o.customer}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!snapshot && (
        <p className="py-4 text-center text-sm text-stone-500">{t('productionCycle.empty')}</p>
      )}

      {snapshot && (
        <div className="space-y-3" data-testid="production-cycle-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-base font-semibold text-ink">{snapshot.subject.title}</div>
              {snapshot.subject.subtitle && (
                <div className="text-sm text-stone-600">{snapshot.subject.subtitle}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                {snapshot.subject.productionOrderNumber && (
                  <span>
                    {t('productionCycle.anchor.po')}: {snapshot.subject.productionOrderNumber}
                  </span>
                )}
                {snapshot.subject.lotBatchNo && (
                  <span>
                    {t('productionCycle.anchor.lot')}: {snapshot.subject.lotBatchNo}
                  </span>
                )}
              </div>
            </div>
            <span
              className={`rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                snapshot.outcome === 'completed'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : snapshot.outcome === 'cancelled'
                    ? 'border-stone-300 bg-stone-100 text-stone-600'
                    : 'border-sky-200 bg-sky-50 text-sky-900'
              }`}
            >
              {t(`productionCycle.outcome.${snapshot.outcome}`)}
            </span>
          </div>

          {snapshot.nextAction && snapshot.outcome === 'in_progress' && (
            <div
              className={`rounded-sm border px-3 py-2 text-sm ${
                snapshot.nextAction.blocked
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-accent/30 bg-accent-soft text-ink'
              }`}
              data-testid="production-cycle-next"
            >
              <div className="font-medium">{t(snapshot.nextAction.actionKey)}</div>
              <div className="mt-0.5 text-xs text-stone-700">
                {t('productionCycle.next.interface')}: {t(snapshot.nextAction.viewLabelKey)}
                {' · '}
                {t('productionCycle.next.role')}:{' '}
                {snapshot.nextAction.responsibleRoleIds
                  .map((r) => roleLabel(r, locale))
                  .join(', ')}
              </div>
              {snapshot.nextAction.missingConditionKey && (
                <div className="mt-1 text-xs font-medium text-amber-900">
                  {missingText(
                    snapshot.nextAction.missingConditionKey,
                    snapshot.nextAction.missingConditionParams,
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {onNavigate && (
                  <Button
                    size="sm"
                    disabled={!snapshot.nextAction.canNavigate}
                    onClick={() => onNavigate(snapshot.nextAction!.viewId)}
                    data-testid="production-cycle-go"
                  >
                    {t('productionCycle.go')}
                  </Button>
                )}
                {!snapshot.nextAction.canNavigate && (
                  <span className="text-xs text-stone-600">{t('productionCycle.noAccess')}</span>
                )}
              </div>
            </div>
          )}

          {expanded && (
            <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {snapshot.stages.map((stage, idx) => (
                <li
                  key={stage.id}
                  className={`rounded-sm border px-2.5 py-2 text-xs ${STATE_CLASS[stage.state]}`}
                  data-testid={`production-cycle-stage-${stage.id}`}
                  data-state={stage.state}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold">
                      {idx + 1}. {t(stage.meta.titleKey)}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-80">
                      {t(`productionCycle.state.${stage.state}`)}
                    </span>
                  </div>
                  {stage.evidence.refLabel && (
                    <div className="mt-0.5 font-mono text-[11px] opacity-90">{stage.evidence.refLabel}</div>
                  )}
                  {stage.state === 'blocked' && stage.evidence.missingConditionKey && (
                    <div className="mt-1 text-[11px] leading-snug">
                      {missingText(
                        stage.evidence.missingConditionKey,
                        stage.evidence.missingConditionParams,
                      )}
                    </div>
                  )}
                  {stage.state === 'current' && onNavigate && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-1.5"
                      disabled={!stage.canNavigate}
                      onClick={() => onNavigate(stage.meta.viewId)}
                    >
                      {t(stage.meta.viewLabelKey)}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  )
}
