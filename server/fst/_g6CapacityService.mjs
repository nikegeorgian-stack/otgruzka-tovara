/**
 * PHASE G6 — authoritative production / packaging capacity planning.
 *
 * Trust model:
 * - Capabilities from FstPrincipalAccess.capabilitiesJson only (never AppStore roleId).
 * - Rejects payloadJson / warehousePatch / fullStore / client roleId.
 * - Server-only calculation; client cannot forge norms/runs/schedules/overload approvals.
 * - Empty capacity domain ≠ authoritative until domainMeta.production.features.capacityPlanning.active.
 * - Production/G5 activation does NOT activate capacity.
 * - Line IDs reuse authoritative '1'|'2'|'pack' (no duplicate line directory).
 * - Timezone: Asia/Tbilisi.
 */
import { FST_ADMIN_EMAILS } from './_adminAuth.mjs'
import {
  getFstCommandReceipt,
  getFstCriticalStore,
  getFstPrincipalAccessByUidStore,
  getG1DataConnect,
  insertFstCommandReceipt,
  updateFstCriticalStoreCas,
  upsertFstCriticalStore,
} from './_g1DataConnect.mjs'
import {
  emptyCapacityStore,
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  isCapacityPlanningFeatureActive,
  isMasterDataDomainActive,
  isProcurementDomainActive,
  isSalesPlanningActive,
  isWarehouseDomainActive,
  isDomainFrozen,
  markCapacityPlanningFeatureActive,
  markMasterDataDomainActive,
  markProcurementDomainActive,
  markSalesPlanningActive,
  markWarehouseDomainActive,
  parseCapabilities,
  parseCriticalPayload,
  principalAccessId,
  serializeCriticalPayload,
  stableDomainHash,
} from './_g1CriticalHelpers.mjs'
import { G6_CAPS, defaultG6Capabilities } from './_g6Capabilities.mjs'

const EPS = 1e-9
const TBILISI_TZ = 'Asia/Tbilisi'
const KNOWN_LINE_IDS = Object.freeze(['1', '2', 'pack'])
const STAGES = new Set(['production', 'packaging'])
const NORM_STATUSES = new Set(['draft', 'approved', 'retired'])
const CAL_STATUSES = new Set(['available', 'reduced', 'downtime', 'cancelled'])
const FIRM_ORDER_STATUSES = new Set(['active', 'confirmed', 'released', 'in_progress'])
const DONE_ORDER_STATUSES = new Set(['cancelled', 'completed', 'closed'])
const DETAILED_MONTHS = 3
const HORIZON_MONTHS = 12
/** Authoritative calendar weekday convention only. JS Sunday=0 is legacy.scan/apply only. */
const WEEKDAY_CONVENTION_ISO = 'ISO_8601'
const WEEKDAY_CONVENTION_JS = 'JS_SUNDAY_0'

const CAP_BY_COMMAND = Object.freeze({
  'capacity.domain.activate': G6_CAPS.CAPACITY_NORM_APPROVE,
  'capacity.norm.draft.save': G6_CAPS.CAPACITY_NORM_EDIT,
  'capacity.norm.draft.delete': G6_CAPS.CAPACITY_NORM_EDIT,
  'capacity.norm.approve': G6_CAPS.CAPACITY_NORM_APPROVE,
  'capacity.norm.retire': G6_CAPS.CAPACITY_NORM_APPROVE,
  'capacity.calendar.upsert': G6_CAPS.CAPACITY_CALENDAR_EDIT,
  'capacity.calendarTemplate.upsert': G6_CAPS.CAPACITY_CALENDAR_EDIT,
  'capacity.calendarTemplate.delete': G6_CAPS.CAPACITY_CALENDAR_EDIT,
  'capacity.downtime.record': G6_CAPS.CAPACITY_CALENDAR_EDIT,
  'capacity.downtime.cancel': G6_CAPS.CAPACITY_CALENDAR_EDIT,
  'capacity.run': G6_CAPS.CAPACITY_RUN,
  'capacity.schedule.move': G6_CAPS.CAPACITY_SCHEDULE_EDIT,
  'capacity.schedule.split': G6_CAPS.CAPACITY_SCHEDULE_EDIT,
  'capacity.schedule.publish': G6_CAPS.CAPACITY_SCHEDULE_PUBLISH,
  'capacity.overload.approve': G6_CAPS.CAPACITY_OVERLOAD_APPROVE,
  'capacity.legacy.scan': G6_CAPS.CAPACITY_READ,
  'capacity.legacy.apply': G6_CAPS.CAPACITY_NORM_APPROVE,
})

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function str(value) {
  return String(value ?? '').trim()
}

function num(value) {
  return Number(value)
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6
}

function isAdminEmail(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '')
    .trim()
    .toLowerCase()
  return Boolean(email && FST_ADMIN_EMAILS.has(email))
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

function contentHash(value) {
  const payload = stableJson(value)
  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `g6:${(h >>> 0).toString(16)}`
}

