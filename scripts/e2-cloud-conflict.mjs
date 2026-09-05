/**
 * E2 acceptance: two sessions edit same warehouse movement → conflict detected.
 * Run: npm run test:cloud-conflict
 *
 * Mirrors mergeCloudStores / mergeArrayById / mergeStringSet logic in cloudMerge.ts
 * (must stay in sync).
 */

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pick3WithConflict(base, remote, local, onConflict) {
  const localChanged = !eq(local, base)
  const remoteChanged = !eq(remote, base)
  if (localChanged && remoteChanged && !eq(local, remote)) {
    onConflict()
    return local
  }
  if (!eq(local, base)) return local
  if (!eq(remote, base)) return remote
  return local
}

function indexById(items) {
  const map = new Map()
  for (const item of items ?? []) map.set(item.id, item)
  return map
}

function mergeItemsById(base, remote, local, onConflict) {
  const b = indexById(base)
  const r = indexById(remote)
  const l = indexById(local)
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out = []

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)

    if (bv && !lv && !rv) continue
    if (bv && !lv) {
      if (rv && !eq(rv, bv)) out.push(rv)
      continue
    }
    if (bv && !rv && lv) {
      out.push(lv)
      continue
    }
    if (!bv && rv && lv) {
      if (eq(rv, lv)) out.push(lv)
      else {
        onConflict()
        out.push(lv)
      }
      continue
    }
    if (!lv && rv) {
      out.push(rv)
      continue
    }
    if (lv && !rv) {
      out.push(lv)
      continue
    }
    if (lv) {
      const merged = { ...lv }
      for (const key of new Set([...Object.keys(bv ?? {}), ...Object.keys(rv ?? {}), ...Object.keys(lv)])) {
        merged[key] = pick3WithConflict(bv?.[key], rv?.[key], lv[key], onConflict)
      }
      out.push(merged)
    }
  }
  return out
}

function mergeArrayById(base, remote, local, onConflict) {
  return mergeItemsById(base ?? [], remote ?? [], local ?? [], onConflict)
}

/** Mirrors src/lib/cloud/cloudMerge.ts mergeStringSet */
function mergeStringSet(base, remote, local) {
  const b = new Set(base)
  const r = new Set(remote)
  const l = new Set(local)
  const out = new Set()
  for (const key of l) {
    if (r.has(key) || !b.has(key)) out.add(key)
  }
  for (const key of r) {
    if (!b.has(key)) out.add(key)
  }
  return [...out].sort((a, c) => a.localeCompare(c, 'ru'))
}

function movement(id, qty, note = '') {
  return {
    id,
    itemId: 'item-1',
    locationId: 'loc-1',
    quantity: qty,
    type: 'receipt',
    date: '2026-07-01',
    note,
    createdAt: '2026-07-01T10:00:00.000Z',
  }
}

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function main() {
  const movId = 'mov-conflict-e2'
  const base = [movement(movId, 10, 'base')]
  const remote = [movement(movId, 12, 'remote-edit')]
  const local = [movement(movId, 15, 'local-edit')]

  let conflicts = 0
  const onConflict = () => {
    conflicts += 1
  }

  const merged = mergeArrayById(base, remote, local, onConflict)
  const row = merged.find((m) => m.id === movId)

  check('movement conflict count > 0', conflicts > 0, String(conflicts))
  check('merged movement keeps local qty', row?.quantity === 15, String(row?.quantity))
  check('merged movement keeps local note', row?.note === 'local-edit', row?.note)

  // No conflict when only one side changed
  conflicts = 0
  mergeArrayById(base, remote, base, onConflict)
  check('no conflict when only remote changed', conflicts === 0)

  conflicts = 0
  mergeArrayById(base, base, local, onConflict)
  check('no conflict when only local changed', conflicts === 0)

  // Production orders: per-id merge avoids whole-module conflict
  conflicts = 0
  const prodBase = {
    requests: [{ id: 'req-1', date: '2026-07-01', lineId: '1', shift: 'day', brigadeName: 'A', rawRollNumbers: '', createdAt: '', updatedAt: '' }],
    planner: { orders: [], nextOrderSeq: 1 },
  }
  const prodRemote = {
    ...prodBase,
    requests: [{ ...prodBase.requests[0], brigadeName: 'B' }],
  }
  const prodLocal = { ...prodBase }

  const prodMerged = {
    requests: mergeArrayById(prodBase.requests, prodRemote.requests, prodLocal.requests, onConflict),
    planner: prodBase.planner,
  }
  check('production request remote-only change merges without conflict', conflicts === 0)
  check('production applies remote when only remote changed', prodMerged.requests[0].brigadeName === 'B')

  // Concurrent edit on same production request → conflict
  conflicts = 0
  const prodLocal2 = {
    ...prodBase,
    requests: [{ ...prodBase.requests[0], brigadeName: 'Local-B' }],
  }
  mergeArrayById(prodBase.requests, prodRemote.requests, prodLocal2.requests, onConflict)
  check('production same-request concurrent edit triggers conflict', conflicts > 0)

  // factOverrides / closedMonths: 3-way set merge keeps both sides' additions
  const setBase = ['rowA|2026-06-01']
  const setLocal = ['rowA|2026-06-01', 'rowA|2026-06-15']
  const setRemote = ['rowA|2026-06-01', 'rowB|2026-06-20']
  const setMerged = mergeStringSet(setBase, setRemote, setLocal)
  check(
    'string set keeps local+remote additions',
    setMerged.includes('rowA|2026-06-15') && setMerged.includes('rowB|2026-06-20'),
    setMerged.join(','),
  )

  // Local cleared an override, remote kept it → removal wins
  const cleared = mergeStringSet(
    ['rowA|2026-06-01', 'rowA|2026-06-15'],
    ['rowA|2026-06-01', 'rowA|2026-06-15'],
    ['rowA|2026-06-01'],
  )
  check(
    'string set honors local removal vs remote keep',
    !cleared.includes('rowA|2026-06-15') && cleared.includes('rowA|2026-06-01'),
    cleared.join(','),
  )

  // closedMonths: A closes June, B closes July → both
  const closed = mergeStringSet([], ['2026-07'], ['2026-06'])
  check(
    'closed months union from both sides',
    closed.includes('2026-06') && closed.includes('2026-07'),
    closed.join(','),
  )

  // Old LWW would drop remote-only override when local list changed
  const oldLww = (() => {
    const base = ['a']
    const remote = ['a', 'b']
    const local = ['a', 'c']
    if (JSON.stringify(local) !== JSON.stringify(base)) return [...new Set(local)]
    if (JSON.stringify(remote) !== JSON.stringify(base)) return [...new Set(remote)]
    return [...new Set(local)]
  })()
  const fixed = mergeStringSet(['a'], ['a', 'b'], ['a', 'c'])
  check('old LWW drops remote-only key', !oldLww.includes('b'), oldLww.join(','))
  check('new set merge keeps remote-only key', fixed.includes('b') && fixed.includes('c'), fixed.join(','))

  const failed = checks.filter((c) => !c.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`Cloud conflict E2 PASSED — ${checks.length} checks`)
    process.exit(0)
  }
  console.error(`Cloud conflict E2 FAILED — ${failed.length}/${checks.length}`)
  for (const f of failed) console.error(`  - ${f.name}`)
  process.exit(1)
}

main()
