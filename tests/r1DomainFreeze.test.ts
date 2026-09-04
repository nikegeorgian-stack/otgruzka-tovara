/**
 * PHASE R1 — domain freeze/resume helpers + write gates (pure, no DataConnect I/O).
 */
import { describe, expect, it } from 'vitest'
import {
  applyDomainFreeze,
  applyDomainResume,
  assertDomainWritable,
  emptyCriticalPayload,
  getDomainOperatingMode,
  isDomainFrozen,
  markCapacityPlanningFeatureActive,
  markMasterDataDomainActive,
  markPackagingQcFeatureActive,
  markProcurementDomainActive,
  markProductionDomainActive,
  markSalesPlanningActive,
  markWarehouseDomainActive,
  parseCriticalPayload,
  serializeCriticalPayload,
} from '../api/fst/_g1CriticalHelpers.mjs'
import {
  applyDomainFreezeCommandLocal,
  DOMAIN_FREEZE_COMMANDS,
} from '../api/fst/_g1DomainFreeze.mjs'

const NOW = '2026-09-04T12:00:00.000Z'
const ACTOR = { uid: 'admin-1', email: 'admin@fibercell.net' }

function activePayload() {
  let p = emptyCriticalPayload()
  p = markWarehouseDomainActive(p, ACTOR.uid, NOW)
  p = markProductionDomainActive(p, ACTOR.uid, NOW)
  p = markPackagingQcFeatureActive(p, ACTOR.uid, NOW)
  p = markMasterDataDomainActive(p, ACTOR.uid, NOW)
  p = markSalesPlanningActive(p, ACTOR.uid, NOW)
  p = markProcurementDomainActive(p, ACTOR.uid, NOW)
  p = markCapacityPlanningFeatureActive(p, ACTOR.uid, NOW)
  return p
}

