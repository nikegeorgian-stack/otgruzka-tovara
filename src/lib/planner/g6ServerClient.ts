/**
 * PHASE G6 — web client for capacity planning commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { AppStore } from '@/lib/types'
import {
  g6FlagsFromStore,
  withG6ActivationOnStore,
  type G6ActivationFlags,
} from './g6Activation'
import {
  withCapacityOnStore,
  type G6CapacityDomain,
} from '@/lib/cloud/g6AuthoritativeStrip'

export type G6CommandType =
  | 'capacity.domain.activate'
  | 'capacity.norm.draft.save'
  | 'capacity.norm.draft.delete'
  | 'capacity.norm.approve'
  | 'capacity.norm.retire'
  | 'capacity.calendar.upsert'
  | 'capacity.downtime.record'
  | 'capacity.downtime.cancel'
  | 'capacity.run'
  | 'capacity.schedule.move'
  | 'capacity.schedule.split'
  | 'capacity.schedule.publish'
  | 'capacity.overload.approve'
  | 'capacity.legacy.scan'
  | 'capacity.legacy.apply'

export type G6ServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

export type G6CapacityBucket = {
  lineId?: string
  stage?: string
  date?: string
  shiftId?: string
  month?: string
  capacityM2?: number
  loadM2?: number
  freeM2?: number
  loadPct?: number
  factor?: number
  aggregated?: boolean
}

export type G6CapacityAllocation = {
  allocationId?: string
  sourceId?: string
  kind?: string
  firm?: boolean
  finishedProductId?: string
  lineId?: string
  stage?: string
  date?: string
  shiftId?: string
  month?: string
  quantityM2?: number
  overload?: boolean
  materialBlocked?: boolean
  closedShift?: boolean
  normId?: string
  normVersion?: number
  normContentHash?: string
  aggregated?: boolean
  [key: string]: unknown
}

export type G6CapacityRun = {
  capacityRunId?: string
  asOfYmd?: string
  calculatedAt?: string
  inputCriticalRevision?: number
  contentHash?: string
  stale?: boolean
  firmAllocations?: G6CapacityAllocation[]
  tentativeAllocations?: G6CapacityAllocation[]
  detailedBuckets?: G6CapacityBucket[]
  monthlyBuckets?: G6CapacityBucket[]
  loadPercentage?: number
  freeCapacity?: number
  overloadQuantity?: number
  firstCapacityShortageDate?: string | null
  lateOrders?: Array<Record<string, unknown>>
  materialBlockedOrders?: Array<Record<string, unknown>>
  normSnapshots?: Array<Record<string, unknown>>
  warnings?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type G6CapacitySchedule = {
  scheduleId?: string
  capacityRunId?: string
  status?: string
  allocations?: G6CapacityAllocation[]
  overloadQuantity?: number
  overloadApproved?: boolean
  overloadReason?: string
  publishedAt?: string
  [key: string]: unknown
}

export type G6AckPayload = {
  criticalRevision?: number
  capacityPlanningActive?: boolean
  capacityHash?: string
  domainMeta?: unknown
  capacity?: G6CapacityDomain
  capacityRunId?: string
  scheduleId?: string
  activated?: boolean
  overloadQuantity?: number
  firstCapacityShortageDate?: string | null
  contentHash?: string
  loadPercentage?: number
  freeCapacity?: number
  lateOrders?: Array<Record<string, unknown>>
  materialBlockedOrders?: Array<Record<string, unknown>>
  detailedBucketCount?: number
  monthlyBucketCount?: number
  normId?: string
  version?: number
  status?: string
  overloadApproved?: boolean
  idempotent?: boolean
  [key: string]: unknown
}

/** Same pattern as G5: web path when Firebase is configured for the app. */
export function isG6WebPath(): boolean {
  return isFirebaseConfigured()
}

export function readG6Activation(domainMeta: unknown): G6ActivationFlags {
  const meta =
    domainMeta && typeof domainMeta === 'object'
      ? (domainMeta as {
          production?: {
            features?: { capacityPlanning?: { active?: boolean } }
          }
          capacityPlanning?: { active?: boolean }
        })
      : null
  return {
    capacityPlanningActive:
      meta?.production?.features?.capacityPlanning?.active === true ||
      meta?.capacityPlanning?.active === true,
  }
}

async function bearerToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

