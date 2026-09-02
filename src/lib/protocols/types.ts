/** Протоколы совещаний — типы среза AppStore.protocols */

export type ProtocolAssignmentStatus =
  | 'new'
  | 'sent_for_ack'
  | 'acknowledged'
  | 'in_progress'
  | 'done'
  | 'overdue'
  | 'cancelled'

export type ProtocolAckStatus = 'not_sent' | 'pending' | 'acknowledged' | 'refused'

export type ProtocolPriority = 'low' | 'normal' | 'high' | 'urgent'

export type ProtocolAttachment = {
  id: string
  /** protocol | item */
  ownerKind: 'protocol' | 'item'
  ownerId: string
  storagePath: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  uploadedBy: string
  uploadedAt: string
  /** Подписанный бланк ознакомления */
  kind?: 'general' | 'signed_ack'
}

export type MeetingProtocol = {
  id: string
  number: string
  /** ISO дата-время совещания */
  meetingAt: string
  topic: string
  place?: string
  chairEmployeeId?: string
  secretaryEmployeeId?: string
  participantEmployeeIds: string[]
  attachmentIds: string[]
  notes?: string
  archived?: boolean
  createdAt: string
  updatedAt: string
  createdBy?: string
  createdByName?: string
  updatedBy?: string
}

export type ProtocolItem = {
  id: string
  protocolId: string
  sortOrder: number
  decision: string
  assignmentText: string
  assigneeEmployeeIds: string[]
  dueDate?: string
  priority: ProtocolPriority
  controllerEmployeeId?: string
  status: ProtocolAssignmentStatus
  comment?: string
  attachmentIds: string[]
  ackStatus: ProtocolAckStatus
  ackSentAt?: string
  ackSentToEmployeeId?: string
  ackAt?: string
  ackByUserId?: string
  ackByName?: string
  ackMethod?: 'in_app' | 'paper_scan'
  ackComment?: string
  secretaryAckNote?: string
  signedAttachmentId?: string
  /** После подтверждения — правит только sysadmin с причиной */
  ackLocked?: boolean
  archived?: boolean
  updatedAt: string
}

export type ProtocolNotificationKind =
  | 'assigned'
  | 'ack_sent'
  | 'ack_done'
  | 'due_soon'
  | 'due_today'
  | 'overdue'
  | 'changed'
  | 'cancelled'

export type ProtocolNotification = {
  id: string
  kind: ProtocolNotificationKind
  protocolId: string
  itemId?: string
  toEmployeeId?: string
  toUserId?: string
  title: string
  body?: string
  createdAt: string
  readAt?: string
}

export type ProtocolsStore = {
  protocols: MeetingProtocol[]
  items: ProtocolItem[]
  attachments: ProtocolAttachment[]
  notifications: ProtocolNotification[]
  /** Счётчик для ПС-YYYY-NNN */
  nextNumberSeq?: number
}

export type ProtocolAccessLevel = 'none' | 'my' | 'edit' | 'manage'