describe('PHASE R1 domain freeze helpers', () => {
  it('active:true without operatingMode → active; missing active → inactive', () => {
    const p = markWarehouseDomainActive(emptyCriticalPayload(), ACTOR.uid, NOW)
    expect(getDomainOperatingMode(p, 'warehouse')).toBe('active')
    expect(getDomainOperatingMode(emptyCriticalPayload(), 'warehouse')).toBe('inactive')
    expect(isDomainFrozen(p, 'warehouse')).toBe(false)
  })

  it('freeze then assertDomainWritable fails with domain_frozen', () => {
    const base = activePayload()
    const frozen = applyDomainFreeze(base, 'warehouse', {
      actorUid: ACTOR.uid,
      reason: 'incident',
      now: NOW,
    })
    expect(frozen.ok).toBe(true)
    expect(frozen.operatingMode).toBe('frozen')
    expect(frozen.frozen).toBe(true)
    expect(getDomainOperatingMode(frozen.payload, 'warehouse')).toBe('frozen')

    const gate = assertDomainWritable(frozen.payload, 'warehouse')
    expect(gate).toEqual({ ok: false, error: 'domain_frozen', status: 409 })
  })

  it('freeze keeps overlay readable (mode frozen; parse preserves slice)', () => {
    const base = activePayload()
    const frozen = applyDomainFreeze(base, 'production', {
      actorUid: ACTOR.uid,
      reason: 'maint',
      now: NOW,
    })
    expect(frozen.ok).toBe(true)
    const json = serializeCriticalPayload(frozen.payload)
    const parsed = parseCriticalPayload(json, { revision: 3 })
    expect(parsed.ok).toBe(true)
    expect(getDomainOperatingMode(parsed.payload, 'production')).toBe('frozen')
    expect(parsed.payload.domains.production).toBeTruthy()
    expect(assertDomainWritable(parsed.payload, 'production').error).toBe('domain_frozen')
  })

  it('resume restores writes', () => {
    let p = activePayload()
    p = applyDomainFreeze(p, 'masterData', {
      actorUid: ACTOR.uid,
      reason: 'pause',
      now: NOW,
    }).payload
    expect(assertDomainWritable(p, 'masterData').ok).toBe(false)

    const resumed = applyDomainResume(p, 'masterData', {
      actorUid: ACTOR.uid,
      reason: 'ok',
      now: NOW,
    })
    expect(resumed.ok).toBe(true)
    expect(resumed.operatingMode).toBe('active')
    expect(resumed.resumed).toBe(true)
    expect(assertDomainWritable(resumed.payload, 'masterData')).toEqual({ ok: true })
  })

  it('freeze warehouse does not freeze production', () => {
    const base = activePayload()
    const frozen = applyDomainFreeze(base, 'warehouse', {
      actorUid: ACTOR.uid,
      reason: 'wh only',
      now: NOW,
    })
    expect(isDomainFrozen(frozen.payload, 'warehouse')).toBe(true)
    expect(isDomainFrozen(frozen.payload, 'production')).toBe(false)
    expect(getDomainOperatingMode(frozen.payload, 'production')).toBe('active')
    expect(assertDomainWritable(frozen.payload, 'production').ok).toBe(true)
  })

  it('idempotent freeze', () => {
    const base = activePayload()
    const first = applyDomainFreeze(base, 'procurement', {
      actorUid: ACTOR.uid,
      reason: 'r1',
      now: NOW,
    })
    const second = applyDomainFreeze(first.payload, 'procurement', {
      actorUid: ACTOR.uid,
      reason: 'r2',
      now: NOW,
    })
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.frozen).toBe(false)
    expect(second.payload.domainMeta.procurement.freezeReason).toBe('r1')
  })

  it('missing reason rejected by local command apply', () => {
    const base = activePayload()
    const r = applyDomainFreezeCommandLocal(
      base,
      'warehouse.domain.freeze',
      {},
      ACTOR,
      NOW,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toBe('reason_required')
  })

  it('inactive domain cannot freeze', () => {
    const p = emptyCriticalPayload()
    const r = applyDomainFreeze(p, 'salesPlanning', {
      actorUid: ACTOR.uid,
      reason: 'nope',
      now: NOW,
    })
    expect(r).toEqual({ ok: false, error: 'domain_inactive', status: 409 })

    const cmd = applyDomainFreezeCommandLocal(
      p,
      'sales.domain.freeze',
      { reason: 'nope' },
      ACTOR,
      NOW,
    )
    expect(cmd.ok).toBe(false)
    expect(cmd.error).toBe('domain_inactive')
  })

  it('local freeze/resume command map covers all domains', () => {
    expect(Object.keys(DOMAIN_FREEZE_COMMANDS).length).toBe(14)
    let p = activePayload()
    for (const [cmd, { key, action }] of Object.entries(DOMAIN_FREEZE_COMMANDS)) {
      if (action !== 'freeze') continue
      const r = applyDomainFreezeCommandLocal(p, cmd, { reason: `freeze-${key}` }, ACTOR, NOW)
      expect(r.ok, cmd).toBe(true)
      expect(r.domainKey).toBe(key)
      expect(r.operatingMode).toBe('frozen')
      p = r.payload
    }
    // siblings all frozen independently
    expect(isDomainFrozen(p, 'warehouse')).toBe(true)
    expect(isDomainFrozen(p, 'capacityPlanning')).toBe(true)

    const resume = applyDomainFreezeCommandLocal(
      p,
      'capacity.domain.resume',
      { reason: 'go' },
      ACTOR,
      NOW,
    )
    expect(resume.ok).toBe(true)
    expect(resume.operatingMode).toBe('active')
    expect(isDomainFrozen(resume.payload, 'warehouse')).toBe(true)
  })

  it('preserves activatedAt/activatedBy across freeze/resume', () => {
    let p = markWarehouseDomainActive(emptyCriticalPayload(), 'orig-uid', '2026-01-01T00:00:00.000Z')
    p = applyDomainFreeze(p, 'warehouse', {
      actorUid: ACTOR.uid,
      reason: 'x',
      now: NOW,
    }).payload
    expect(p.domainMeta.warehouse.activatedBy).toBe('orig-uid')
    expect(p.domainMeta.warehouse.activatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.domainMeta.warehouse.frozenBy).toBe(ACTOR.uid)

    p = applyDomainResume(p, 'warehouse', {
      actorUid: 'resume-uid',
      reason: 'y',
      now: '2026-09-05T00:00:00.000Z',
    }).payload
    expect(p.domainMeta.warehouse.activatedBy).toBe('orig-uid')
    expect(p.domainMeta.warehouse.resumedBy).toBe('resume-uid')
    expect(p.domainMeta.warehouse.operatingMode).toBe('active')
  })
})