async function g6Fetch<T>(body: Record<string, unknown>): Promise<G6ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G6 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }
  try {
    const res = await fetch(fstApiUrl('/api/fst/g6-capacity-command'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as
      | ({ error?: string; message?: string } & T)
      | null
    if (res.ok && payload && payload.error === undefined) {
      return { ok: true, data: payload as T }
    }
    const statusHint = !res.ok ? String(res.status) : ''
    return {
      ok: false,
      error: payload?.error || statusHint || 'g6_error',
      message: payload?.message || payload?.error || statusHint || 'G6 server error',
    }
  } catch (err) {
    return {
      ok: false,
      error: 'network_error',
      message: err instanceof Error ? err.message : 'G6 network error',
    }
  }
}

export async function executeG6Command<T = G6AckPayload>(args: {
  commandType: G6CommandType | string
  command?: Record<string, unknown>
  idempotencyKey: string
  storeId?: string
}): Promise<G6ServerResult<T>> {
  return g6Fetch<T>({
    storeId: args.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: args.idempotencyKey,
    commandType: args.commandType,
    command: args.command ?? {},
  })
}

type G6CmdOpts = {
  idempotencyKey: string
  storeId?: string
  command?: Record<string, unknown>
}

export type G6NamedWrapper = ((
  opts: G6CmdOpts & Record<string, unknown>,
) => Promise<G6ServerResult<G6AckPayload>>) & {
  commandType: G6CommandType
}

function wrapG6Call<T = G6AckPayload>(
  commandType: G6CommandType,
  opts: G6CmdOpts & { command?: Record<string, unknown> },
): Promise<G6ServerResult<T>> {
  return executeG6Command<T>({
    commandType,
    idempotencyKey: opts.idempotencyKey,
    storeId: opts.storeId,
    command: opts.command ?? {},
  })
}

function namedG6(
  commandType: G6CommandType,
  impl: (opts: G6CmdOpts & Record<string, unknown>) => Promise<G6ServerResult<G6AckPayload>>,
): G6NamedWrapper {
  const fn = impl as G6NamedWrapper
  fn.commandType = commandType
  return fn
}

export const g6CapacityDomainActivate = namedG6('capacity.domain.activate', (opts) =>
  wrapG6Call('capacity.domain.activate', {
    ...opts,
    command: {
      ...(opts.reason != null ? { reason: opts.reason } : {}),
      ...(opts.command ?? {}),
    },
  }),
)

export const g6CapacityNormDraftSave = namedG6('capacity.norm.draft.save', (opts) =>
  wrapG6Call('capacity.norm.draft.save', opts),
)
export const g6CapacityNormDraftDelete = namedG6('capacity.norm.draft.delete', (opts) =>
  wrapG6Call('capacity.norm.draft.delete', opts),
)
export const g6CapacityNormApprove = namedG6('capacity.norm.approve', (opts) =>
  wrapG6Call('capacity.norm.approve', opts),
)
export const g6CapacityNormRetire = namedG6('capacity.norm.retire', (opts) =>
  wrapG6Call('capacity.norm.retire', opts),
)
export const g6CapacityCalendarUpsert = namedG6('capacity.calendar.upsert', (opts) =>
  wrapG6Call('capacity.calendar.upsert', opts),
)
export const g6CapacityDowntimeRecord = namedG6('capacity.downtime.record', (opts) =>
  wrapG6Call('capacity.downtime.record', opts),
)
export const g6CapacityDowntimeCancel = namedG6('capacity.downtime.cancel', (opts) =>
  wrapG6Call('capacity.downtime.cancel', opts),
)

export const g6CapacityRun = namedG6('capacity.run', (opts) => {
  const command = {
    ...(opts.command ?? {}),
    ...(opts.asOfDate || opts.asOfYmd
      ? { asOfYmd: opts.asOfYmd ?? opts.asOfDate }
      : {}),
    ...(opts.capacityRunId ? { capacityRunId: opts.capacityRunId } : {}),
  }
  return wrapG6Call('capacity.run', { ...opts, command })
})

export const g6CapacityScheduleMove = namedG6('capacity.schedule.move', (opts) =>
  wrapG6Call('capacity.schedule.move', {
    ...opts,
    command: {
      scheduleId: opts.scheduleId,
      allocationId: opts.allocationId,
      ...(opts.lineId != null ? { lineId: opts.lineId } : {}),
      ...(opts.date != null ? { date: opts.date } : {}),
      ...(opts.shiftId != null ? { shiftId: opts.shiftId } : {}),
      ...(opts.command ?? {}),
    },
  }),
)

export const g6CapacityScheduleSplit = namedG6('capacity.schedule.split', (opts) =>
  wrapG6Call('capacity.schedule.split', {
    ...opts,
    command: {
      scheduleId: opts.scheduleId,
      allocationId: opts.allocationId,
      parts: opts.parts,
      ...(opts.command ?? {}),
    },
  }),
)

export const g6CapacitySchedulePublish = namedG6('capacity.schedule.publish', (opts) =>
  wrapG6Call('capacity.schedule.publish', {
    ...opts,
    command: {
      scheduleId: opts.scheduleId,
      ...(opts.command ?? {}),
    },
  }),
)

export const g6CapacityOverloadApprove = namedG6('capacity.overload.approve', (opts) =>
  wrapG6Call('capacity.overload.approve', {
    ...opts,
    command: {
      scheduleId: opts.scheduleId,
      reason: opts.reason,
      ...(opts.command ?? {}),
    },
  }),
)

export const g6CapacityLegacyScan = namedG6('capacity.legacy.scan', (opts) =>
  wrapG6Call('capacity.legacy.scan', opts),
)
export const g6CapacityLegacyApply = namedG6('capacity.legacy.apply', (opts) =>
  wrapG6Call('capacity.legacy.apply', opts),
)

/** Fail-closed UI helper: never mirror server ack when executeG6Command failed. */
export function mirrorG6AckIfOk(
  store: AppStore,
  result: G6ServerResult<G6AckPayload>,
): AppStore | null {
  if (!result.ok) return null
  return mirrorG6Ack(store, result.data)
}

/**
 * Conservatively merge G6 server ack into AppStore shapes.
 * Prefer server capacity domain when present; apply activation flags from ack.
 */
export function mirrorG6Ack(store: AppStore, server: G6AckPayload): AppStore {
  let next = withG6ActivationOnStore(store, {
    capacityPlanningActive: server.capacityPlanningActive,
    domainMeta: server.domainMeta,
  })

  if (server.capacity && typeof server.capacity === 'object') {
    next = withCapacityOnStore(next, server.capacity)
  }

  if (server.criticalRevision != null) {
    next = {
      ...next,
      production: {
        ...next.production,
        g6CriticalRevision: server.criticalRevision,
        g6CapacityPlanningActive: g6FlagsFromStore(next).capacityPlanningActive,
      } as typeof next.production,
    }
  }

  return next
}

export const G6_UI_GATEWAY_MATRIX: ReadonlyArray<{ wrapper: string; commandType: G6CommandType }> =
  [
    { wrapper: 'g6CapacityDomainActivate', commandType: 'capacity.domain.activate' },
    { wrapper: 'g6CapacityNormDraftSave', commandType: 'capacity.norm.draft.save' },
    { wrapper: 'g6CapacityNormDraftDelete', commandType: 'capacity.norm.draft.delete' },
    { wrapper: 'g6CapacityNormApprove', commandType: 'capacity.norm.approve' },
    { wrapper: 'g6CapacityNormRetire', commandType: 'capacity.norm.retire' },
    { wrapper: 'g6CapacityCalendarUpsert', commandType: 'capacity.calendar.upsert' },
    { wrapper: 'g6CapacityDowntimeRecord', commandType: 'capacity.downtime.record' },
    { wrapper: 'g6CapacityDowntimeCancel', commandType: 'capacity.downtime.cancel' },
    { wrapper: 'g6CapacityRun', commandType: 'capacity.run' },
    { wrapper: 'g6CapacityScheduleMove', commandType: 'capacity.schedule.move' },
    { wrapper: 'g6CapacityScheduleSplit', commandType: 'capacity.schedule.split' },
    { wrapper: 'g6CapacitySchedulePublish', commandType: 'capacity.schedule.publish' },
    { wrapper: 'g6CapacityOverloadApprove', commandType: 'capacity.overload.approve' },
    { wrapper: 'g6CapacityLegacyScan', commandType: 'capacity.legacy.scan' },
    { wrapper: 'g6CapacityLegacyApply', commandType: 'capacity.legacy.apply' },
  ] as const

export { g6FlagsFromStore, withG6ActivationOnStore }
export type { G6ActivationFlags }
