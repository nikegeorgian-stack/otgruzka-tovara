import type { Employee } from '@/lib/types'
import type { ItAsset, ItHandoverAct, ItOfficeStore } from './types'

export type UpsertItHandoverActInput = {
  id?: string
  actType: ItHandoverAct['actType']
  date: string
  employeeId: string
  fromEmployeeId?: string
  issuedBy: string
  issuedByName: string
  lines: ItHandoverAct['lines']
  comment?: string
}

export type PostItHandoverActResult =
  | { ok: true; act: ItHandoverAct }
  | { ok: false; error: string }

function nextActNumber(store: ItOfficeStore, date: string): string {
  const compact = date.replace(/-/g, '')
  const prefix = `АПП-${compact}-`
  const sameDay = store.acts.filter((a) => a.number.startsWith(prefix))
  const maxSeq = sameDay.reduce((max, a) => {
    const tail = a.number.slice(prefix.length)
    const n = parseInt(tail, 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`
}

function applyActToAssets(
  assets: ItAsset[],
  act: ItHandoverAct,
): { assets: ItAsset[]; error?: string } {
  const now = new Date().toISOString()
  let next = [...assets]

  for (const line of act.lines) {
    const idx = next.findIndex((a) => a.id === line.assetId)
    if (idx < 0) return { assets, error: 'asset_not_found' }
    const asset = next[idx]!

    if (act.actType === 'issue') {
      if (asset.status !== 'stock' && asset.status !== 'repair') {
        return { assets, error: 'asset_not_available' }
      }
      next[idx] = {
        ...asset,
        status: 'issued',
        currentEmployeeId: act.employeeId,
        updatedAt: now,
      }
    } else if (act.actType === 'return') {
      if (asset.currentEmployeeId && asset.currentEmployeeId !== act.employeeId) {
        return { assets, error: 'asset_wrong_holder' }
      }
      next[idx] = {
        ...asset,
        status: 'stock',
        currentEmployeeId: undefined,
        updatedAt: now,
      }
    } else if (act.actType === 'transfer') {
      if (act.fromEmployeeId && asset.currentEmployeeId !== act.fromEmployeeId) {
        return { assets, error: 'asset_wrong_holder' }
      }
      next[idx] = {
        ...asset,
        status: 'issued',
        currentEmployeeId: act.employeeId,
        updatedAt: now,
      }
    } else if (act.actType === 'write_off') {
      next[idx] = {
        ...asset,
        status: 'written_off',
        currentEmployeeId: undefined,
        updatedAt: now,
      }
    }
  }

  return { assets: next }
}

export function upsertItHandoverActDraft(
  store: ItOfficeStore,
  input: UpsertItHandoverActInput,
): ItOfficeStore {
  const now = new Date().toISOString()
  const validLines = input.lines.filter((l) => l.assetId)

  if (input.id) {
    const idx = store.acts.findIndex((a) => a.id === input.id && a.status === 'draft')
    if (idx >= 0) {
      const prev = store.acts[idx]!
      const nextActs = [...store.acts]
      nextActs[idx] = {
        ...prev,
        actType: input.actType,
        date: input.date,
        employeeId: input.employeeId,
        fromEmployeeId: input.fromEmployeeId,
        issuedBy: input.issuedBy,
        issuedByName: input.issuedByName,
        lines: validLines,
        comment: input.comment?.trim() || undefined,
        updatedAt: now,
      }
      return { ...store, acts: nextActs }
    }
  }

  const act: ItHandoverAct = {
    id: crypto.randomUUID(),
    number: nextActNumber(store, input.date),
    actType: input.actType,
    date: input.date,
    employeeId: input.employeeId,
    fromEmployeeId: input.fromEmployeeId,
    issuedBy: input.issuedBy,
    issuedByName: input.issuedByName,
    lines: validLines,
    status: 'draft',
    comment: input.comment?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }

  return { ...store, acts: [act, ...store.acts] }
}

export function postItHandoverAct(
  store: ItOfficeStore,
  employees: Employee[],
  actId: string,
): { store: ItOfficeStore; result: PostItHandoverActResult } {
  const idx = store.acts.findIndex((a) => a.id === actId && a.status === 'draft')
  if (idx < 0) return { store, result: { ok: false, error: 'act_not_found' } }

  const act = store.acts[idx]!
  if (!act.lines.length) return { store, result: { ok: false, error: 'act_empty' } }

  const employee = employees.find((e) => e.id === act.employeeId)
  if (!employee) return { store, result: { ok: false, error: 'employee_not_found' } }

  if (act.actType === 'transfer' && act.fromEmployeeId) {
    const from = employees.find((e) => e.id === act.fromEmployeeId)
    if (!from) return { store, result: { ok: false, error: 'from_employee_not_found' } }
  }

  const applied = applyActToAssets(store.assets, act)
  if (applied.error) return { store, result: { ok: false, error: applied.error } }

  const now = new Date().toISOString()
  const posted: ItHandoverAct = { ...act, status: 'posted', updatedAt: now, postedAt: now }
  const acts = [...store.acts]
  acts[idx] = posted

  return {
    store: { ...store, assets: applied.assets, acts },
    result: { ok: true, act: posted },
  }
}

export function removeItHandoverActDraft(store: ItOfficeStore, actId: string): ItOfficeStore {
  return {
    ...store,
    acts: store.acts.filter((a) => a.id !== actId || a.status === 'posted'),
  }
}

export function upsertItAsset(store: ItOfficeStore, asset: ItAsset, nextSeq?: number): ItOfficeStore {
  const exists = store.assets.some((a) => a.id === asset.id)
  const assets = exists
    ? store.assets.map((a) => (a.id === asset.id ? asset : a))
    : [...store.assets, asset]
  return {
    ...store,
    assets,
    nextInventorySeq: nextSeq ?? store.nextInventorySeq,
  }
}

export function removeItAsset(store: ItOfficeStore, assetId: string): ItOfficeStore {
  const asset = store.assets.find((a) => a.id === assetId)
  if (!asset || asset.status === 'issued') return store
  return { ...store, assets: store.assets.filter((a) => a.id !== assetId) }
}
