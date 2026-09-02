import { appendAudit } from '@/lib/audit'
import {
  appendAttendancePunch,
  createDefaultAttendanceStore,
  normalizeAttendanceStore,
} from '@/lib/attendance/init'
import { nextPunchKind } from '@/lib/attendance/punch'
import type {
  AttendancePunch,
  AttendancePunchMethod,
} from '@/lib/attendance/types'
import type { StoreSliceDeps } from '../storeApi'
import { actorAuditFields } from './actorAuditFields'

export function createAttendanceSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  return {
    recordAttendancePunch(input: {
      employeeId: string
      method: AttendancePunchMethod
      deviceLabel?: string
      confidence?: number
      at?: string
    }): AttendancePunch {
      const at = input.at ?? new Date().toISOString()
      let created: AttendancePunch | null = null
      setStore((s) => {
        const attendance = normalizeAttendanceStore(
          s.attendance ?? createDefaultAttendanceStore(),
        )
        const kind = nextPunchKind(attendance, input.employeeId, at)
        const punch: AttendancePunch = {
          id: crypto.randomUUID(),
          employeeId: input.employeeId,
          at,
          kind,
          method: input.method,
          deviceLabel: input.deviceLabel,
          confidence: input.confidence,
        }
        created = punch
        const emp = s.employees.find((e) => e.id === input.employeeId)
        const name = emp?.fullName ?? input.employeeId
        const label = kind === 'in' ? 'пришёл' : 'ушёл'
        const next = {
          ...s,
          attendance: appendAttendancePunch(attendance, punch),
        }
        return appendAudit(next, {
          action: 'attendance_punch',
          employeeId: input.employeeId,
          detail: `${name}: ${label} (${input.method})`,
          ...who(),
        })
      })
      if (!created) throw new Error('attendance punch failed')
      return created
    },
  }
}
