/**
 * PHASE G6 — deny-by-default capacity planning capabilities.
 * Canonical ACL = FstPrincipalAccess.capabilitiesJson (never AppStore roleId).
 */

export const G6_CAPS = Object.freeze({
  CAPACITY_READ: 'capacity.read',
  CAPACITY_NORM_EDIT: 'capacity.norm.edit',
  CAPACITY_NORM_APPROVE: 'capacity.norm.approve',
  CAPACITY_CALENDAR_EDIT: 'capacity.calendar.edit',
  CAPACITY_RUN: 'capacity.run',
  CAPACITY_SCHEDULE_EDIT: 'capacity.schedule.edit',
  CAPACITY_SCHEDULE_PUBLISH: 'capacity.schedule.publish',
  CAPACITY_OVERLOAD_APPROVE: 'capacity.overload.approve',
})

export function defaultG6Capabilities(partial = {}) {
  const out = {}
  for (const key of Object.values(G6_CAPS)) {
    out[key] = partial[key] === true
  }
  return out
}
