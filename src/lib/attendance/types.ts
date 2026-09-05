/** Проход через терминал явки (пришёл / ушёл). */
export type AttendancePunchKind = 'in' | 'out'

export type AttendancePunchMethod = 'pin' | 'face' | 'manual'

export type AttendancePunch = {
  id: string
  employeeId: string
  /** ISO timestamp */
  at: string
  kind: AttendancePunchKind
  method: AttendancePunchMethod
  /** Подпись устройства / киоска */
  deviceLabel?: string
  /** Сходство лица 0…1 (если method=face) */
  confidence?: number
}

export type AttendanceStore = {
  punches: AttendancePunch[]
}
