import type { AttendancePunch, AttendanceStore } from './types'

const MAX_PUNCHES = 8000

export function createDefaultAttendanceStore(): AttendanceStore {
  return { punches: [] }
}

export function normalizeAttendanceStore(raw: unknown): AttendanceStore {
  if (!raw || typeof raw !== 'object') return createDefaultAttendanceStore()
  const punchesRaw = (raw as AttendanceStore).punches
  if (!Array.isArray(punchesRaw)) return createDefaultAttendanceStore()
  const punches: AttendancePunch[] = []
  for (const p of punchesRaw) {
    if (!p || typeof p !== 'object') continue
    const id = typeof p.id === 'string' ? p.id : ''
    const employeeId = typeof p.employeeId === 'string' ? p.employeeId : ''
    const at = typeof p.at === 'string' ? p.at : ''
    const kind = p.kind === 'out' ? 'out' : p.kind === 'in' ? 'in' : null
    if (!id || !employeeId || !at || !kind) continue
    const method =
      p.method === 'face' || p.method === 'manual' || p.method === 'pin' ? p.method : 'pin'
    punches.push({
      id,
      employeeId,
      at,
      kind,
      method,
      deviceLabel: typeof p.deviceLabel === 'string' ? p.deviceLabel : undefined,
      confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
    })
  }
  punches.sort((a, b) => a.at.localeCompare(b.at))
  return { punches: punches.slice(-MAX_PUNCHES) }
}

export function appendAttendancePunch(
  store: AttendanceStore,
  punch: AttendancePunch,
): AttendanceStore {
  const punches = [...store.punches, punch].sort((a, b) => a.at.localeCompare(b.at))
  return { punches: punches.slice(-MAX_PUNCHES) }
}
