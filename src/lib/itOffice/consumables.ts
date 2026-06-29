import type { ItConsumableBalance, ItConsumableIssue, ItOfficeStore } from './types'

export type IssueConsumableInput = {
  specId: string
  qty: number
  date: string
  locationId: string
  printerAssetId?: string
  employeeId?: string
  issuedBy: string
  issuedByName: string
  note?: string
}

export type IssueConsumableResult =
  | { ok: true; issue: ItConsumableIssue }
  | { ok: false; error: string }

function balanceKey(specId: string, locationId: string): string {
  return `${specId}|${locationId}`
}

export function consumableBalanceQty(
  store: ItOfficeStore,
  specId: string,
  locationId: string,
): number {
  return (
    store.consumableBalances.find((b) => b.specId === specId && b.locationId === locationId)?.qty ?? 0
  )
}

export function setConsumableBalance(
  store: ItOfficeStore,
  specId: string,
  locationId: string,
  qty: number,
): ItOfficeStore {
  const key = balanceKey(specId, locationId)
  const existing = store.consumableBalances.find(
    (b) => balanceKey(b.specId, b.locationId) === key,
  )
  const nextQty = Math.max(0, qty)
  const consumableBalances: ItConsumableBalance[] = existing
    ? store.consumableBalances.map((b) =>
        balanceKey(b.specId, b.locationId) === key ? { ...b, qty: nextQty } : b,
      )
    : [...store.consumableBalances, { specId, locationId, qty: nextQty }]
  return { ...store, consumableBalances }
}

export function postConsumableIssue(
  store: ItOfficeStore,
  input: IssueConsumableInput,
): { store: ItOfficeStore; result: IssueConsumableResult } {
  const spec = store.consumableSpecs.find((s) => s.id === input.specId && s.active)
  if (!spec) return { store, result: { ok: false, error: 'spec_not_found' } }

  const qty = Math.max(1, Math.floor(input.qty) || 1)
  const available = consumableBalanceQty(store, input.specId, input.locationId)
  if (available < qty) return { store, result: { ok: false, error: 'insufficient_stock' } }

  const issue: ItConsumableIssue = {
    id: crypto.randomUUID(),
    specId: input.specId,
    qty,
    date: input.date,
    printerAssetId: input.printerAssetId,
    employeeId: input.employeeId,
    issuedBy: input.issuedBy,
    issuedByName: input.issuedByName,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }

  let next = setConsumableBalance(store, input.specId, input.locationId, available - qty)
  next = { ...next, consumableIssues: [issue, ...next.consumableIssues] }
  return { store: next, result: { ok: true, issue } }
}

export function listLowStockConsumables(store: ItOfficeStore) {
  return store.consumableSpecs
    .filter((s) => s.active)
    .flatMap((spec) => {
      const total = store.consumableBalances
        .filter((b) => b.specId === spec.id)
        .reduce((n, b) => n + b.qty, 0)
      return total < spec.minStock ? [{ spec, total }] : []
    })
}
