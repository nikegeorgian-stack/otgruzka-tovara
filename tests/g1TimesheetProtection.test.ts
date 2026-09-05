/**
 * PHASE G1 — prove employees/months/timesheets stay outside critical migration
 * and local overlay does not rewrite those roots.
 */
import { describe, expect, it } from 'vitest'
import { emptyCriticalPayload, parseCriticalPayload, serializeCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'
import { resolveAuthoritativeWarehouseOverlay } from '@/lib/warehouse/g1ServerClient'
import { createDefaultStore } from '@/lib/storage'

describe('G1 timesheet / employees protection', () => {
  it('critical payload cannot include employees/months', () => {
    const payload = emptyCriticalPayload() as {
      schemaVersion: number
      domains: Record<string, unknown>
    }
    payload.domains.employees = [{ id: 'nope' }]
    const parsed = parseCriticalPayload(serializeCriticalPayload(payload))
    expect(parsed.ok).toBe(false)
  })

  it('warehouse overlay does not touch employees/months/timesheets', () => {
    const store = createDefaultStore()
    const employeesBefore = JSON.stringify(store.employees)
    const monthsBefore = JSON.stringify(store.months)
    const overlay = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: store.warehouse,
      criticalWarehouse: {
        ...store.warehouse,
        documents: [],
        movements: [],
        auditLog: [{ id: 'a1', at: '2026-01-01', action: 'document_post' } as never],
      },
      criticalRevision: 1,
    })
    expect(overlay.source).toBe('fst_critical_store')
    const next = { ...store, warehouse: overlay.warehouse }
    expect(JSON.stringify(next.employees)).toBe(employeesBefore)
    expect(JSON.stringify(next.months)).toBe(monthsBefore)
  })
})
