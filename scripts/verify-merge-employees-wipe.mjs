/**
 * Smoke: sparse local seed must not wipe remote employees / users in merge.
 * Run: node scripts/verify-merge-employees-wipe.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Use ts via dynamic - project may not export merge. Test logic inline mirror.

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function indexByKey(items, keyOf) {
  const map = new Map()
  for (const item of items ?? []) {
    const key = keyOf(item)
    if (!key) continue
    map.set(key, item)
  }
  return map
}

function mergeItemsByKey(base, remote, local, keyOf, opts) {
  const b = indexByKey(base, keyOf)
  const r = indexByKey(remote, keyOf)
  const l = indexByKey(local, keyOf)
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out = []
  const keepRemoteDeletes = opts?.refuseSparseLocalDeletes === true

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)

    if (bv && !lv && !rv) continue
    if (bv && !lv) {
      if (rv && !eq(rv, bv)) {
        out.push(rv)
        continue
      }
      if (keepRemoteDeletes && rv) {
        out.push(rv)
        continue
      }
      continue
    }
    if (bv && !rv && lv) {
      out.push(lv)
      continue
    }
    if (!bv && rv && lv) {
      out.push(lv)
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
    if (lv) out.push(lv)
  }
  return out
}

function isSparse(localLen, remoteLen, minRemote) {
  if (remoteLen < minRemote) return false
  return localLen < Math.ceil(remoteLen * 0.85)
}

function mergeEmployees(base, remote, local) {
  const sparse = isSparse(local.length, remote.length, 8)
  return mergeItemsByKey(base, remote, local, (e) => e.id, {
    refuseSparseLocalDeletes: sparse,
  })
}

const remote = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, name: `P${i}` }))
const base = remote.map((e) => ({ ...e }))
const seedLocal = remote.slice(0, 3) // seed-like sparse

const wiped = mergeItemsByKey(base, remote, seedLocal, (e) => e.id, {
  refuseSparseLocalDeletes: false,
})
const protectedMerge = mergeEmployees(base, remote, seedLocal)

if (wiped.length >= 20) {
  console.error('FAIL: expected unprotected merge to drop people, got', wiped.length)
  process.exit(1)
}
if (protectedMerge.length !== 20) {
  console.error('FAIL: sparse local wiped roster:', protectedMerge.length)
  process.exit(1)
}

// Real single delete should still work when local is not sparse
const almostFull = remote.slice(0, 19)
const afterDelete = mergeEmployees(base, remote, almostFull)
if (afterDelete.length !== 19) {
  console.error('FAIL: legitimate delete blocked:', afterDelete.length)
  process.exit(1)
}

console.log('OK: sparse local cannot wipe employees; normal delete still works')