/** Calendar date YYYY-MM-DD in Asia/Tbilisi. */
export function tbilisiDate(iso = new Date().toISOString()) {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TBILISI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${day}`
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d) + days * 86400000
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function monthKeyFromYmd(ymd) {
  return String(ymd).slice(0, 7)
}

function addMonthsKey(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const yy = Math.floor(total / 12)
  const mm = String((total % 12) + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

function isKnownLineId(lineId) {
  return KNOWN_LINE_IDS.includes(str(lineId))
}

function ensureCapacity(domains) {
  const cap = domains?.capacity
  if (cap && typeof cap === 'object') {
    return {
      ...emptyCapacityStore(),
      ...cap,
      norms: Array.isArray(cap.norms) ? cap.norms : [],
      calendars: Array.isArray(cap.calendars) ? cap.calendars : [],
      calendarTemplates: Array.isArray(cap.calendarTemplates) ? cap.calendarTemplates : [],
      downtimes: Array.isArray(cap.downtimes) ? cap.downtimes : [],
      runs: Array.isArray(cap.runs) ? cap.runs : [],
      schedules: Array.isArray(cap.schedules) ? cap.schedules : [],
      auditLog: Array.isArray(cap.auditLog) ? cap.auditLog : [],
    }
  }
  return emptyCapacityStore()
}

function appendAudit(capacity, entry) {
  return {
    ...capacity,
    auditLog: [...(capacity.auditLog ?? []), entry].slice(-500),
  }
}

function actorLineScope(caps) {
  const ids = caps?.productionLineIds
  if (!Array.isArray(ids) || ids.length === 0) return null
  return new Set(ids.map(String))
}

function assertLineScope(caps, lineId) {
  const scope = actorLineScope(caps)
  if (!scope) return true
  if (scope.has('*')) return true
  return scope.has(str(lineId))
}

/**
 * Authoritative stage line mapping.
 * - Uses validProductionLineIds / validPackagingLineIds only.
 * - validLineIds is legacy input (scan/preview migration) — never authoritative allocation.
 * - Never auto-assigns 'pack' from production ids or validLineIds.
 */
function productValidLines(product, stage) {
  const productionIds = Array.isArray(product?.validProductionLineIds)
    ? product.validProductionLineIds.map(str).filter(isKnownLineId)
    : []
  const packagingIds = Array.isArray(product?.validPackagingLineIds)
    ? product.validPackagingLineIds.map(str).filter(isKnownLineId)
    : []

  if (stage === 'packaging') {
    if (!packagingIds.length) {
      return { ok: false, code: 'missing_valid_line_mapping', lines: [], field: 'validPackagingLineIds' }
    }
    return { ok: true, lines: packagingIds, field: 'validPackagingLineIds' }
  }

  if (!productionIds.length) {
    return { ok: false, code: 'missing_valid_line_mapping', lines: [], field: 'validProductionLineIds' }
  }
  return { ok: true, lines: productionIds, field: 'validProductionLineIds' }
}

/** Preview-only: split legacy validLineIds into stage fields (no auto-write). */
export function previewLegacyProductLineMapping(product) {
  const legacy = Array.isArray(product?.validLineIds)
    ? product.validLineIds.map(str).filter(isKnownLineId)
    : []
  const hasAuthProd = Array.isArray(product?.validProductionLineIds) && product.validProductionLineIds.length > 0
  const hasAuthPack = Array.isArray(product?.validPackagingLineIds) && product.validPackagingLineIds.length > 0
  if (!legacy.length) {
    return {
      needed: !hasAuthProd || !hasAuthPack,
      validProductionLineIds: hasAuthProd ? product.validProductionLineIds.map(str) : [],
      validPackagingLineIds: hasAuthPack ? product.validPackagingLineIds.map(str) : [],
      fromLegacyValidLineIds: [],
    }
  }
  const production = legacy.filter((id) => id === '1' || id === '2')
  const packaging = legacy.filter((id) => id === 'pack')
  return {
    needed: true,
    convention: 'legacy_validLineIds',
    fromLegacyValidLineIds: legacy,
    validProductionLineIds: hasAuthProd ? product.validProductionLineIds.map(str) : production,
    validPackagingLineIds: hasAuthPack ? product.validPackagingLineIds.map(str) : packaging,
    note: 'apply_requires_capacity.legacy.apply_with_reason',
  }
}

/** JS Sunday=0 → ISO 7; Mon=1…Sat=6 unchanged. */
export function jsWeekdayToIso(jsWeekday) {
  const n = Number(jsWeekday)
  if (!Number.isInteger(n) || n < 0 || n > 6) return null
  return n === 0 ? 7 : n
}

export function isIsoWeekday(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 7
}

function templateWeekdayConvention(t) {
  const c = str(t?.weekdayConvention || '')
  if (c === WEEKDAY_CONVENTION_ISO || c === WEEKDAY_CONVENTION_JS) return c
  return ''
}

function findProduct(masterData, finishedProductId) {
  const id = str(finishedProductId)
  return (masterData?.finishedProducts ?? []).find((p) => str(p.id) === id)
}

/** Confirmed production WIP output for an order (excludes packaging / reversed / superseded). */
function confirmedProductionWipMp(production, orderId) {
  let sum = 0
  const superseded = new Set()
  for (const r of production?.shiftReports ?? []) {
    if (str(r.replacesReportId || r.correctsReportId || '')) {
      superseded.add(str(r.replacesReportId || r.correctsReportId))
    }
  }
  for (const r of production?.shiftReports ?? []) {
    if (r.status !== 'confirmed') continue
    if (r.reversed === true || r.superseded === true || r.voided === true) continue
    if (superseded.has(str(r.id))) continue
    if (str(r.productionOrderId ?? r.orderId) !== str(orderId)) continue
    if (r.stage === 'packaging' || str(r.lineId) === 'pack') continue
    const signed = r.reversal === true || r.sign === -1 ? -1 : 1
    sum += signed * (Number(r.outputMp) || 0)
  }
  // Prefer live wipBatches when present (already net of corrections that removed batches)
  if (Array.isArray(production?.wipBatches) && production.wipBatches.length) {
    let wipSum = 0
    for (const b of production.wipBatches) {
      if (str(b.productionOrderId ?? b.orderId) !== str(orderId)) continue
      if (b.status === 'reversed' || b.reversed === true) continue
      wipSum += Number(b.quantityMp ?? b.remainingMp ?? b.outputMp) || 0
    }
    // If batches track remaining after packaging consumption, use max(reportNet, batchRemaining+consumed)
    // For capacity: production output = original WIP receipts. Prefer report net when batches are remaining-only.
    const batchHasRemaining =
      production.wipBatches.some(
        (b) =>
          str(b.productionOrderId ?? b.orderId) === str(orderId) &&
          b.remainingMp != null,
      )
    if (!batchHasRemaining && wipSum > EPS) return roundQty(Math.max(0, wipSum))
  }
  return roundQty(Math.max(0, sum))
}

/** Confirmed packaging / FG output (net of correction/reversal). */
function confirmedPackagingOutputMp(production, orderId) {
  let sum = 0
  const superseded = new Set()
  for (const r of production?.packagingReports ?? []) {
    if (str(r.replacesReportId || r.correctsReportId || '')) {
      superseded.add(str(r.replacesReportId || r.correctsReportId))
    }
  }
  for (const r of production?.packagingReports ?? []) {
    if (r.status !== 'confirmed') continue
    if (r.reversed === true || r.superseded === true || r.voided === true) continue
    if (superseded.has(str(r.id))) continue
    if (str(r.productionOrderId ?? r.orderId) !== str(orderId)) continue
    const signed = r.reversal === true || r.sign === -1 ? -1 : 1
    sum += signed * (Number(r.outputMp ?? r.quantityMp) || 0)
  }
  // shift reports on pack line as packaging (rare)
  for (const r of production?.shiftReports ?? []) {
    if (r.status !== 'confirmed') continue
    if (r.reversed === true || r.superseded === true) continue
    if (str(r.productionOrderId ?? r.orderId) !== str(orderId)) continue
    if (!(r.stage === 'packaging' || str(r.lineId) === 'pack')) continue
    const signed = r.reversal === true || r.sign === -1 ? -1 : 1
    sum += signed * (Number(r.outputMp) || 0)
  }
  return roundQty(Math.max(0, sum))
}

/** Actual WIP available for packaging: production WIP − packaging consumption. */
function actualWipAvailableMp(production, orderId) {
  const produced = confirmedProductionWipMp(production, orderId)
  const packed = confirmedPackagingOutputMp(production, orderId)
  return roundQty(Math.max(0, produced - packed))
}

export function computeOrderCapacityBalances(production, order) {
  const orderId = str(order.id)
  const total = Number(order.totalQtyMp) || 0
  const productionWip = confirmedProductionWipMp(production, orderId)
  const packagingOut = confirmedPackagingOutputMp(production, orderId)
  const productionRemaining = roundQty(Math.max(0, total - productionWip))
  const packagingRemaining = roundQty(Math.max(0, total - packagingOut))
  const actualWip = actualWipAvailableMp(production, orderId)
  return {
    totalQtyMp: total,
    productionWipMp: productionWip,
    packagingOutputMp: packagingOut,
    productionRemaining,
    packagingRemaining,
    actualWipAvailable: actualWip,
  }
}

function producedQtyForOrder(production, orderId, stage = 'production') {
  if (stage === 'packaging') return confirmedPackagingOutputMp(production, orderId)
  return confirmedProductionWipMp(production, orderId)
}

function selectApprovedNorm(norms, finishedProductId, lineId, stage, asOfYmd) {
  const fp = str(finishedProductId)
  const lid = str(lineId)
  const st = str(stage)
  const candidates = (norms ?? []).filter((n) => {
    if (n.status !== 'approved') return false
    if (str(n.finishedProductId) !== fp) return false
    if (str(n.lineId) !== lid) return false
    if (str(n.stage) !== st) return false
    const from = str(n.effectiveFrom || '0000-01-01')
    const to = str(n.effectiveTo || '9999-12-31')
    return asOfYmd >= from && asOfYmd <= to
  })
  candidates.sort((a, b) => Number(b.version) - Number(a.version))
  return candidates[0] ?? null
}

/** ISO weekday 1=Mon … 7=Sun for civil YYYY-MM-DD in Asia/Tbilisi. */
export function tbilisiWeekdayIso(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 8, 0, 0))
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: TBILISI_TZ,
    weekday: 'short',
  }).format(probe)
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return map[wd] || 1
}

function daysInMonthYmd(ym) {
  const [y, m] = String(ym).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out = []
  for (let d = 1; d <= last; d++) {
    out.push(`${ym}-${String(d).padStart(2, '0')}`)
  }
  return out
}

function monthPeriodBounds(ym) {
  const days = daysInMonthYmd(ym)
  return { bucketKey: str(ym), periodStart: days[0], periodEnd: days[days.length - 1], dayCount: days.length }
}

/** Authoritative templates: ISO_8601 only; weekday 1–7. Never match JS 0–6. */
function templateMatches(t, lineId, stage, ymd) {
  if (str(t.lineId) !== str(lineId)) return false
  const tStage = str(t.stage || '*')
  if (tStage !== '*' && tStage !== str(stage)) return false
  const from = str(t.effectiveFrom || '0000-01-01')
  const to = str(t.effectiveTo || '9999-12-31')
  if (ymd < from || ymd > to) return false
  if (templateWeekdayConvention(t) !== WEEKDAY_CONVENTION_ISO) return false
  const wd = Number(t.weekday)
  if (!isIsoWeekday(wd)) return false
  return wd === tbilisiWeekdayIso(ymd)
}

/**
 * Expand shifts for a date from explicit calendar overrides + recurring templates.
 * Calendar row wins for the same shiftId.
 */
export function expandShiftsForDate(lineId, stage, ymd, calendars, templates) {
  const byShift = new Map()
  for (const t of templates ?? []) {
    if (!templateMatches(t, lineId, stage, ymd)) continue
    const shiftId = str(t.shiftId || 'day')
    byShift.set(shiftId, {
      shiftId,
      source: 'template',
      plannedMinutes: Number(t.plannedMinutes) || 480,
      capacityFactor: t.capacityFactor == null ? 1 : Number(t.capacityFactor),
      status: 'available',
      templateId: t.id || t.templateId,
    })
  }
  for (const c of calendars ?? []) {
    if (str(c.lineId) !== str(lineId)) continue
    if (str(c.date) !== str(ymd)) continue
    const cStage = str(c.stage || '*')
    if (cStage !== '*' && cStage !== str(stage)) continue
    const shiftId = str(c.shiftId || 'day')
    byShift.set(shiftId, {
      shiftId,
      source: 'calendar',
      plannedMinutes: Number(c.plannedMinutes) || 480,
      capacityFactor: c.capacityFactor == null ? undefined : Number(c.capacityFactor),
      status: CAL_STATUSES.has(c.status) ? c.status : 'available',
      calendarId: c.id,
    })
  }
  return [...byShift.values()]
}

function hasCalendarOrTemplate(lineId, stage, ymdFrom, ymdTo, calendars, templates) {
  for (const t of templates ?? []) {
    if (str(t.lineId) !== str(lineId)) continue
    if (templateWeekdayConvention(t) !== WEEKDAY_CONVENTION_ISO) continue
    if (!isIsoWeekday(t.weekday)) continue
    const tStage = str(t.stage || '*')
    if (tStage !== '*' && tStage !== str(stage)) continue
    const from = str(t.effectiveFrom || '0000-01-01')
    const to = str(t.effectiveTo || '9999-12-31')
    if (to < ymdFrom || from > ymdTo) continue
    return true
  }
  for (const c of calendars ?? []) {
    if (str(c.lineId) !== str(lineId)) continue
    const cStage = str(c.stage || '*')
    if (cStage !== '*' && cStage !== str(stage)) continue
    const d = str(c.date)
    if (d >= ymdFrom && d <= ymdTo) return true
  }
  return false
}

function calendarFactor(calendars, downtimes, lineId, date, shiftId, shiftMeta) {
  const lid = str(lineId)
  const ymd = str(date)
  const sid = str(shiftId || 'day')
  const row = (calendars ?? []).find(
    (c) => str(c.lineId) === lid && str(c.date) === ymd && str(c.shiftId || 'day') === sid,
  )
  let factor = 1
  let status = shiftMeta?.status || 'available'
  let plannedMinutes = Number(shiftMeta?.plannedMinutes) || 480
  if (row) {
    status = CAL_STATUSES.has(row.status) ? row.status : 'available'
    plannedMinutes = Number(row.plannedMinutes) || plannedMinutes
    if (status === 'cancelled' || status === 'downtime') factor = 0
    else if (status === 'reduced') {
      const cf = Number(row.capacityFactor)
      factor = Number.isFinite(cf) ? Math.max(0, Math.min(1, cf)) : plannedMinutes / 480
    } else {
      const cf = Number(row.capacityFactor)
      factor = Number.isFinite(cf) ? Math.max(0, Math.min(1, cf)) : 1
    }
  } else if (shiftMeta) {
    if (status === 'cancelled' || status === 'downtime') factor = 0
    else {
      const cf = Number(shiftMeta.capacityFactor)
      factor = Number.isFinite(cf) ? Math.max(0, Math.min(1, cf)) : 1
    }
  }
  for (const d of downtimes ?? []) {
    if (d.status === 'cancelled') continue
    if (str(d.lineId) !== lid) continue
    if (str(d.date) !== ymd) continue
    if (d.shiftId && str(d.shiftId) !== sid) continue
    const minutes = Number(d.minutes)
    if (Number.isFinite(minutes) && minutes > 0 && plannedMinutes > 0) {
      factor *= Math.max(0, 1 - minutes / plannedMinutes)
    } else if (d.fullShift === true) {
      factor = 0
    }
  }
  return { factor: Math.max(0, Math.min(1, factor)), status, plannedMinutes, calendar: row }
}

/**
 * Sum available m² for a month from expanded ISO template shifts × approved norm (no fixed 22).
 * Returns { unknown:true } when no calendar/template covers the month.
 */
export function computeMonthCapacityM2({
  lineId,
  stage,
  ym,
  finishedProductId,
  norms,
  calendars,
  templates,
  downtimes,
}) {
  const { bucketKey, periodStart, periodEnd, dayCount } = monthPeriodBounds(ym)
  const days = daysInMonthYmd(ym)
  if (!hasCalendarOrTemplate(lineId, stage, periodStart, periodEnd, calendars, templates)) {
    return {
      unknown: true,
      bucketKey,
      periodStart,
      periodEnd,
      dayCount,
      capacityM2: 0,
      availableShiftCount: 0,
      availableMinutes: 0,
      shiftCount: 0,
    }
  }
  let capacityM2 = 0
  let availableShiftCount = 0
  let availableMinutes = 0
  let norm = null
  for (const ymd of days) {
    const shifts = expandShiftsForDate(lineId, stage, ymd, calendars, templates)
    for (const sh of shifts) {
      const n = selectApprovedNorm(norms, finishedProductId, lineId, stage, ymd)
      if (!n) continue
      norm = n
      const { factor, status, plannedMinutes } = calendarFactor(
        calendars,
        downtimes,
        lineId,
        ymd,
        sh.shiftId,
        sh,
      )
      if (status === 'cancelled') continue
      const base = Number(n.capacityM2PerShift) || 0
      const avail = roundQty(base * factor)
      const mins = roundQty((Number(plannedMinutes) || 0) * factor)
      if (avail > EPS || factor > EPS) {
        availableShiftCount += 1
        availableMinutes = roundQty(availableMinutes + mins)
      }
      if (avail > EPS) {
        capacityM2 = roundQty(capacityM2 + avail)
      }
    }
  }
  return {
    unknown: false,
    bucketKey,
    periodStart,
    periodEnd,
    dayCount,
    capacityM2,
    availableShiftCount,
    availableMinutes,
    shiftCount: availableShiftCount,
    norm,
  }
}

function buildDetailedSlots(startYmd, detailedEndYmd, lineIds, stage, calendars, templates) {
  const slots = []
  let cur = startYmd
  while (cur <= detailedEndYmd) {
    for (const lineId of lineIds) {
      const shifts = expandShiftsForDate(lineId, stage, cur, calendars, templates)
      for (const sh of shifts) {
        slots.push({ date: cur, shiftId: sh.shiftId, lineId, shiftMeta: sh })
      }
    }
    cur = addDaysYmd(cur, 1)
  }
  return slots
}

function compareLoadSources(a, b) {
  if (a.firm !== b.firm) return a.firm ? -1 : 1
  const pa = Number(a.priority) || 0
  const pb = Number(b.priority) || 0
  if (pa !== pb) return pb - pa
  const da = str(a.dueOrStart || '9999-12-31')
  const db = str(b.dueOrStart || '9999-12-31')
  if (da !== db) return da < db ? -1 : 1
  const ca = str(a.confirmedAt || a.createdAt || '')
  const cb = str(b.confirmedAt || b.createdAt || '')
  if (ca !== cb) return ca < cb ? -1 : 1
  const ida = str(a.id)
  const idb = str(b.id)
  return ida < idb ? -1 : ida > idb ? 1 : 0
}

function collectLoadSources(payload, asOfYmd) {
  const production = payload.domains.production ?? {}
  const planning = payload.domains.planning ?? {}
  const masterData = payload.domains.masterData ?? {}
  const sources = []
  const mappingErrors = []

  for (const order of production.orders ?? []) {
    const status = str(order.status)
    if (DONE_ORDER_STATUSES.has(status)) continue
    if (!FIRM_ORDER_STATUSES.has(status)) continue
    const bal = computeOrderCapacityBalances(production, order)
    if (bal.productionRemaining <= EPS && bal.packagingRemaining <= EPS) continue
    const product = findProduct(masterData, order.finishedProductId)
    const prodLines = productValidLines(product, 'production')
    const packLines = productValidLines(product, 'packaging')
    if (!prodLines.ok) {
      mappingErrors.push({
        code: 'missing_valid_line_mapping',
        sourceId: str(order.id),
        finishedProductId: str(order.finishedProductId),
        stage: 'production',
        field: prodLines.field,
      })
    }
    if (!packLines.ok && bal.packagingRemaining > EPS) {
      mappingErrors.push({
        code: 'missing_valid_line_mapping',
        sourceId: str(order.id),
        finishedProductId: str(order.finishedProductId),
        stage: 'packaging',
        field: packLines.field,
      })
    }
    // Prefer order.lineId only when it is in the authoritative valid production set (never forge)
    const orderLine = str(order.lineId || '')
    if (orderLine && prodLines.ok && !prodLines.lines.includes(orderLine)) {
      mappingErrors.push({
        code: 'forged_client_line_mapping',
        sourceId: str(order.id),
        lineId: orderLine,
        stage: 'production',
      })
    }
    if (orderLine && packLines.ok && order.stage === 'packaging' && !packLines.lines.includes(orderLine)) {
      mappingErrors.push({
        code: 'forged_client_line_mapping',
        sourceId: str(order.id),
        lineId: orderLine,
        stage: 'packaging',
      })
    }
    sources.push({
      id: str(order.id),
      kind: 'firm',
      firm: true,
      finishedProductId: str(order.finishedProductId),
      lineId: orderLine && prodLines.ok && prodLines.lines.includes(orderLine) ? orderLine : '',
      productionValidLineIds: prodLines.ok ? prodLines.lines : [],
      packagingValidLineIds: packLines.ok ? packLines.lines : [],
      mappingOkProduction: prodLines.ok,
      mappingOkPackaging: packLines.ok,
      remainingProduction: bal.productionRemaining,
      remainingPackaging: bal.packagingRemaining,
      actualWipAvailable: bal.actualWipAvailable,
      productionWipMp: bal.productionWipMp,
      packagingOutputMp: bal.packagingOutputMp,
      priority: Number(order.priority) || 0,
      dueOrStart: str(order.dueDate || order.plannedStartDate || order.startDate || ''),
      confirmedAt: str(order.confirmedAt || order.activatedAt || order.createdAt || ''),
      createdAt: str(order.createdAt || ''),
      materialBlocked: order.materialBlocked === true || order.materialShortage === true,
      stageHints: ['production', 'packaging'],
    })
  }

  for (const rec of planning.productionRecommendations ?? []) {
    const status = str(rec.status)
    if (status !== 'accepted' && status !== 'tentative') continue
    const qty = Number(rec.quantityMp ?? rec.remainingQtyMp ?? rec.qtyMp) || 0
    if (qty <= EPS) continue
    const product = findProduct(masterData, rec.finishedProductId)
    const prodLines = productValidLines(product, 'production')
    const packLines = productValidLines(product, 'packaging')
    if (!prodLines.ok) {
      mappingErrors.push({
        code: 'missing_valid_line_mapping',
        sourceId: str(rec.id),
        finishedProductId: str(rec.finishedProductId),
        stage: 'production',
        field: prodLines.field,
      })
    }
    sources.push({
      id: str(rec.id),
      kind: 'tentative',
      firm: false,
      finishedProductId: str(rec.finishedProductId),
      lineId:
        str(rec.lineId || '') && prodLines.ok && prodLines.lines.includes(str(rec.lineId))
          ? str(rec.lineId)
          : '',
      productionValidLineIds: prodLines.ok ? prodLines.lines : [],
      packagingValidLineIds: packLines.ok ? packLines.lines : [],
      mappingOkProduction: prodLines.ok,
      mappingOkPackaging: packLines.ok,
      remainingProduction: roundQty(qty),
      remainingPackaging: roundQty(qty),
      actualWipAvailable: 0,
      productionWipMp: 0,
      packagingOutputMp: 0,
      priority: Number(rec.priority) || 0,
      dueOrStart: str(rec.dueDate || rec.suggestedStartDate || ''),
      confirmedAt: str(rec.acceptedAt || rec.createdAt || ''),
      createdAt: str(rec.createdAt || ''),
      materialBlocked: rec.materialBlocked === true,
      stageHints: ['production', 'packaging'],
    })
  }

  sources.sort(compareLoadSources)
  return { sources, mappingErrors, asOfYmd }
}

function pickPreferredLine(src, stage) {
  const valid =
    stage === 'packaging' ? src.packagingValidLineIds : src.productionValidLineIds
  if (!valid?.length) return null
  if (src.lineId && valid.includes(src.lineId)) return src.lineId
  // Deterministic first sorted — never invent 'pack' from production mapping
  return [...valid].sort()[0]
}

/** Compare planned WIP unlock keys: day dates and month bucketKeys in chronological order. */
function plannedUnlockKey(entry) {
  if (entry.kind === 'month' || entry.bucketKey) {
    return str(entry.bucketKey || entry.periodEnd || '')
  }
  return str(entry.date || '')
}

function plannedUnlockSort(a, b) {
  const ka = plannedUnlockKey(a)
  const kb = plannedUnlockKey(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  return 0
}

/** True when planned production entry is available for packaging at day or month bucket. */
function plannedAvailableAt(entry, atDayYmd, atBucketKey) {
  if (entry.kind === 'month' || entry.bucketKey) {
    const bk = str(entry.bucketKey)
    if (atBucketKey) return bk <= str(atBucketKey)
    // day-level packaging: month bucket unlocks only after periodEnd
    return str(entry.periodEnd || '') <= str(atDayYmd)
  }
  const d = str(entry.date || '')
  if (atBucketKey) {
    // day production available in month buckets whose periodEnd >= date
    return d.slice(0, 7) <= str(atBucketKey)
  }
  return d <= str(atDayYmd)
}

function allocateHorizon(payload, capacity, asOfYmd, nowIso) {
  const norms = capacity.norms ?? []
  const calendars = capacity.calendars ?? []
  const templates = capacity.calendarTemplates ?? []
  const downtimes = capacity.downtimes ?? []
  const startMonth = monthKeyFromYmd(asOfYmd)
  const detailedEndMonth = addMonthsKey(startMonth, DETAILED_MONTHS - 1)
  const horizonEndMonth = addMonthsKey(startMonth, HORIZON_MONTHS - 1)

  const [dy, dm] = detailedEndMonth.split('-').map(Number)
  const detailedEndYmd = tbilisiDate(new Date(Date.UTC(dy, dm, 0)).toISOString())

  const { sources, mappingErrors } = collectLoadSources(payload, asOfYmd)
  const firmAllocations = []
  const tentativeAllocations = []
  const lateOrders = []
  const materialBlockedOrders = []
  const wipBlockedOrders = []
  const warnings = []
  const errors = [...mappingErrors]
  const masterDataErrors = mappingErrors.map((e) => ({
    id: `mde-${e.sourceId}-${e.stage}-${e.code}`,
    code: e.code,
    sourceId: e.sourceId,
    finishedProductId: e.finishedProductId,
    stage: e.stage,
    lineId: e.lineId,
    at: nowIso,
    domain: 'capacity',
  }))
  const normSnapshots = []

  const bucketKey = (lineId, stage, date, shiftId) => `${lineId}|${stage}|${date}|${shiftId}`
  const monthBucketKey = (lineId, stage, ym) => `${lineId}|${stage}|${ym}`
  const remainingCap = new Map()
  const monthCap = new Map()
  const monthLoad = new Map()
  const monthUnknown = new Set()

  function ensureSlotCap(lineId, stage, date, shiftId, productId, shiftMeta) {
    const key = bucketKey(lineId, stage, date, shiftId)
    if (remainingCap.has(key)) return remainingCap.get(key)
    const norm = selectApprovedNorm(norms, productId, lineId, stage, date)
    if (!norm) {
      remainingCap.set(key, { remaining: 0, capacity: 0, norm: null, factor: 0 })
      return remainingCap.get(key)
    }
    const { factor } = calendarFactor(calendars, downtimes, lineId, date, shiftId, shiftMeta)
    const base = Number(norm.capacityM2PerShift) || 0
    const avail = roundQty(base * factor)
    const snap = {
      normId: norm.normId,
      version: norm.version,
      contentHash: norm.contentHash,
      finishedProductId: productId,
      lineId,
      stage,
      capacityM2PerShift: base,
      factor,
      availableM2: avail,
      date,
      shiftId,
    }
    if (!normSnapshots.find((s) => s.normId === snap.normId && s.version === snap.version && s.date === date && s.shiftId === shiftId)) {
      normSnapshots.push(snap)
    }
    const cell = { remaining: avail, capacity: avail, norm, factor }
    remainingCap.set(key, cell)
    return cell
  }

  function ensureMonthCap(lineId, stage, ym, productId) {
    const key = monthBucketKey(lineId, stage, ym)
    if (monthCap.has(key)) return monthCap.get(key)
    const computed = computeMonthCapacityM2({
      lineId,
      stage,
      ym,
      finishedProductId: productId,
      norms,
      calendars,
      templates,
      downtimes,
    })
    if (computed.unknown) {
      monthUnknown.add(key)
      monthCap.set(key, {
        remaining: 0,
        capacity: 0,
        norm: null,
        unknown: true,
        bucketKey: computed.bucketKey,
        periodStart: computed.periodStart,
        periodEnd: computed.periodEnd,
        availableShiftCount: 0,
        availableMinutes: 0,
      })
      return monthCap.get(key)
    }
    const cell = {
      remaining: roundQty(computed.capacityM2),
      capacity: roundQty(computed.capacityM2),
      norm: computed.norm,
      unknown: false,
      bucketKey: computed.bucketKey,
      periodStart: computed.periodStart,
      periodEnd: computed.periodEnd,
      availableShiftCount: computed.availableShiftCount,
      availableMinutes: computed.availableMinutes,
      shiftCount: computed.availableShiftCount,
    }
    monthCap.set(key, cell)
    monthLoad.set(key, 0)
    return cell
  }

  let firstCapacityShortageDate = null

  // Track planned production WIP: day entries + month bucket entries (no surrogate dates)
  const plannedWipBySource = new Map() // sourceId -> planned entries

  function pushAlloc(alloc) {
    if (alloc.firm) firmAllocations.push(alloc)
    else tentativeAllocations.push(alloc)
  }

  function allocateStageQuantity(src, stage, preferredLine, remaining, opts = {}) {
    let left = remaining
    const wipGate = opts.wipGate === true
    let actualWipLeft = Number(opts.actualWipLeft) || 0
    const plannedQueue = [...(opts.plannedQueue || [])].sort(plannedUnlockSort)
    let plannedIdx = 0
    let plannedLeft = 0

    function releasePlannedForDay(dateYmd) {
      while (plannedIdx < plannedQueue.length) {
        const entry = plannedQueue[plannedIdx]
        if (!plannedAvailableAt(entry, dateYmd, null)) break
        plannedLeft = roundQty(plannedLeft + (Number(entry.qty) || 0))
        plannedIdx += 1
      }
    }

    function releasePlannedForBucket(bucketKey) {
      while (plannedIdx < plannedQueue.length) {
        const entry = plannedQueue[plannedIdx]
        if (!plannedAvailableAt(entry, null, bucketKey)) break
        plannedLeft = roundQty(plannedLeft + (Number(entry.qty) || 0))
        plannedIdx += 1
      }
    }

    const lineIdsForSlots = [preferredLine]
    const detailedSlots = buildDetailedSlots(
      asOfYmd,
      detailedEndYmd,
      lineIdsForSlots,
      stage,
      calendars,
      templates,
    )

    if (
      !hasCalendarOrTemplate(preferredLine, stage, asOfYmd, detailedEndYmd, calendars, templates) &&
      detailedSlots.length === 0
    ) {
      errors.push({
        code: 'capacity_unknown',
        sourceId: src.id,
        stage,
        lineId: preferredLine,
        range: 'detailed',
      })
      masterDataErrors.push({
        id: `mde-capunk-${src.id}-${stage}`,
        code: 'capacity_unknown',
        sourceId: src.id,
        finishedProductId: src.finishedProductId,
        stage,
        lineId: preferredLine,
        at: nowIso,
        domain: 'capacity',
      })
      return { remaining: left, actualWipLeft, plannedProduced: [] }
    }

    const plannedProduced = []

    for (const slot of detailedSlots) {
      if (left <= EPS) break
      if (slot.lineId !== preferredLine) continue
      const cell = ensureSlotCap(
        preferredLine,
        stage,
        slot.date,
        slot.shiftId,
        src.finishedProductId,
        slot.shiftMeta,
      )
      if (!cell.norm || cell.remaining <= EPS) continue

      let take = roundQty(Math.min(left, cell.remaining))
      let wipTag = null
      if (wipGate) {
        releasePlannedForDay(slot.date)
        const availableNow = roundQty(actualWipLeft + plannedLeft)
        if (availableNow <= EPS) {
          continue
        }
        take = roundQty(Math.min(take, availableNow))
        if (take <= EPS) continue
        const fromActual = roundQty(Math.min(take, actualWipLeft))
        actualWipLeft = roundQty(actualWipLeft - fromActual)
        const fromPlanned = roundQty(take - fromActual)
        plannedLeft = roundQty(plannedLeft - fromPlanned)
        if (fromPlanned > EPS) wipTag = 'wip_planned'
      }

      cell.remaining = roundQty(cell.remaining - take)
      left = roundQty(left - take)
      if (stage === 'production') {
        plannedProduced.push({ kind: 'day', date: slot.date, qty: take })
      }
      const alloc = {
        allocationId: `ca-${src.id}-${stage}-${slot.date}-${slot.shiftId}`,
        sourceId: src.id,
        kind: src.kind,
        firm: src.firm,
        finishedProductId: src.finishedProductId,
        lineId: preferredLine,
        stage,
        date: slot.date,
        shiftId: slot.shiftId,
        quantityM2: take,
        materialBlocked: src.materialBlocked === true,
        ...(wipTag ? { wipDependency: wipTag } : {}),
        normSnapshot: {
          normId: cell.norm.normId,
          version: cell.norm.version,
          contentHash: cell.norm.contentHash,
          capacityM2PerShift: cell.norm.capacityM2PerShift,
        },
      }
      pushAlloc(alloc)
      if (src.dueOrStart && slot.date > src.dueOrStart) {
        lateOrders.push({ sourceId: src.id, stage, date: slot.date, dueOrStart: src.dueOrStart })
      }
    }

    // aggregated months 4–12 — real monthly buckets (no surrogate day dates)
    if (left > EPS) {
      let ym = addMonthsKey(detailedEndMonth, 1)
      while (ym <= horizonEndMonth && left > EPS) {
        const cell = ensureMonthCap(preferredLine, stage, ym, src.finishedProductId)
        const { periodStart, periodEnd, bucketKey } = cell
        if (cell.unknown) {
          errors.push({
            code: 'capacity_unknown',
            sourceId: src.id,
            stage,
            lineId: preferredLine,
            month: ym,
            bucketKey,
          })
          masterDataErrors.push({
            id: `mde-capunk-${src.id}-${stage}-${ym}`,
            code: 'capacity_unknown',
            sourceId: src.id,
            finishedProductId: src.finishedProductId,
            stage,
            lineId: preferredLine,
            month: ym,
            bucketKey,
            at: nowIso,
            domain: 'capacity',
          })
          ym = addMonthsKey(ym, 1)
          continue
        }
        if (!cell.norm || cell.remaining <= EPS) {
          ym = addMonthsKey(ym, 1)
          continue
        }
        let take = roundQty(Math.min(left, cell.remaining))
        let wipTag = null
        if (wipGate) {
          releasePlannedForBucket(bucketKey)
          const availableNow = roundQty(actualWipLeft + plannedLeft)
          if (availableNow <= EPS) {
            ym = addMonthsKey(ym, 1)
            continue
          }
          take = roundQty(Math.min(take, availableNow))
          if (take <= EPS) {
            ym = addMonthsKey(ym, 1)
            continue
          }
          const fromActual = roundQty(Math.min(take, actualWipLeft))
          actualWipLeft = roundQty(actualWipLeft - fromActual)
          const fromPlanned = roundQty(take - fromActual)
          plannedLeft = roundQty(plannedLeft - fromPlanned)
          if (fromPlanned > EPS) wipTag = 'wip_planned'
        }
        cell.remaining = roundQty(cell.remaining - take)
        monthLoad.set(
          monthBucketKey(preferredLine, stage, ym),
          roundQty((monthLoad.get(monthBucketKey(preferredLine, stage, ym)) || 0) + take),
        )
        left = roundQty(left - take)
        if (stage === 'production') {
          plannedProduced.push({
            kind: 'month',
            bucketKey,
            periodStart,
            periodEnd,
            qty: take,
          })
        }
        const alloc = {
          allocationId: `ca-${src.id}-${stage}-${ym}`,
          sourceId: src.id,
          kind: src.kind,
          firm: src.firm,
          finishedProductId: src.finishedProductId,
          lineId: preferredLine,
          stage,
          bucketKey,
          periodStart,
          periodEnd,
          month: ym,
          aggregated: true,
          quantityM2: take,
          materialBlocked: src.materialBlocked === true,
          ...(wipTag ? { wipDependency: wipTag } : {}),
          normSnapshot: cell.norm
            ? {
                normId: cell.norm.normId,
                version: cell.norm.version,
                contentHash: cell.norm.contentHash,
                capacityM2PerShift: cell.norm.capacityM2PerShift,
              }
            : undefined,
        }
        pushAlloc(alloc)
        // Late relative to bucket boundaries (not a fake mid-month day)
        if (src.dueOrStart && src.dueOrStart < periodStart) {
          lateOrders.push({
            sourceId: src.id,
            stage,
            bucketKey,
            periodStart,
            periodEnd,
            dueOrStart: src.dueOrStart,
          })
        }
        ym = addMonthsKey(ym, 1)
      }
    }

    return { remaining: left, actualWipLeft, plannedProduced }
  }

  for (const src of sources) {
    if (src.materialBlocked) {
      materialBlockedOrders.push({
        sourceId: src.id,
        kind: src.kind,
        finishedProductId: src.finishedProductId,
        remaining: src.remainingProduction,
      })
    }

    // --- production first ---
    let plannedForPack = []
    if (src.remainingProduction > EPS) {
      if (!src.mappingOkProduction) {
        // already in errors/masterDataErrors — do not allocate
      } else {
        const preferredLine = pickPreferredLine(src, 'production')
        if (!preferredLine || !isKnownLineId(preferredLine)) {
          errors.push({ code: 'no_valid_line', sourceId: src.id, stage: 'production' })
        } else {
          const prodResult = allocateStageQuantity(
            src,
            'production',
            preferredLine,
            src.remainingProduction,
          )
          plannedForPack = prodResult.plannedProduced
          plannedWipBySource.set(src.id, plannedForPack)
          if (prodResult.remaining > EPS) {
            if (!firstCapacityShortageDate) firstCapacityShortageDate = asOfYmd
            warnings.push({
              code: 'overload',
              sourceId: src.id,
              stage: 'production',
              overloadM2: prodResult.remaining,
              lineId: preferredLine,
            })
            pushAlloc({
              allocationId: `ca-${src.id}-production-overload`,
              sourceId: src.id,
              kind: src.kind,
              firm: src.firm,
              finishedProductId: src.finishedProductId,
              lineId: preferredLine,
              stage: 'production',
              overload: true,
              quantityM2: prodResult.remaining,
              materialBlocked: src.materialBlocked === true,
            })
          }
          src.remainingProduction = prodResult.remaining
        }
      }
    }

    // --- packaging depends on WIP ---
    if (src.remainingPackaging > EPS) {
      if (!src.mappingOkPackaging) {
        // skip
      } else {
        const preferredLine = pickPreferredLine(src, 'packaging')
        if (!preferredLine || !isKnownLineId(preferredLine)) {
          errors.push({ code: 'no_valid_line', sourceId: src.id, stage: 'packaging' })
        } else {
          const plannedQueue = [...(plannedWipBySource.get(src.id) || [])].sort(plannedUnlockSort)
          const packResult = allocateStageQuantity(
            src,
            'packaging',
            preferredLine,
            src.remainingPackaging,
            {
              wipGate: true,
              actualWipLeft: src.actualWipAvailable,
              plannedQueue,
            },
          )
          if (packResult.remaining > EPS) {
            const hadAnyPlanned = plannedQueue.some((p) => p.qty > EPS)
            const code =
              src.actualWipAvailable <= EPS && !hadAnyPlanned
                ? 'wip_blocked'
                : packResult.actualWipLeft <= EPS && hadAnyPlanned
                  ? 'wip_blocked'
                  : 'wip_blocked'
            wipBlockedOrders.push({
              sourceId: src.id,
              stage: 'packaging',
              remaining: packResult.remaining,
              actualWipAvailable: src.actualWipAvailable,
              code,
            })
            warnings.push({
              code,
              sourceId: src.id,
              stage: 'packaging',
              remainingM2: packResult.remaining,
              lineId: preferredLine,
            })
            pushAlloc({
              allocationId: `ca-${src.id}-packaging-wip-blocked`,
              sourceId: src.id,
              kind: src.kind,
              firm: src.firm,
              finishedProductId: src.finishedProductId,
              lineId: preferredLine,
              stage: 'packaging',
              wipDependency: 'wip_blocked',
              quantityM2: packResult.remaining,
              materialBlocked: src.materialBlocked === true,
            })
          }
          src.remainingPackaging = packResult.remaining
        }
      }
    }
  }

  const detailedBuckets = []
  for (const [key, cell] of remainingCap.entries()) {
    const [lineId, stage, date, shiftId] = key.split('|')
    const load = roundQty(cell.capacity - cell.remaining)
    detailedBuckets.push({
      lineId,
      stage,
      date,
      shiftId,
      capacityM2: cell.capacity,
      loadM2: load,
      freeM2: cell.remaining,
      loadPct: cell.capacity > EPS ? roundQty((load / cell.capacity) * 100) : 0,
      factor: cell.factor,
    })
  }

  const monthlyBuckets = []
  for (const [key, cell] of monthCap.entries()) {
    const [lineId, stage, month] = key.split('|')
    const allocatedM2 = roundQty(monthLoad.get(key) || cell.capacity - cell.remaining)
    const remainingM2 = roundQty(cell.remaining)
    const overloadM2 = remainingM2 < -EPS ? roundQty(-remainingM2) : 0
    monthlyBuckets.push({
      bucketKey: cell.bucketKey || month,
      periodStart: cell.periodStart,
      periodEnd: cell.periodEnd,
      lineId,
      stage,
      month,
      availableShiftCount: cell.availableShiftCount ?? cell.shiftCount ?? 0,
      availableMinutes: cell.availableMinutes ?? 0,
      capacityM2: cell.capacity,
      allocatedM2,
      remainingM2,
      overloadM2,
      loadM2: allocatedM2,
      freeM2: remainingM2,
      loadPct: cell.capacity > EPS ? roundQty((allocatedM2 / cell.capacity) * 100) : 0,
      aggregated: true,
      capacityUnknown: cell.unknown === true,
      weekdayConvention: WEEKDAY_CONVENTION_ISO,
    })
  }

  const overloadQuantity = roundQty(
    warnings.filter((w) => w.code === 'overload').reduce((s, w) => s + (Number(w.overloadM2) || 0), 0),
  )

  const runBody = {
    asOfYmd,
    calculatedAt: nowIso,
    timezone: TBILISI_TZ,
    horizonMonths: HORIZON_MONTHS,
    detailedMonths: DETAILED_MONTHS,
    inputCriticalRevision: null,
    firmAllocations,
    tentativeAllocations,
    detailedBuckets,
    monthlyBuckets,
    loadPercentage:
      detailedBuckets.length || monthlyBuckets.length
        ? roundQty(
            (() => {
              const caps = [...detailedBuckets, ...monthlyBuckets].filter((b) => !b.capacityUnknown)
              const c = caps.reduce((s, b) => s + b.capacityM2, 0)
              const l = caps.reduce((s, b) => s + b.loadM2, 0)
              return c > EPS ? (l / c) * 100 : 0
            })(),
          )
        : 0,
    freeCapacity: roundQty(
      [...detailedBuckets, ...monthlyBuckets]
        .filter((b) => !b.capacityUnknown)
        .reduce((s, b) => s + b.freeM2, 0),
    ),
    overloadQuantity,
    firstCapacityShortageDate,
    lateOrders,
    materialBlockedOrders,
    wipBlockedOrders,
    warnings,
    errors,
    masterDataErrors,
    normSnapshots,
  }
  return runBody
}

async function loadCritical(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) {
    const empty = emptyCriticalPayload()
    return {
      revision: 0,
      payload: empty,
      exists: false,
    }
  }
  const parsed = parseCriticalPayload(row.payloadJson, { revision: row.revision })
  if (!parsed.ok) throw new Error(parsed.error || 'invalid_critical_payload')
  return { revision: Number(row.revision) || 0, payload: parsed.payload, exists: true }
}

async function resolveActorAccess(dc, actor, storeId) {
  const accessId = principalAccessId(storeId, actor.uid)
  const { data } = await getFstPrincipalAccessByUidStore(dc, {
    firebaseUid: actor.uid,
    storeId,
  })
  const row = data?.fstPrincipalAccesses?.[0] ?? null
  if ((!row || row.active !== true) && !isAdminEmail(actor)) {
    return { ok: false, error: 'principal_access_missing', status: 403 }
  }
  const caps = parseCapabilities(row?.capabilitiesJson)
  const g6 = defaultG6Capabilities(caps)
  // admin emergency: still needs explicit caps OR emergency reason on overload/activate
  if (isAdminEmail(actor)) {
    for (const k of Object.values(G6_CAPS)) {
      if (caps[k] === true) g6[k] = true
    }
  }
  for (const k of Object.values(G6_CAPS)) {
    if (caps[k] === true) g6[k] = true
  }
  if (Array.isArray(caps.productionLineIds)) g6.productionLineIds = caps.productionLineIds
  if (Array.isArray(caps.warehouseIds)) g6.warehouseIds = caps.warehouseIds
  return { ok: true, caps: g6, accessId, row }
}

async function casCommitG6(
  dc,
  storeId,
  critical,
  actorUid,
  {
    capacity,
    production,
    planning,
    masterData,
    idempotencyKey,
    commandType,
    result,
    activateCapacity = false,
  } = {},
) {
  const prev = critical.payload.domains ?? {}
  let nextPayload = {
    ...critical.payload,
    schemaVersion: Math.max(Number(critical.payload.schemaVersion) || 0, 5),
    domains: {
      ...prev,
      warehouse: prev.warehouse,
      production: production !== undefined ? production : prev.production,
      masterData: masterData !== undefined ? masterData : prev.masterData,
      sales: prev.sales,
      planning: planning !== undefined ? planning : prev.planning,
      procurement: prev.procurement,
      capacity: capacity !== undefined ? capacity : prev.capacity ?? emptyCapacityStore(),
    },
  }

  if (activateCapacity) {
    nextPayload = markCapacityPlanningFeatureActive(nextPayload, actorUid)
  } else if (isCapacityPlanningFeatureActive(critical.payload)) {
    nextPayload = markCapacityPlanningFeatureActive(nextPayload, actorUid)
  }

  // Preserve sibling domain activation markers without activating capacity via G5
  if (isMasterDataDomainActive(critical.payload)) {
    nextPayload = markMasterDataDomainActive(nextPayload, actorUid)
  }
  if (isSalesPlanningActive(critical.payload)) {
    nextPayload = markSalesPlanningActive(nextPayload, actorUid)
  }
  if (isProcurementDomainActive(critical.payload)) {
    nextPayload = markProcurementDomainActive(nextPayload, actorUid)
  }
  if (isWarehouseDomainActive(critical.payload, critical.revision)) {
    nextPayload = markWarehouseDomainActive(nextPayload, actorUid)
  }

  const nextRevision = critical.revision + 1
  if (idempotencyKey && result) {
    nextPayload = {
      ...nextPayload,
      commandReceipts: {
        ...(nextPayload.commandReceipts ?? {}),
        [idempotencyKey]: {
          commandType,
          actorUid,
          at: new Date().toISOString(),
          criticalRevisionAfter: nextRevision,
          result: { ...result, criticalRevision: nextRevision },
        },
      },
    }
  }

  const nextJson = serializeCriticalPayload(nextPayload)
  try {
    if (!critical.exists && critical.revision === 0) {
      await upsertFstCriticalStore(dc, {
        id: storeId,
        revision: nextRevision,
        payloadJson: nextJson,
        fingerprint: fingerprintCriticalPayload(nextJson),
        updatedByUid: actorUid,
      })
    } else {
      await updateFstCriticalStoreCas(dc, {
        id: storeId,
        expectedRevision: critical.revision,
        revision: nextRevision,
        payloadJson: nextJson,
        fingerprint: fingerprintCriticalPayload(nextJson),
        updatedByUid: actorUid,
      })
    }
  } catch (err) {
    const msg = String(err?.message ?? err ?? '')
    if (msg.includes('revision_conflict') || msg.includes('FAILED_PRECONDITION')) {
      return fail('revision_conflict', 409)
    }
    throw err
  }

  return ok({
    criticalRevision: nextRevision,
    capacity: nextPayload.domains.capacity,
    production: nextPayload.domains.production,
    payload: nextPayload,
    capacityHash: stableDomainHash(nextPayload.domains.capacity),
    capacityPlanningActive: isCapacityPlanningFeatureActive(nextPayload),
  })
}

function requireActive(payload) {
  if (!isCapacityPlanningFeatureActive(payload)) {
    return fail('capacity_feature_inactive', 409)
  }
  return null
}

function applyActivate(capacity, command, actor, now) {
  const reason = str(command.reason)
  if (isAdminEmail(actor) && !reason) {
    // director path via capability is enough; admin without cap needs reason
  }
  let next = appendAudit(capacity, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'capacity.domain.activate',
    actorUid: actor.uid,
    detail: reason || 'activate',
  })
  return ok({ capacity: next, result: { activated: true }, activateCapacity: true })
}

function applyNormDraftSave(capacity, command, actor, now) {
  const finishedProductId = str(command.finishedProductId)
  const lineId = str(command.lineId)
  const stage = str(command.stage)
  if (!finishedProductId) return fail('finished_product_required')
  if (!isKnownLineId(lineId)) return fail('invalid_line_id')
  if (!STAGES.has(stage)) return fail('invalid_stage')
  const capacityM2PerShift = num(command.capacityM2PerShift)
  if (!Number.isFinite(capacityM2PerShift) || capacityM2PerShift <= 0) return fail('invalid_capacity')
  const shiftDurationMinutes = num(command.shiftDurationMinutes) || 480
  const expectedRollsPerShift =
    command.expectedRollsPerShift == null ? undefined : num(command.expectedRollsPerShift)
  const effectiveFrom = str(command.effectiveFrom || tbilisiDate(now))
  const effectiveTo = command.effectiveTo ? str(command.effectiveTo) : undefined

  const normId = str(command.normId) || `cn-${crypto.randomUUID()}`
  const existingSame = (capacity.norms ?? []).filter(
    (n) => str(n.normId) === normId || (str(n.finishedProductId) === finishedProductId && str(n.lineId) === lineId && str(n.stage) === stage),
  )
  const maxVersion = existingSame.reduce((m, n) => Math.max(m, Number(n.version) || 0), 0)
  const editing = (capacity.norms ?? []).find((n) => str(n.normId) === normId && n.status === 'draft')
  if (editing) {
    // update draft in place (immutable approved not touched)
    const body = {
      ...editing,
      finishedProductId,
      lineId,
      stage,
      capacityM2PerShift,
      expectedRollsPerShift,
      shiftDurationMinutes,
      effectiveFrom,
      effectiveTo,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    body.contentHash = contentHash({
      finishedProductId,
      lineId,
      stage,
      version: body.version,
      capacityM2PerShift,
      expectedRollsPerShift,
      shiftDurationMinutes,
      effectiveFrom,
      effectiveTo,
    })
    const norms = (capacity.norms ?? []).map((n) => (n.normId === editing.normId && n.version === editing.version ? body : n))
    return ok({
      capacity: appendAudit({ ...capacity, norms }, {
        id: `aud-${crypto.randomUUID()}`,
        at: now,
        action: 'capacity.norm.draft.save',
        actorUid: actor.uid,
        detail: `${normId}@${body.version}`,
      }),
      result: { normId, version: body.version, status: 'draft' },
    })
  }

  const version = maxVersion + 1
  // duplicate product+line+stage+version forbidden
  if ((capacity.norms ?? []).some((n) => str(n.finishedProductId) === finishedProductId && str(n.lineId) === lineId && str(n.stage) === stage && Number(n.version) === version)) {
    return fail('duplicate_norm_version', 409)
  }
  const draft = {
    normId,
    finishedProductId,
    lineId,
    stage,
    version,
    status: 'draft',
    capacityM2PerShift,
    expectedRollsPerShift,
    shiftDurationMinutes,
    effectiveFrom,
    effectiveTo,
    createdAt: now,
    createdBy: actor.uid,
    unit: 'm2',
  }
  draft.contentHash = contentHash({
    finishedProductId,
    lineId,
    stage,
    version,
    capacityM2PerShift,
    expectedRollsPerShift,
    shiftDurationMinutes,
    effectiveFrom,
    effectiveTo,
  })
  return ok({
    capacity: appendAudit({ ...capacity, norms: [...(capacity.norms ?? []), draft] }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.norm.draft.save',
      actorUid: actor.uid,
      detail: `${normId}@${version}`,
    }),
    result: { normId, version, status: 'draft' },
  })
}

function applyNormDraftDelete(capacity, command, actor, now) {
  const normId = str(command.normId)
  const version = num(command.version)
  const idx = (capacity.norms ?? []).findIndex(
    (n) => str(n.normId) === normId && Number(n.version) === version && n.status === 'draft',
  )
  if (idx < 0) return fail('draft_not_found', 404)
  const norms = (capacity.norms ?? []).filter((_, i) => i !== idx)
  return ok({
    capacity: appendAudit({ ...capacity, norms }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.norm.draft.delete',
      actorUid: actor.uid,
      detail: `${normId}@${version}`,
    }),
    result: { normId, version, deleted: true },
  })
}

function applyNormApprove(capacity, command, actor, now) {
  const normId = str(command.normId)
  const version = num(command.version)
  const draft = (capacity.norms ?? []).find(
    (n) => str(n.normId) === normId && Number(n.version) === version && n.status === 'draft',
  )
  if (!draft) return fail('draft_not_found', 404)
  const approved = {
    ...draft,
    status: 'approved',
    approvedAt: now,
    approvedBy: actor.uid,
  }
  // approved immutable thereafter
  const norms = (capacity.norms ?? []).map((n) =>
    n.normId === draft.normId && n.version === draft.version ? approved : n,
  )
  return ok({
    capacity: appendAudit({ ...capacity, norms }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.norm.approve',
      actorUid: actor.uid,
      detail: `${normId}@${version}`,
    }),
    result: { normId, version, status: 'approved' },
  })
}

function applyNormRetire(capacity, command, actor, now) {
  const normId = str(command.normId)
  const version = num(command.version)
  const row = (capacity.norms ?? []).find(
    (n) => str(n.normId) === normId && Number(n.version) === version && n.status === 'approved',
  )
  if (!row) return fail('approved_norm_not_found', 404)
  const retired = { ...row, status: 'retired', retiredAt: now, retiredBy: actor.uid }
  const norms = (capacity.norms ?? []).map((n) =>
    n.normId === row.normId && n.version === row.version ? retired : n,
  )
  return ok({
    capacity: appendAudit({ ...capacity, norms }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.norm.retire',
      actorUid: actor.uid,
      detail: `${normId}@${version}`,
    }),
    result: { normId, version, status: 'retired' },
  })
}

function applyCalendarUpsert(capacity, command, actor, now) {
  const lineId = str(command.lineId)
  const date = str(command.date)
  const shiftId = str(command.shiftId || 'day')
  if (!isKnownLineId(lineId)) return fail('invalid_line_id')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('invalid_date')
  const status = str(command.status || 'available')
  if (!CAL_STATUSES.has(status)) return fail('invalid_calendar_status')
  const plannedMinutes = num(command.plannedMinutes) || 480
  const capacityFactor =
    command.capacityFactor == null ? undefined : Math.max(0, Math.min(1, num(command.capacityFactor)))
  const entry = {
    id: str(command.id) || `cal-${lineId}-${date}-${shiftId}`,
    lineId,
    date,
    shiftId,
    start: command.start,
    end: command.end,
    plannedMinutes,
    status,
    capacityFactor,
    reason: str(command.reason || ''),
    approvedBy: actor.uid,
    updatedAt: now,
  }
  const calendars = [...(capacity.calendars ?? [])]
  const idx = calendars.findIndex(
    (c) => str(c.lineId) === lineId && str(c.date) === date && str(c.shiftId || 'day') === shiftId,
  )
  if (idx >= 0) calendars[idx] = { ...calendars[idx], ...entry }
  else calendars.push(entry)
  return ok({
    capacity: appendAudit({ ...capacity, calendars }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.calendar.upsert',
      actorUid: actor.uid,
      detail: entry.id,
    }),
    result: { calendarId: entry.id },
  })
}

function applyDowntimeRecord(capacity, command, actor, now) {
  const lineId = str(command.lineId)
  const date = str(command.date)
  if (!isKnownLineId(lineId)) return fail('invalid_line_id')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('invalid_date')
  const minutes = num(command.minutes)
  const fullShift = command.fullShift === true
  if (!fullShift && (!Number.isFinite(minutes) || minutes <= 0)) return fail('invalid_downtime_minutes')
  const id = str(command.downtimeId) || `dt-${crypto.randomUUID()}`
  const row = {
    id,
    lineId,
    date,
    shiftId: str(command.shiftId || 'day'),
    minutes: fullShift ? undefined : minutes,
    fullShift,
    reason: str(command.reason || ''),
    status: 'active',
    recordedAt: now,
    recordedBy: actor.uid,
  }
  return ok({
    capacity: appendAudit({ ...capacity, downtimes: [...(capacity.downtimes ?? []), row] }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.downtime.record',
      actorUid: actor.uid,
      detail: id,
    }),
    result: { downtimeId: id },
  })
}

function applyDowntimeCancel(capacity, command, actor, now) {
  const id = str(command.downtimeId)
  const row = (capacity.downtimes ?? []).find((d) => str(d.id) === id)
  if (!row) return fail('downtime_not_found', 404)
  if (row.status === 'cancelled') {
    return ok({ capacity, result: { downtimeId: id, cancelled: true, idempotent: true } })
  }
  const downtimes = (capacity.downtimes ?? []).map((d) =>
    str(d.id) === id ? { ...d, status: 'cancelled', cancelledAt: now, cancelledBy: actor.uid } : d,
  )
  return ok({
    capacity: appendAudit({ ...capacity, downtimes }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.downtime.cancel',
      actorUid: actor.uid,
      detail: id,
    }),
    result: { downtimeId: id, cancelled: true },
  })
}

function applyCalendarTemplateUpsert(capacity, command, actor, now) {
  const lineId = str(command.lineId)
  const weekday = num(command.weekday)
  const shiftId = str(command.shiftId || 'day')
  const stage = str(command.stage || '*')
  const convention = str(command.weekdayConvention || WEEKDAY_CONVENTION_ISO)
  if (!isKnownLineId(lineId)) return fail('invalid_line_id')
  if (convention !== WEEKDAY_CONVENTION_ISO) {
    return fail('weekday_convention_must_be_ISO_8601', 400, {
      hint: 'use_capacity.legacy.scan_for_JS_SUNDAY_0',
    })
  }
  // Reject 0 and anything outside 1–7 — values 1–6 are unambiguous only with ISO convention
  if (!isIsoWeekday(weekday)) {
    return fail('invalid_weekday', 400, {
      weekdayConvention: WEEKDAY_CONVENTION_ISO,
      allowed: '1..7 (Mon..Sun)',
      rejected: weekday,
    })
  }
  if (stage !== '*' && !STAGES.has(stage)) return fail('invalid_stage')
  const plannedMinutes = num(command.plannedMinutes) || 480
  const capacityFactor =
    command.capacityFactor == null ? 1 : Math.max(0, Math.min(1, num(command.capacityFactor)))
  const id = str(command.templateId || command.id) || `ctpl-${crypto.randomUUID()}`
  const entry = {
    id,
    templateId: id,
    lineId,
    weekday,
    weekdayConvention: WEEKDAY_CONVENTION_ISO,
    shiftId,
    stage,
    plannedMinutes,
    capacityFactor,
    effectiveFrom: str(command.effectiveFrom || '0000-01-01'),
    effectiveTo: str(command.effectiveTo || '9999-12-31'),
    updatedAt: now,
    updatedBy: actor.uid,
  }
  const list = [...(capacity.calendarTemplates ?? [])]
  const idx = list.findIndex((t) => str(t.id || t.templateId) === id)
  if (idx >= 0) list[idx] = { ...list[idx], ...entry }
  else list.push(entry)
  return ok({
    capacity: appendAudit({ ...capacity, calendarTemplates: list }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.calendarTemplate.upsert',
      actorUid: actor.uid,
      detail: id,
    }),
    result: { templateId: id, weekday, weekdayConvention: WEEKDAY_CONVENTION_ISO },
  })
}

function applyCalendarTemplateDelete(capacity, command, actor, now) {
  const id = str(command.templateId || command.id)
  const before = capacity.calendarTemplates ?? []
  if (!before.some((t) => str(t.id || t.templateId) === id)) return fail('template_not_found', 404)
  const calendarTemplates = before.filter((t) => str(t.id || t.templateId) !== id)
  return ok({
    capacity: appendAudit({ ...capacity, calendarTemplates }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.calendarTemplate.delete',
      actorUid: actor.uid,
      detail: id,
    }),
    result: { templateId: id, deleted: true },
  })
}

function applyRun(payload, capacity, command, actor, now, criticalRevision) {
  const asOfYmd = str(command.asOfDate || tbilisiDate(now))
  const body = allocateHorizon(payload, capacity, asOfYmd, now)
  body.inputCriticalRevision = criticalRevision
  const capacityRunId = str(command.capacityRunId) || `crun-${crypto.randomUUID()}`
  const run = {
    capacityRunId,
    ...body,
    contentHash: contentHash({
      asOfYmd,
      inputCriticalRevision: criticalRevision,
      firmAllocations: body.firmAllocations,
      tentativeAllocations: body.tentativeAllocations,
      normSnapshots: body.normSnapshots,
    }),
    stale: false,
    createdAt: now,
    createdBy: actor.uid,
  }
  const runs = (capacity.runs ?? []).map((r) => ({ ...r, stale: true }))
  runs.push(run)

  const scheduleId = `csch-${capacityRunId}`
  const schedule = {
    scheduleId,
    capacityRunId,
    status: 'draft',
    allocations: [...body.firmAllocations, ...body.tentativeAllocations],
    overloadQuantity: body.overloadQuantity,
    createdAt: now,
    createdBy: actor.uid,
    contentHash: contentHash({ capacityRunId, allocations: body.firmAllocations }),
  }
  const schedules = [...(capacity.schedules ?? []).filter((s) => s.status === 'published'), schedule]

  // Append capacity master-data errors into planning error queue (authoritative MD fix path)
  const planning = payload.domains.planning ?? {}
  const prevErrs = Array.isArray(planning.masterDataErrors) ? planning.masterDataErrors : []
  const nextErrs = [
    ...prevErrs.filter((e) => e.domain !== 'capacity' || e.capacityRunId === capacityRunId),
    ...(body.masterDataErrors ?? []).map((e) => ({ ...e, capacityRunId })),
  ]

  return ok({
    capacity: appendAudit({ ...capacity, runs, schedules }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.run',
      actorUid: actor.uid,
      detail: capacityRunId,
    }),
    planning: { ...planning, masterDataErrors: nextErrs },
    result: {
      capacityRunId,
      scheduleId,
      overloadQuantity: body.overloadQuantity,
      firstCapacityShortageDate: body.firstCapacityShortageDate,
      contentHash: run.contentHash,
      loadPercentage: body.loadPercentage,
      freeCapacity: body.freeCapacity,
      lateOrders: body.lateOrders,
      materialBlockedOrders: body.materialBlockedOrders,
      wipBlockedOrders: body.wipBlockedOrders,
      errors: body.errors,
      masterDataErrors: body.masterDataErrors,
      detailedBucketCount: body.detailedBuckets.length,
      monthlyBucketCount: body.monthlyBuckets.length,
    },
  })
}

function findDraftSchedule(capacity, scheduleId) {
  return (capacity.schedules ?? []).find((s) => str(s.scheduleId) === str(scheduleId) && s.status === 'draft')
}

function applyScheduleMove(capacity, command, actor, now, payload) {
  const scheduleId = str(command.scheduleId)
  const allocationId = str(command.allocationId)
  const schedule = findDraftSchedule(capacity, scheduleId)
  if (!schedule) return fail('draft_schedule_not_found', 404)
  const alloc = (schedule.allocations ?? []).find((a) => str(a.allocationId) === allocationId)
  if (!alloc) return fail('allocation_not_found', 404)
  if (alloc.closedShift === true) return fail('closed_shift_immutable', 409)

  const newLineId = str(command.lineId || alloc.lineId)
  const newDate = str(command.date || alloc.date || '')
  const newShiftId = str(command.shiftId || alloc.shiftId || 'day')
  if (!isKnownLineId(newLineId)) return fail('invalid_line_id')
  const product = findProduct(payload.domains.masterData, alloc.finishedProductId)
  const valid = productValidLines(product, alloc.stage || 'production')
  if (!valid.ok || !valid.lines.includes(newLineId)) return fail('line_product_incompatible', 400)

  const nextAlloc = {
    ...alloc,
    lineId: newLineId,
    date: newDate || alloc.date,
    shiftId: newShiftId,
    month: alloc.aggregated ? alloc.month : undefined,
    movedAt: now,
    movedBy: actor.uid,
  }
  const allocations = schedule.allocations.map((a) =>
    str(a.allocationId) === allocationId ? nextAlloc : a,
  )
  const schedules = (capacity.schedules ?? []).map((s) =>
    s.scheduleId === schedule.scheduleId
      ? { ...s, allocations, updatedAt: now, updatedBy: actor.uid }
      : s,
  )
  return ok({
    capacity: appendAudit({ ...capacity, schedules }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.schedule.move',
      actorUid: actor.uid,
      detail: allocationId,
    }),
    result: { scheduleId, allocationId, lineId: newLineId, date: nextAlloc.date },
  })
}

function applyScheduleSplit(capacity, command, actor, now, payload) {
  const scheduleId = str(command.scheduleId)
  const allocationId = str(command.allocationId)
  const schedule = findDraftSchedule(capacity, scheduleId)
  if (!schedule) return fail('draft_schedule_not_found', 404)
  const alloc = (schedule.allocations ?? []).find((a) => str(a.allocationId) === allocationId)
  if (!alloc) return fail('allocation_not_found', 404)
  if (alloc.closedShift === true) return fail('closed_shift_immutable', 409)

  const parts = Array.isArray(command.parts) ? command.parts : []
  if (parts.length < 2) return fail('split_requires_parts')
  let sum = 0
  const built = []
  for (const p of parts) {
    const qty = num(p.quantityM2)
    if (!Number.isFinite(qty) || qty <= EPS) return fail('invalid_split_qty')
    const lineId = str(p.lineId || alloc.lineId)
    if (!isKnownLineId(lineId)) return fail('invalid_line_id')
    const product = findProduct(payload.domains.masterData, alloc.finishedProductId)
    const valid = productValidLines(product, alloc.stage || 'production')
    if (!valid.ok || !valid.lines.includes(lineId)) return fail('line_product_incompatible')
    sum = roundQty(sum + qty)
    built.push({
      ...alloc,
      allocationId: `ca-split-${crypto.randomUUID()}`,
      lineId,
      date: str(p.date || alloc.date || ''),
      shiftId: str(p.shiftId || alloc.shiftId || 'day'),
      month: p.month || alloc.month,
      quantityM2: qty,
      splitFrom: allocationId,
    })
  }
  if (Math.abs(sum - Number(alloc.quantityM2)) > 1e-6) return fail('split_sum_mismatch', 400)

  const allocations = [
    ...(schedule.allocations ?? []).filter((a) => str(a.allocationId) !== allocationId),
    ...built,
  ]
  // duplicate allocation protection: same source+stage+date+shift+line
  const seen = new Set()
  for (const a of allocations) {
    if (a.overload) continue
    const k = `${a.sourceId}|${a.stage}|${a.lineId}|${a.date || a.month}|${a.shiftId || ''}`
    if (seen.has(k)) return fail('duplicate_allocation', 409)
    seen.add(k)
  }

  const schedules = (capacity.schedules ?? []).map((s) =>
    s.scheduleId === schedule.scheduleId
      ? { ...s, allocations, updatedAt: now, updatedBy: actor.uid }
      : s,
  )
  return ok({
    capacity: appendAudit({ ...capacity, schedules }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.schedule.split',
      actorUid: actor.uid,
      detail: allocationId,
    }),
    result: { scheduleId, parts: built.map((b) => b.allocationId) },
  })
}

function applySchedulePublish(capacity, command, actor, now) {
  const scheduleId = str(command.scheduleId)
  const schedule = findDraftSchedule(capacity, scheduleId)
  if (!schedule) return fail('draft_schedule_not_found', 404)
  const overload = Number(schedule.overloadQuantity) || 0
  const hasOverloadAlloc = (schedule.allocations ?? []).some((a) => a.overload === true)
  if ((overload > EPS || hasOverloadAlloc) && schedule.overloadApproved !== true) {
    return fail('overload_blocks_publish', 403)
  }
  const published = {
    ...schedule,
    status: 'published',
    publishedAt: now,
    publishedBy: actor.uid,
  }
  const schedules = (capacity.schedules ?? []).map((s) =>
    s.scheduleId === schedule.scheduleId ? published : s.status === 'published' ? { ...s, status: 'superseded' } : s,
  )
  return ok({
    capacity: appendAudit({ ...capacity, schedules }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.schedule.publish',
      actorUid: actor.uid,
      detail: scheduleId,
    }),
    result: { scheduleId, status: 'published' },
  })
}

function applyOverloadApprove(capacity, command, actor, now) {
  const scheduleId = str(command.scheduleId)
  const reason = str(command.reason)
  if (!reason) return fail('overload_reason_required', 400)
  if (isAdminEmail(actor) && !reason) return fail('emergency_reason_required', 400)
  const schedule = findDraftSchedule(capacity, scheduleId)
  if (!schedule) return fail('draft_schedule_not_found', 404)
  const next = {
    ...schedule,
    overloadApproved: true,
    overloadApprovedAt: now,
    overloadApprovedBy: actor.uid,
    overloadReason: reason,
  }
  const schedules = (capacity.schedules ?? []).map((s) =>
    s.scheduleId === schedule.scheduleId ? next : s,
  )
  return ok({
    capacity: appendAudit({ ...capacity, schedules }, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'capacity.overload.approve',
      actorUid: actor.uid,
      detail: `${scheduleId}:${reason}`,
    }),
    result: { scheduleId, overloadApproved: true },
  })
}

function applyLegacyScan(payload, capacity) {
  const production = payload.domains.production ?? {}
  const masterData = payload.domains.masterData ?? {}
  const dayPlans = Array.isArray(production.dayPlans) ? production.dayPlans : []
  const lineSchedules = Array.isArray(production.lineSchedules) ? production.lineSchedules : []
  const planner = payload.domains.planning?.legacyDayPlans
  const queue = []
  const errors = []
  const weekdayMigrations = []
  const productLineMigrations = []

  for (const t of capacity.calendarTemplates ?? []) {
    const conv = templateWeekdayConvention(t)
    const wd = Number(t.weekday)
    const id = str(t.id || t.templateId)
    if (conv === WEEKDAY_CONVENTION_JS || (conv === '' && wd === 0)) {
      const iso = jsWeekdayToIso(wd === 0 ? 0 : wd)
      weekdayMigrations.push({
        kind: 'weekday_migrate',
        templateId: id,
        legacyConvention: WEEKDAY_CONVENTION_JS,
        legacyWeekday: wd,
        previewIsoWeekday: iso,
        previewConvention: WEEKDAY_CONVENTION_ISO,
        note: 'Sunday 0 → ISO 7; apply via capacity.legacy.apply',
      })
    } else if (conv === '' && isIsoWeekday(wd)) {
      // Ambiguous 1–6 without convention — fail closed for authoritative; preview requires explicit ISO apply
      weekdayMigrations.push({
        kind: 'weekday_convention_missing',
        templateId: id,
        legacyWeekday: wd,
        previewIsoWeekday: wd,
        previewConvention: WEEKDAY_CONVENTION_ISO,
        note: 'ambiguous_without_convention; apply sets ISO_8601 explicitly',
      })
    } else if (conv && conv !== WEEKDAY_CONVENTION_ISO && conv !== WEEKDAY_CONVENTION_JS) {
      errors.push({ code: 'mixed_or_unknown_weekday_convention', templateId: id, convention: conv })
    } else if (conv === WEEKDAY_CONVENTION_ISO && !isIsoWeekday(wd)) {
      errors.push({ code: 'invalid_iso_weekday', templateId: id, weekday: wd })
    }
  }

  // Detect mixed conventions in one store
  const conventions = new Set(
    (capacity.calendarTemplates ?? [])
      .map((t) => templateWeekdayConvention(t) || (Number(t.weekday) === 0 ? WEEKDAY_CONVENTION_JS : ''))
      .filter(Boolean),
  )
  if (conventions.has(WEEKDAY_CONVENTION_ISO) && conventions.has(WEEKDAY_CONVENTION_JS)) {
    errors.push({ code: 'mixed_weekday_convention', conventions: [...conventions] })
  }

  for (const p of masterData.finishedProducts ?? []) {
    const preview = previewLegacyProductLineMapping(p)
    if (preview.needed && (preview.fromLegacyValidLineIds?.length || !p.validProductionLineIds || !p.validPackagingLineIds)) {
      productLineMigrations.push({
        kind: 'product_line_mapping',
        finishedProductId: str(p.id),
        ...preview,
      })
    }
  }

  for (const dp of dayPlans) {
    const productId = str(dp.finishedProductId || dp.productId)
    const lineId = str(dp.lineId)
    if (!productId || !isKnownLineId(lineId)) {
      errors.push({ code: 'ambiguous_mapping', ref: dp.id || dp.date, reason: 'missing_stable_ids' })
      continue
    }
    queue.push({ kind: 'dayPlan', id: dp.id, finishedProductId: productId, lineId, date: dp.date })
  }
  for (const ls of lineSchedules) {
    const lineId = str(ls.lineId)
    if (!isKnownLineId(lineId)) {
      errors.push({ code: 'ambiguous_mapping', ref: ls.id, reason: 'invalid_line' })
      continue
    }
    queue.push({ kind: 'lineSchedule', id: ls.id, lineId, date: ls.date })
  }
  if (Array.isArray(planner)) {
    for (const p of planner) {
      if (!str(p.finishedProductId) || !isKnownLineId(p.lineId)) {
        errors.push({ code: 'ambiguous_mapping', ref: p.id, reason: 'name_or_missing_id' })
      }
    }
  }
  return ok({
    capacity,
    result: {
      dryRun: true,
      authoritative: false,
      weekdayConventionAuthoritative: WEEKDAY_CONVENTION_ISO,
      candidates: queue,
      weekdayMigrations,
      productLineMigrations,
      errorQueue: errors,
      message: 'legacy_not_authoritative',
    },
  })
}

function applyLegacyApply(capacity, command, actor, now, payload) {
  const reason = str(command.reason)
  if (!reason) return fail('legacy_apply_reason_required', 400)
  const items = Array.isArray(command.items) ? command.items : []
  let next = capacity
  let masterData = payload?.domains?.masterData ? { ...payload.domains.masterData } : null
  let products = masterData ? [...(masterData.finishedProducts ?? [])] : null

  for (const it of items) {
    const kind = str(it.kind)

    if (kind === 'weekday_migrate' || kind === 'weekday_convention_missing') {
      const id = str(it.templateId)
      const iso = it.previewIsoWeekday != null ? num(it.previewIsoWeekday) : jsWeekdayToIso(it.legacyWeekday)
      if (!id || !isIsoWeekday(iso)) return fail('legacy_weekday_migrate_invalid', 400)
      const list = [...(next.calendarTemplates ?? [])]
      const idx = list.findIndex((t) => str(t.id || t.templateId) === id)
      if (idx < 0) return fail('template_not_found', 404)
      list[idx] = {
        ...list[idx],
        weekday: iso,
        weekdayConvention: WEEKDAY_CONVENTION_ISO,
        migratedAt: now,
        migratedBy: actor.uid,
        migrationReason: reason,
      }
      next = { ...next, calendarTemplates: list }
      continue
    }

    if (kind === 'product_line_mapping') {
      if (!products) return fail('masterdata_unavailable', 400)
      const fpId = str(it.finishedProductId)
      const prodIds = Array.isArray(it.validProductionLineIds)
        ? it.validProductionLineIds.map(str).filter(isKnownLineId)
        : []
      const packIds = Array.isArray(it.validPackagingLineIds)
        ? it.validPackagingLineIds.map(str).filter(isKnownLineId)
        : []
      if (!fpId) return fail('legacy_apply_fail_closed', 400)
      // Explicit lists required — never invent pack
      if (!prodIds.length && !packIds.length) return fail('legacy_apply_fail_closed', 400)
      const idx = products.findIndex((p) => str(p.id) === fpId)
      if (idx < 0) return fail('product_not_found', 404)
      products[idx] = {
        ...products[idx],
        ...(prodIds.length ? { validProductionLineIds: prodIds } : {}),
        ...(packIds.length ? { validPackagingLineIds: packIds } : {}),
        lineMappingMigratedAt: now,
        lineMappingMigratedBy: actor.uid,
        lineMappingMigrationReason: reason,
      }
      continue
    }

    if (kind === 'calendar' || it.date) {
      if (!str(it.finishedProductId) || !isKnownLineId(it.lineId)) {
        return fail('legacy_apply_fail_closed', 400)
      }
      const upserted = applyCalendarUpsert(
        next,
        {
          lineId: it.lineId,
          date: it.date,
          shiftId: it.shiftId || 'day',
          status: it.status || 'available',
          plannedMinutes: it.plannedMinutes || 480,
          reason: `legacy:${reason}`,
        },
        actor,
        now,
      )
      if (!upserted.ok) return upserted
      next = upserted.capacity
      continue
    }

    return fail('legacy_apply_unknown_item_kind', 400, { kind })
  }

  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'capacity.legacy.apply',
    actorUid: actor.uid,
    detail: reason,
  })

  const out = { capacity: next, result: { applied: items.length, reason } }
  if (products && masterData) {
    out.masterData = { ...masterData, finishedProducts: products }
  }
  return ok(out)
}

function markRunsStaleIfNeeded(capacity, criticalRevision) {
  const runs = (capacity.runs ?? []).map((r) => {
    if (r.stale) return r
    if (Number(r.inputCriticalRevision) !== Number(criticalRevision)) {
      return { ...r, stale: true, staleReason: 'critical_revision' }
    }
    return r
  })
  return { ...capacity, runs }
}

/**
 * Apply a pure capacity mutation (no I/O). Exported for unit tests.
 */
export function applyG6CommandLocal(payload, commandType, command, actor, now = new Date().toISOString(), criticalRevision = 0) {
  let capacity = ensureCapacity(payload.domains)
  capacity = markRunsStaleIfNeeded(capacity, criticalRevision)

  switch (commandType) {
    case 'capacity.domain.activate':
      return applyActivate(capacity, command, actor, now)
    case 'capacity.norm.draft.save':
      return applyNormDraftSave(capacity, command, actor, now)
    case 'capacity.norm.draft.delete':
      return applyNormDraftDelete(capacity, command, actor, now)
    case 'capacity.norm.approve':
      return applyNormApprove(capacity, command, actor, now)
    case 'capacity.norm.retire':
      return applyNormRetire(capacity, command, actor, now)
    case 'capacity.calendar.upsert':
      return applyCalendarUpsert(capacity, command, actor, now)
    case 'capacity.calendarTemplate.upsert':
      return applyCalendarTemplateUpsert(capacity, command, actor, now)
    case 'capacity.calendarTemplate.delete':
      return applyCalendarTemplateDelete(capacity, command, actor, now)
    case 'capacity.downtime.record':
      return applyDowntimeRecord(capacity, command, actor, now)
    case 'capacity.downtime.cancel':
      return applyDowntimeCancel(capacity, command, actor, now)
    case 'capacity.run':
      return applyRun(payload, capacity, command ?? {}, actor, now, criticalRevision)
    case 'capacity.schedule.move':
      return applyScheduleMove(capacity, command, actor, now, payload)
    case 'capacity.schedule.split':
      return applyScheduleSplit(capacity, command, actor, now, payload)
    case 'capacity.schedule.publish':
      return applySchedulePublish(capacity, command, actor, now)
    case 'capacity.overload.approve':
      return applyOverloadApprove(capacity, command, actor, now)
    case 'capacity.legacy.scan':
      return applyLegacyScan(payload, capacity)
    case 'capacity.legacy.apply':
      return applyLegacyApply(capacity, command, actor, now, payload)
    default:
      return fail('unknown_command', 400)
  }
}

export async function executeG6Command(input) {
  const {
    actor,
    storeId: rawStoreId,
    idempotencyKey: rawKey,
    commandType,
    command = {},
    payloadJson,
    warehousePatch,
    fullStore,
    roleId,
  } = input ?? {}

  if (payloadJson != null || warehousePatch != null || fullStore != null) {
    return fail('forged_client_payload_rejected', 400)
  }
  if (roleId != null) {
    return fail('client_role_not_proof', 403)
  }

  const storeId = str(rawStoreId) || 'default'
  const idempotencyKey = str(rawKey)
  if (!commandType || !CAP_BY_COMMAND[commandType]) {
    return fail('unknown_command', 400)
  }
  if (!idempotencyKey) return fail('idempotency_key_required', 400)

  const dc = await getG1DataConnect()

  // Idempotent replay
  const { data: receiptData } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const existingReceipt = receiptData?.fstCommandReceipt
  if (existingReceipt?.resultJson && existingReceipt.storeId === storeId) {
    try {
      const prev = JSON.parse(existingReceipt.resultJson)
      return ok({ ...prev, idempotent: true })
    } catch {
      /* continue */
    }
  }
  // Also check embedded receipts
  const critical0 = await loadCritical(dc, storeId)
  const embedded = critical0.payload.commandReceipts?.[idempotencyKey]
  if (embedded?.result) {
    return ok({ ...embedded.result, idempotent: true, recoveredFromEmbeddedReceipt: true })
  }

  const access = await resolveActorAccess(dc, actor, storeId)
  if (!access.ok) return access

  const needed = CAP_BY_COMMAND[commandType]
  const hasCap = access.caps[needed] === true
  const adminEmergency =
    isAdminEmail(actor) &&
    (commandType === 'capacity.domain.activate' || commandType === 'capacity.overload.approve') &&
    str(command.reason)
  if (!hasCap && !adminEmergency) {
    return fail('capability_denied', 403, { capability: needed })
  }

  // Line scope for masters
  const lineId = str(command.lineId)
  if (lineId && !assertLineScope(access.caps, lineId)) {
    return fail('line_scope_denied', 403)
  }

  if (commandType !== 'capacity.domain.activate' && commandType !== 'capacity.legacy.scan') {
    const inactive = requireActive(critical0.payload)
    if (inactive) return inactive
  }

  // PHASE R1 — frozen capacityPlanning blocks writes; legacy.scan remains readable
  if (
    commandType !== 'capacity.legacy.scan' &&
    isDomainFrozen(critical0.payload, 'capacityPlanning')
  ) {
    return fail('domain_frozen', 409)
  }

  const now = new Date().toISOString()
  const applied = applyG6CommandLocal(
    critical0.payload,
    commandType,
    command,
    actor,
    now,
    critical0.revision,
  )
  if (!applied.ok) return applied

  const committed = await casCommitG6(dc, storeId, critical0, actor.uid, {
    capacity: applied.capacity,
    production: applied.production,
    planning: applied.planning,
    masterData: applied.masterData,
    idempotencyKey,
    commandType,
    result: applied.result,
    activateCapacity: applied.activateCapacity === true,
  })
  if (!committed.ok) return committed

  const response = {
    ...applied.result,
    criticalRevision: committed.criticalRevision,
    capacityPlanningActive: committed.capacityPlanningActive,
    capacityHash: committed.capacityHash,
    domainMeta: committed.payload.domainMeta,
    capacity: committed.capacity,
  }

  try {
    await insertFstCommandReceipt(dc, {
      id: idempotencyKey,
      storeId,
      commandType,
      actorUid: actor.uid,
      resultJson: JSON.stringify(response),
      criticalRevisionAfter: committed.criticalRevision,
    })
  } catch {
    // receipt insert races are ok — embedded receipt already CAS'd
  }

  return ok(response)
}

export {
  allocateHorizon,
  collectLoadSources,
  selectApprovedNorm,
  calendarFactor,
  productValidLines,
  monthPeriodBounds,
  WEEKDAY_CONVENTION_ISO,
  WEEKDAY_CONVENTION_JS,
  KNOWN_LINE_IDS,
  CAP_BY_COMMAND,
  casCommitG6,
}
