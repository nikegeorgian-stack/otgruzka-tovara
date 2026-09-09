import type { AccessRoleId } from '@/lib/access/types'
import type { ViewId } from '@/lib/types'

/** Этапы производственного цикла (канонический порядок UI). */
export const PRODUCTION_CYCLE_STAGE_IDS = [
  'recipe',
  'procurement',
  'receipt',
  'production_order',
  'material_issue',
  'mixer',
  'impregnation',
  'line',
  'packaging',
  'otc',
  'sales',
  'loading',
  'shipment',
] as const

export type ProductionCycleStageId = (typeof PRODUCTION_CYCLE_STAGE_IDS)[number]

/** Визуальное состояние этапа на панели. */
export type ProductionCycleStageState = 'done' | 'current' | 'blocked' | 'waiting' | 'cancelled'

export type ProductionCycleOutcome = 'in_progress' | 'completed' | 'cancelled'

/** Якорь цикла — сохраняется при смене роли / раздела. */
export type ProductionCycleContext = {
  salesOrderId?: string
  productionOrderId?: string
  lotId?: string
  finishedProductId?: string
}

export type ProductionCycleStageMeta = {
  id: ProductionCycleStageId
  /** i18n key: productionCycle.stage.<id> */
  titleKey: string
  viewId: ViewId
  /** i18n key: productionCycle.view.<viewId> — название интерфейса */
  viewLabelKey: string
  /** Роли, обычно отвечающие за шаг (для подсказки, не ACL). */
  responsibleRoleIds: AccessRoleId[]
  /** i18n key следующего действия */
  actionKey: string
}

export type ProductionCycleEvidence = {
  done: boolean
  /** Понятная ссылка на документ/сущность (номер, не UUID). */
  refLabel?: string
  /** Почему шаг ещё не выполнен / заблокирован. */
  missingConditionKey?: string
  missingConditionParams?: Record<string, string | number>
}

export type ProductionCycleStageView = {
  id: ProductionCycleStageId
  state: ProductionCycleStageState
  meta: ProductionCycleStageMeta
  evidence: ProductionCycleEvidence
  /** Пользователь может открыть целевой раздел. */
  canNavigate: boolean
  /** Роль, которой нужен доступ, если canNavigate=false. */
  requiredRoleHint?: AccessRoleId
}

export type ProductionCycleSubject = {
  title: string
  subtitle?: string
  salesOrderNumber?: string
  productionOrderNumber?: string
  lotBatchNo?: string
  productName?: string
  customer?: string
}

export type ProductionCycleNextAction = {
  stageId: ProductionCycleStageId
  actionKey: string
  viewId: ViewId
  viewLabelKey: string
  responsibleRoleIds: AccessRoleId[]
  canNavigate: boolean
  blocked: boolean
  missingConditionKey?: string
  missingConditionParams?: Record<string, string | number>
  refLabel?: string
}

export type ProductionCycleSnapshot = {
  context: ProductionCycleContext
  subject: ProductionCycleSubject
  outcome: ProductionCycleOutcome
  stages: ProductionCycleStageView[]
  currentStageId: ProductionCycleStageId | null
  nextAction: ProductionCycleNextAction | null
  /** Человекочитаемые якоря (без UUID в UI). */
  anchors: {
    salesOrderId?: string
    productionOrderId?: string
    lotId?: string
    finishedProductId?: string
  }
}
