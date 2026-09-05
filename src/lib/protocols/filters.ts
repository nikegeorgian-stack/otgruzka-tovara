import type { Employee } from '@/lib/types'
import type {
  MeetingProtocol,
  ProtocolAssignmentStatus,
  ProtocolItem,
  ProtocolsStore,
} from './types'
import { deriveAssignmentStatus } from './init'

export type ProtocolListFilters = {
  numberQ?: string
  dateFrom?: string
  dateTo?: string
  assigneeEmployeeId?: string
  structuralUnitId?: string
  status?: ProtocolAssignmentStatus | ''
  dueFrom?: string
  dueTo?: string
  overdueOnly?: boolean
  includeArchived?: boolean
}

export function filterProtocolItems(
  store: ProtocolsStore,
  employees: Employee[],
  filters: ProtocolListFilters,
): { protocol: MeetingProtocol; item: ProtocolItem }[] {
  const protocolById = new Map(store.protocols.map((p) => [p.id, p]))
  const empById = new Map(employees.map((e) => [e.id, e]))
  const numberQ = filters.numberQ?.trim().toLowerCase() ?? ''
  const out: { protocol: MeetingProtocol; item: ProtocolItem }[] = []

  for (const item of store.items) {
    if (!filters.includeArchived && item.archived) continue
    const protocol = protocolById.get(item.protocolId)
    if (!protocol) continue
    if (!filters.includeArchived && protocol.archived) continue

    const status = deriveAssignmentStatus(item.status, item.dueDate)
    if (filters.overdueOnly && status !== 'overdue') continue
    if (filters.status && status !== filters.status) continue

    if (numberQ && !protocol.number.toLowerCase().includes(numberQ)) continue

    if (filters.dateFrom || filters.dateTo) {
      const day = protocol.meetingAt.slice(0, 10)
      if (filters.dateFrom && day < filters.dateFrom) continue
      if (filters.dateTo && day > filters.dateTo) continue
    }

    if (filters.dueFrom || filters.dueTo) {
      if (!item.dueDate) continue
      if (filters.dueFrom && item.dueDate < filters.dueFrom) continue
      if (filters.dueTo && item.dueDate > filters.dueTo) continue
    }

    if (filters.assigneeEmployeeId) {
      if (!item.assigneeEmployeeIds.includes(filters.assigneeEmployeeId)) continue
    }

    if (filters.structuralUnitId) {
      const hit = item.assigneeEmployeeIds.some((id) => {
        const e = empById.get(id)
        return e?.structuralUnitId === filters.structuralUnitId
      })
      if (!hit) continue
    }

    out.push({ protocol, item: { ...item, status } })
  }

  return out.sort((a, b) => {
    const da = a.item.dueDate ?? '9999'
    const db = b.item.dueDate ?? '9999'
    if (da !== db) return da.localeCompare(db)
    return a.protocol.number.localeCompare(b.protocol.number, 'ru')
  })
}

export function filterProtocols(
  store: ProtocolsStore,
  filters: ProtocolListFilters,
): MeetingProtocol[] {
  const numberQ = filters.numberQ?.trim().toLowerCase() ?? ''
  return store.protocols
    .filter((p) => {
      if (!filters.includeArchived && p.archived) return false
      if (numberQ && !p.number.toLowerCase().includes(numberQ)) return false
      if (filters.dateFrom || filters.dateTo) {
        const day = p.meetingAt.slice(0, 10)
        if (filters.dateFrom && day < filters.dateFrom) return false
        if (filters.dateTo && day > filters.dateTo) return false
      }
      return true
    })
    .sort((a, b) => b.meetingAt.localeCompare(a.meetingAt))
}
