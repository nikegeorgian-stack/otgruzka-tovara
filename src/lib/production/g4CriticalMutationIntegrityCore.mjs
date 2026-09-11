/**
 * R3.1C — browser/server shared semantic fingerprint for irreversible G4
 * QC and legacy shipment mutations.
 */
import { sha256Utf8 } from '../formulations/batchMixFingerprint.mjs'

export const G4_CRITICAL_MUTATION_COMMANDS = Object.freeze([
  'qc.review.start',
  'qc.release',
  'qc.regrade',
  'qc.reject',
  'qc.scrap.writeoff',
  'shipment.post',
  'shipment.cancel',
])

const SUPPORTED = new Set(G4_CRITICAL_MUTATION_COMMANDS)

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

export function isG4CriticalMutationCommand(commandType) {
  return SUPPORTED.has(String(commandType ?? '').trim())
}

export function canonicalG4CriticalMutationCommand(commandType, command) {
  const normalizedType = String(commandType ?? '').trim()
  if (!SUPPORTED.has(normalizedType)) {
    throw new TypeError(`unsupported_g4_critical_command:${normalizedType}`)
  }
  return canonicalize({
    version: 1,
    commandType: normalizedType,
    command: command && typeof command === 'object' ? command : {},
  })
}

export function stableG4CriticalMutationJson(commandType, command) {
  return JSON.stringify(canonicalG4CriticalMutationCommand(commandType, command))
}

export function g4CriticalMutationCommandFingerprint(commandType, command) {
  return `g4-critical:v1:sha256:${sha256Utf8(
    stableG4CriticalMutationJson(commandType, command),
  )}`
}
