/**
 * Smoke-check for mergeDayCell wipe guards (mirrors cloudMerge.ts logic).
 * Run: node scripts/verify-merge-day-cell.mjs
 */
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
function pick3(base, remote, local) {
  if (!eq(local, base)) return local
  if (!eq(remote, base)) return remote
  return local
}
function safeIso(v) {
  return typeof v === 'string' ? v : ''
}
const AUDIT_EMPTY_CELL = '·'
function isAuditEmptyMarker(value) {
  return value == null || value === '' || value === AUDIT_EMPTY_CELL
}
function latestAuditForCell(audit, rowId, dateKey, value) {
  const wantEmpty = isAuditEmptyMarker(value)
  let best
  for (const e of audit) {
    if (e.rowId !== rowId || e.dateKey !== dateKey) continue
    const hit = wantEmpty
      ? isAuditEmptyMarker(e.newValue)
      : e.newValue === value || (typeof e.detail === 'string' && e.detail.includes(value))
    if (!hit) continue
    if (!best || safeIso(e.at) >= safeIso(best.at)) best = e
  }
  return best
}
function latestAnyAuditForCell(audit, rowId, dateKey) {
  let best
  for (const e of audit) {
    if (e.rowId !== rowId || e.dateKey !== dateKey) continue
    if (!best || safeIso(e.at) >= safeIso(best.at)) best = e
  }
  return best
}
function hasRecentClearAudit(audit, rowId, dateKey) {
  const latest = latestAnyAuditForCell(audit, rowId, dateKey)
  return latest != null && isAuditEmptyMarker(latest.newValue)
}
function isEmptyDayCode(value) {
  return value == null || value === ''
}
function healDayCellFromAudit(result, rowId, dateKey, audit) {
  const latest = latestAnyAuditForCell(audit, rowId, dateKey)
  if (!latest) return result
  if (isAuditEmptyMarker(latest.newValue)) return result
  const fromJournal = String(latest.newValue ?? '').trim()
  if (!fromJournal) return result
  if (isEmptyDayCode(result)) return fromJournal
  return result
}
function mergeDayCell(base, remote, local, rowId, dateKey, audit) {
  const b = base ?? ''
  const r = remote ?? ''
  const l = local ?? ''
  const localChanged = l !== b
  const remoteChanged = r !== b
  let picked
  if (localChanged && remoteChanged && l !== r) {
    const localAudit = latestAuditForCell(audit, rowId, dateKey, l)
    const remoteAudit = latestAuditForCell(audit, rowId, dateKey, r)
    if (localAudit && remoteAudit) {
      picked = safeIso(localAudit.at) >= safeIso(remoteAudit.at) ? l : r
    } else if (remoteAudit && !localAudit) picked = r
    else if (localAudit && !remoteAudit) picked = l
    else if (isEmptyDayCode(l) && !isEmptyDayCode(r)) picked = r
    else if (isEmptyDayCode(r) && !isEmptyDayCode(l)) picked = l
    else picked = l
  } else if (!isEmptyDayCode(b) && isEmptyDayCode(l) && isEmptyDayCode(r) && (localChanged || remoteChanged)) {
    picked = !hasRecentClearAudit(audit, rowId, dateKey) ? b : pick3(b, r, l)
  } else if (localChanged && !remoteChanged && isEmptyDayCode(l) && !isEmptyDayCode(b)) {
    picked = !hasRecentClearAudit(audit, rowId, dateKey) ? r || b : pick3(b, r, l)
  } else if (remoteChanged && !localChanged && isEmptyDayCode(r) && !isEmptyDayCode(b)) {
    picked = !hasRecentClearAudit(audit, rowId, dateKey) ? l || b : pick3(b, r, l)
  } else {
    picked = pick3(b, r, l)
  }
  return healDayCellFromAudit(picked, rowId, dateKey, audit)
}

/** OLD buggy clear lookup: detail.includes('') always matches. */
function oldClearAuditFindsAny(audit, rowId, dateKey) {
  return audit.find(
    (e) =>
      e.rowId === rowId &&
      e.dateKey === dateKey &&
      (e.newValue === '' || e.detail.includes('')),
  )
}

const rowId = 'row1'
const dateKey = '2026-08-09'
const fillAudit = {
  id: '1',
  rowId,
  dateKey,
  newValue: '8',
  detail: 'Иван · 2026-08-09: · → 8',
  at: '2026-08-09T10:00:00.000Z',
}
const clearAudit = {
  id: '2',
  rowId,
  dateKey,
  newValue: '·',
  detail: 'Иван · 2026-08-09: 8 → ·',
  at: '2026-08-09T12:00:00.000Z',
}

const cases = [
  {
    name: 'both empty vs base filled, only fill audit → keep base',
    got: mergeDayCell('8', '', '', rowId, dateKey, [fillAudit]),
    want: '8',
  },
  {
    name: 'both empty vs base filled, no audit → keep base',
    got: mergeDayCell('8', '', '', rowId, dateKey, []),
    want: '8',
  },
  {
    name: 'both empty after recent clear → allow wipe',
    got: mergeDayCell('8', '', '', rowId, dateKey, [clearAudit, fillAudit]),
    want: '',
  },
  {
    name: 'local wipe, remote unchanged, fill audit → keep remote',
    got: mergeDayCell('8', '8', '', rowId, dateKey, [fillAudit]),
    want: '8',
  },
  {
    name: 'remote wipe, local unchanged, fill audit → keep local',
    got: mergeDayCell('8', '', '8', rowId, dateKey, [fillAudit]),
    want: '8',
  },
  {
    name: 'intentional clear (latest ·) local wipe → allow',
    got: mergeDayCell('8', '8', '', rowId, dateKey, [clearAudit, fillAudit]),
    want: '',
  },
  {
    name: 'already wiped (all empty) but journal fill remains → heal from audit',
    got: mergeDayCell('', '', '', rowId, dateKey, [fillAudit]),
    want: '8',
  },
]

let failed = 0
for (const c of cases) {
  const ok = c.got === c.want
  console.log(`${ok ? 'OK' : 'FAIL'} ${c.name}: got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`)
  if (!ok) failed += 1
}

const bogus = oldClearAuditFindsAny([fillAudit], rowId, dateKey)
console.log(
  bogus
    ? 'OK demonstrated old bug: includes(\"\") matched fill audit as clear'
    : 'FAIL expected old bug demo',
)
if (!bogus) failed += 1

process.exit(failed ? 1 : 0)
