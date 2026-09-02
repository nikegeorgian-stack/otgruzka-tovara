import type {
  MeetingProtocol,
  ProtocolAckStatus,
  ProtocolAssignmentStatus,
  ProtocolAttachment,
  ProtocolItem,
  ProtocolNotification,
  ProtocolPriority,
  ProtocolsStore,
} from './types'

const STATUSES = new Set<ProtocolAssignmentStatus>([
  'new',
  'sent_for_ack',
  'acknowledged',
  'in_progress',
  'done',
  'overdue',
  'cancelled',
])

const ACK = new Set<ProtocolAckStatus>(['not_sent', 'pending', 'acknowledged', 'refused'])

const PRIOS = new Set<ProtocolPriority>(['low', 'normal', 'high', 'urgent'])

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

function todayYmd(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Авто-просрочка: срок прошёл и поручение не закрыто. */
export function deriveAssignmentStatus(
  status: ProtocolAssignmentStatus,
  dueDate: string | undefined,
  nowYmd = todayYmd(),
): ProtocolAssignmentStatus {
  if (status === 'done' || status === 'cancelled') return status
  if (dueDate && dueDate < nowYmd) return 'overdue'
  if (status === 'overdue') return 'in_progress'
  return status
}

function normalizeProtocol(raw: unknown): MeetingProtocol | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  if (!id) return null
  const now = new Date().toISOString()
  return {
    id,
    number: asString(r.number) || id,
    meetingAt: asString(r.meetingAt) || now,
    topic: asString(r.topic),
    place: asString(r.place) || undefined,
    chairEmployeeId: asString(r.chairEmployeeId) || undefined,
    secretaryEmployeeId: asString(r.secretaryEmployeeId) || undefined,
    participantEmployeeIds: asStringList(r.participantEmployeeIds),
    attachmentIds: asStringList(r.attachmentIds),
    notes: asString(r.notes) || undefined,
    archived: r.archived === true,
    createdAt: asString(r.createdAt) || now,
    updatedAt: asString(r.updatedAt) || now,
    createdBy: asString(r.createdBy) || undefined,
    createdByName: asString(r.createdByName) || undefined,
    updatedBy: asString(r.updatedBy) || undefined,
  }
}

function normalizeItem(raw: unknown): ProtocolItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  const protocolId = asString(r.protocolId)
  if (!id || !protocolId) return null
  const dueDate = asString(r.dueDate) || undefined
  const rawStatus = asString(r.status) as ProtocolAssignmentStatus
  const status = deriveAssignmentStatus(
    STATUSES.has(rawStatus) ? rawStatus : 'new',
    dueDate,
  )
  const ackRaw = asString(r.ackStatus) as ProtocolAckStatus
  const prio = asString(r.priority) as ProtocolPriority
  return {
    id,
    protocolId,
    sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : 0,
    decision: asString(r.decision),
    assignmentText: asString(r.assignmentText),
    assigneeEmployeeIds: asStringList(r.assigneeEmployeeIds),
    dueDate,
    priority: PRIOS.has(prio) ? prio : 'normal',
    controllerEmployeeId: asString(r.controllerEmployeeId) || undefined,
    status,
    comment: asString(r.comment) || undefined,
    attachmentIds: asStringList(r.attachmentIds),
    ackStatus: ACK.has(ackRaw) ? ackRaw : 'not_sent',
    ackSentAt: asString(r.ackSentAt) || undefined,
    ackSentToEmployeeId: asString(r.ackSentToEmployeeId) || undefined,
    ackAt: asString(r.ackAt) || undefined,
    ackByUserId: asString(r.ackByUserId) || undefined,
    ackByName: asString(r.ackByName) || undefined,
    ackMethod:
      r.ackMethod === 'in_app' || r.ackMethod === 'paper_scan'
        ? r.ackMethod
        : undefined,
    ackComment: asString(r.ackComment) || undefined,
    secretaryAckNote: asString(r.secretaryAckNote) || undefined,
    signedAttachmentId: asString(r.signedAttachmentId) || undefined,
    ackLocked: r.ackLocked === true,
    archived: r.archived === true,
    updatedAt: asString(r.updatedAt) || new Date().toISOString(),
  }
}

function normalizeAttachment(raw: unknown): ProtocolAttachment | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  const ownerId = asString(r.ownerId)
  if (!id || !ownerId) return null
  return {
    id,
    ownerKind: r.ownerKind === 'item' ? 'item' : 'protocol',
    ownerId,
    storagePath: asString(r.storagePath),
    fileName: asString(r.fileName) || 'file',
    mimeType: asString(r.mimeType) || undefined,
    sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : undefined,
    uploadedBy: asString(r.uploadedBy),
    uploadedAt: asString(r.uploadedAt) || new Date().toISOString(),
    kind: r.kind === 'signed_ack' ? 'signed_ack' : 'general',
  }
}

function normalizeNotification(raw: unknown): ProtocolNotification | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  if (!id) return null
  return {
    id,
    kind: (asString(r.kind) || 'assigned') as ProtocolNotification['kind'],
    protocolId: asString(r.protocolId),
    itemId: asString(r.itemId) || undefined,
    toEmployeeId: asString(r.toEmployeeId) || undefined,
    toUserId: asString(r.toUserId) || undefined,
    title: asString(r.title),
    body: asString(r.body) || undefined,
    createdAt: asString(r.createdAt) || new Date().toISOString(),
    readAt: asString(r.readAt) || undefined,
  }
}

export function createDefaultProtocolsStore(): ProtocolsStore {
  return {
    protocols: [],
    items: [],
    attachments: [],
    notifications: [],
    nextNumberSeq: 1,
  }
}

export function normalizeProtocolsStore(raw: unknown): ProtocolsStore {
  if (!raw || typeof raw !== 'object') return createDefaultProtocolsStore()
  const r = raw as Record<string, unknown>
  const protocols = Array.isArray(r.protocols)
    ? r.protocols.map(normalizeProtocol).filter((x): x is MeetingProtocol => !!x)
    : []
  const items = Array.isArray(r.items)
    ? r.items.map(normalizeItem).filter((x): x is ProtocolItem => !!x)
    : []
  const attachments = Array.isArray(r.attachments)
    ? r.attachments.map(normalizeAttachment).filter((x): x is ProtocolAttachment => !!x)
    : []
  const notifications = Array.isArray(r.notifications)
    ? r.notifications.map(normalizeNotification).filter((x): x is ProtocolNotification => !!x)
    : []
  const seq =
    typeof r.nextNumberSeq === 'number' && r.nextNumberSeq > 0
      ? Math.floor(r.nextNumberSeq)
      : Math.max(1, protocols.length + 1)
  return { protocols, items, attachments, notifications, nextNumberSeq: seq }
}

export function countProtocolsFootprint(store: ProtocolsStore | undefined): number {
  if (!store) return 0
  return (
    (store.protocols?.length ?? 0) +
    (store.items?.length ?? 0) +
    (store.attachments?.length ?? 0)
  )
}
