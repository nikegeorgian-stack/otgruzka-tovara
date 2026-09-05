import { appendAudit } from '@/lib/audit'
import {
  createDefaultProtocolsStore,
  deriveAssignmentStatus,
  normalizeProtocolsStore,
} from '@/lib/protocols/init'
import {
  allocateProtocolNumber,
  protocolYearFromIso,
} from '@/lib/protocols/protocolNumber'
import type {
  MeetingProtocol,
  ProtocolAttachment,
  ProtocolAssignmentStatus,
  ProtocolItem,
  ProtocolNotification,
  ProtocolNotificationKind,
  ProtocolPriority,
} from '@/lib/protocols/types'
import type { AppStore } from '@/lib/types'
import { actorAuditFields } from './actorAuditFields'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export type ProtocolDraft = {
  id?: string
  meetingAt: string
  topic: string
  place?: string
  chairEmployeeId?: string
  secretaryEmployeeId?: string
  participantEmployeeIds: string[]
  notes?: string
  /** Если задан при создании — иначе авто ПС-YYYY-NNN */
  number?: string
}

export type ProtocolItemDraft = {
  id?: string
  protocolId: string
  sortOrder?: number
  decision: string
  assignmentText: string
  assigneeEmployeeIds: string[]
  dueDate?: string
  priority?: ProtocolPriority
  controllerEmployeeId?: string
  status?: ProtocolAssignmentStatus
  comment?: string
}

function canManageProtocols(_s: AppStore): boolean {
  // ACL на UI + role views; slice разрешает мутации при вызове из App.
  return true
}

export function createProtocolsSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  const actorIsSysadmin = (s: AppStore): boolean => {
    const uid = getActor?.()?.id
    if (!uid) return false
    return s.access.users.find((u) => u.id === uid)?.roleId === 'sysadmin'
  }

  return {
    upsertMeetingProtocol(draft: ProtocolDraft): string {
      let id = draft.id ?? ''
      patchStore(setStore, (s) => {
        if (!canManageProtocols(s)) return s
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const now = new Date().toISOString()
        const actor = who()
        if (draft.id) {
          const existing = protocols.protocols.find((p) => p.id === draft.id)
          if (!existing || existing.archived) return s
          id = existing.id
          const row: MeetingProtocol = {
            ...existing,
            meetingAt: draft.meetingAt || existing.meetingAt,
            topic: draft.topic.trim() || existing.topic,
            place: draft.place?.trim() || undefined,
            chairEmployeeId: draft.chairEmployeeId || undefined,
            secretaryEmployeeId: draft.secretaryEmployeeId || undefined,
            participantEmployeeIds: [...new Set(draft.participantEmployeeIds.filter(Boolean))],
            notes: draft.notes?.trim() || undefined,
            updatedAt: now,
            updatedBy: actor.by,
          }
          let next: AppStore = {
            ...s,
            protocols: {
              ...protocols,
              protocols: protocols.protocols.map((p) => (p.id === id ? row : p)),
            },
          }
          next = appendAudit(next, {
            action: 'protocol_update',
            detail: `${row.number} · ${row.topic}`,
            ...actor,
          })
          return next
        }

        const year = protocolYearFromIso(draft.meetingAt || now)
        const { number, nextNumberSeq } = draft.number?.trim()
          ? {
              number: draft.number.trim(),
              nextNumberSeq: protocols.nextNumberSeq ?? 1,
            }
          : allocateProtocolNumber(year, protocols.nextNumberSeq ?? 1)
        id = crypto.randomUUID()
        const row: MeetingProtocol = {
          id,
          number,
          meetingAt: draft.meetingAt || now,
          topic: draft.topic.trim() || 'Без темы',
          place: draft.place?.trim() || undefined,
          chairEmployeeId: draft.chairEmployeeId || undefined,
          secretaryEmployeeId: draft.secretaryEmployeeId || undefined,
          participantEmployeeIds: [...new Set(draft.participantEmployeeIds.filter(Boolean))],
          attachmentIds: [],
          notes: draft.notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.by,
          createdByName: actor.byName,
          updatedBy: actor.by,
        }
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            protocols: [row, ...protocols.protocols],
            nextNumberSeq,
          },
        }
        next = appendAudit(next, {
          action: 'protocol_create',
          detail: `${row.number} · ${row.topic}`,
          ...actor,
        })
        return next
      })
      return id
    },

    archiveMeetingProtocol(protocolId: string): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.protocols.find((p) => p.id === protocolId)
        if (!existing || existing.archived) return s
        ok = true
        const now = new Date().toISOString()
        const actor = who()
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            protocols: protocols.protocols.map((p) =>
              p.id === protocolId
                ? { ...p, archived: true, updatedAt: now, updatedBy: actor.by }
                : p,
            ),
            items: protocols.items.map((it) =>
              it.protocolId === protocolId
                ? { ...it, archived: true, updatedAt: now }
                : it,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_archive',
          detail: `${existing.number} · ${existing.topic}`,
          ...actor,
        })
        return next
      })
      return ok
    },

    upsertProtocolItem(draft: ProtocolItemDraft): string {
      let id = draft.id ?? ''
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const protocol = protocols.protocols.find((p) => p.id === draft.protocolId)
        if (!protocol || protocol.archived) return s
        const now = new Date().toISOString()
        const actor = who()
        const assignees = [...new Set(draft.assigneeEmployeeIds.filter(Boolean))]
        const dueDate = draft.dueDate || undefined
        const rawStatus = draft.status ?? 'new'
        const status = deriveAssignmentStatus(rawStatus, dueDate)

        if (draft.id) {
          const existing = protocols.items.find((it) => it.id === draft.id)
          if (!existing || existing.archived) return s
          id = existing.id
          const prevStatus = existing.status
          const row: ProtocolItem = {
            ...existing,
            decision: draft.decision.trim(),
            assignmentText: draft.assignmentText.trim(),
            assigneeEmployeeIds: assignees,
            dueDate,
            priority: draft.priority ?? existing.priority,
            controllerEmployeeId: draft.controllerEmployeeId || undefined,
            status,
            comment: draft.comment?.trim() || undefined,
            sortOrder:
              typeof draft.sortOrder === 'number' ? draft.sortOrder : existing.sortOrder,
            updatedAt: now,
          }
          let next: AppStore = {
            ...s,
            protocols: {
              ...protocols,
              items: protocols.items.map((it) => (it.id === id ? row : it)),
            },
          }
          next = appendAudit(next, {
            action: 'protocol_item_upsert',
            detail: `${protocol.number} · п.${row.sortOrder} · ${row.assignmentText.slice(0, 80)}`,
            employeeId: assignees[0],
            ...actor,
          })
          if (prevStatus !== status) {
            next = appendAudit(next, {
              action: 'protocol_item_status',
              detail: `${protocol.number} · п.${row.sortOrder}: ${prevStatus} → ${status}`,
              oldValue: prevStatus,
              newValue: status,
              employeeId: assignees[0],
              ...actor,
            })
          }
          if (
            assignees.join(',') !== existing.assigneeEmployeeIds.join(',')
          ) {
            next = appendAudit(next, {
              action: 'protocol_item_upsert',
              detail: `${protocol.number} · п.${row.sortOrder} ответственные → ${assignees.join(', ') || '—'}`,
              employeeId: assignees[0],
              ...actor,
            })
          }
          return next
        }

        const sameProtocol = protocols.items.filter((it) => it.protocolId === draft.protocolId)
        const sortOrder =
          typeof draft.sortOrder === 'number'
            ? draft.sortOrder
            : sameProtocol.reduce((m, it) => Math.max(m, it.sortOrder), 0) + 1
        id = crypto.randomUUID()
        const row: ProtocolItem = {
          id,
          protocolId: draft.protocolId,
          sortOrder,
          decision: draft.decision.trim(),
          assignmentText: draft.assignmentText.trim(),
          assigneeEmployeeIds: assignees,
          dueDate,
          priority: draft.priority ?? 'normal',
          controllerEmployeeId: draft.controllerEmployeeId || undefined,
          status,
          comment: draft.comment?.trim() || undefined,
          attachmentIds: [],
          ackStatus: 'not_sent',
          updatedAt: now,
        }
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: [...protocols.items, row],
          },
        }
        next = appendAudit(next, {
          action: 'protocol_item_upsert',
          detail: `${protocol.number} · п.${row.sortOrder} · ${row.assignmentText.slice(0, 80)}`,
          employeeId: assignees[0],
          ...actor,
        })
        return next
      })
      return id
    },

    setProtocolItemStatus(
      itemId: string,
      status: ProtocolAssignmentStatus,
    ): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        const nextStatus = deriveAssignmentStatus(status, existing.dueDate)
        if (existing.status === nextStatus && status === nextStatus) {
          // still allow explicit done/cancelled override after overdue derive
        }
        let applied = nextStatus
        if (status === 'done' || status === 'cancelled') applied = status
        else applied = deriveAssignmentStatus(status, existing.dueDate)
        if (existing.status === applied) return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) =>
              it.id === itemId ? { ...it, status: applied, updatedAt: now } : it,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_item_status',
          detail: `${protocol?.number ?? existing.protocolId} · п.${existing.sortOrder}: ${existing.status} → ${applied}`,
          oldValue: existing.status,
          newValue: applied,
          employeeId: existing.assigneeEmployeeIds[0],
          ...actor,
        })
        return next
      })
      return ok
    },

    archiveProtocolItem(itemId: string): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) =>
              it.id === itemId ? { ...it, archived: true, updatedAt: now } : it,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_item_upsert',
          detail: `${protocol?.number ?? ''} · п.${existing.sortOrder} архив`,
          ...actor,
        })
        return next
      })
      return ok
    },

    /** Передать пункт на ознакомление исполнителю */
    sendProtocolItemForAck(
      itemId: string,
      toEmployeeId: string,
      secretaryNote?: string,
    ): boolean {
      let ok = false
      if (!toEmployeeId.trim()) return false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        if (existing.ackLocked) return s
        if (existing.ackStatus === 'acknowledged') return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        const nextStatus: ProtocolAssignmentStatus =
          existing.status === 'done' || existing.status === 'cancelled'
            ? existing.status
            : deriveAssignmentStatus('sent_for_ack', existing.dueDate)
        const note = secretaryNote?.trim() || undefined
        const updated: ProtocolItem = {
          ...existing,
          ackStatus: 'pending',
          ackSentAt: now,
          ackSentToEmployeeId: toEmployeeId,
          secretaryAckNote: note,
          status: nextStatus,
          updatedAt: now,
        }
        const notif = pushProtocolNotification({
          kind: 'ack_sent',
          protocolId: existing.protocolId,
          itemId,
          toEmployeeId,
          title: `${protocol?.number ?? ''} · ознакомление`,
          body: existing.assignmentText.slice(0, 120),
        })
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) => (it.id === itemId ? updated : it)),
            notifications: [notif, ...protocols.notifications].slice(0, 500),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_ack_send',
          detail: `${protocol?.number ?? ''} · п.${existing.sortOrder} → ознакомление`,
          employeeId: toEmployeeId,
          ...actor,
        })
        return next
      })
      return ok
    },

    /** Подтвердить ознакомление (в приложении или бумажный скан уже прикреплён) */
    confirmProtocolItemAck(
      itemId: string,
      opts?: {
        comment?: string
        method?: 'in_app' | 'paper_scan'
        signedAttachmentId?: string
      },
    ): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        if (existing.ackLocked && existing.ackStatus === 'acknowledged') return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        const method = opts?.method ?? 'in_app'
        const nextStatus: ProtocolAssignmentStatus =
          existing.status === 'done' || existing.status === 'cancelled'
            ? existing.status
            : deriveAssignmentStatus('acknowledged', existing.dueDate)
        const attachmentIds =
          opts?.signedAttachmentId && !existing.attachmentIds.includes(opts.signedAttachmentId)
            ? [...existing.attachmentIds, opts.signedAttachmentId]
            : existing.attachmentIds
        const updated: ProtocolItem = {
          ...existing,
          ackStatus: 'acknowledged',
          ackAt: now,
          ackByUserId: actor.by,
          ackByName: actor.byName,
          ackMethod: method,
          ackComment: opts?.comment?.trim() || undefined,
          signedAttachmentId: opts?.signedAttachmentId || existing.signedAttachmentId,
          attachmentIds,
          ackLocked: true,
          status: nextStatus,
          updatedAt: now,
        }
        const notif = pushProtocolNotification({
          kind: 'ack_done',
          protocolId: existing.protocolId,
          itemId,
          toEmployeeId: existing.ackSentToEmployeeId || existing.assigneeEmployeeIds[0],
          title: `${protocol?.number ?? ''} · ознакомлен`,
          body: existing.assignmentText.slice(0, 120),
        })
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) => (it.id === itemId ? updated : it)),
            notifications: [notif, ...protocols.notifications].slice(0, 500),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_ack_confirm',
          detail: `${protocol?.number ?? ''} · п.${existing.sortOrder} · ${method}`,
          employeeId: existing.ackSentToEmployeeId || existing.assigneeEmployeeIds[0],
          ...actor,
        })
        return next
      })
      return ok
    },

    refuseProtocolItemAck(itemId: string, comment?: string): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        if (existing.ackLocked) return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        const updated: ProtocolItem = {
          ...existing,
          ackStatus: 'refused',
          ackAt: now,
          ackByUserId: actor.by,
          ackByName: actor.byName,
          ackComment: comment?.trim() || undefined,
          updatedAt: now,
        }
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) => (it.id === itemId ? updated : it)),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_ack_confirm',
          detail: `${protocol?.number ?? ''} · п.${existing.sortOrder} · отказ`,
          oldValue: existing.ackStatus,
          newValue: 'refused',
          employeeId: existing.ackSentToEmployeeId || existing.assigneeEmployeeIds[0],
          ...actor,
        })
        return next
      })
      return ok
    },

    /** Только sysadmin: снять lock / исправить ознакомление с причиной */
    adminFixProtocolItemAck(
      itemId: string,
      fix: {
        reason: string
        ackStatus?: ProtocolItem['ackStatus']
        unlock?: boolean
        clearAck?: boolean
      },
    ): boolean {
      let ok = false
      const reason = fix.reason.trim()
      if (!reason) return false
      patchStore(setStore, (s) => {
        if (!actorIsSysadmin(s)) return s
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        const existing = protocols.items.find((it) => it.id === itemId)
        if (!existing || existing.archived) return s
        ok = true
        const protocol = protocols.protocols.find((p) => p.id === existing.protocolId)
        const now = new Date().toISOString()
        const actor = who()
        let updated: ProtocolItem = { ...existing, updatedAt: now }
        if (fix.unlock) updated = { ...updated, ackLocked: false }
        if (fix.clearAck) {
          updated = {
            ...updated,
            ackStatus: 'not_sent',
            ackAt: undefined,
            ackByUserId: undefined,
            ackByName: undefined,
            ackMethod: undefined,
            ackComment: undefined,
            ackLocked: false,
            status:
              existing.status === 'done' || existing.status === 'cancelled'
                ? existing.status
                : deriveAssignmentStatus('new', existing.dueDate),
          }
        } else if (fix.ackStatus) {
          updated = {
            ...updated,
            ackStatus: fix.ackStatus,
            ackLocked: fix.ackStatus === 'acknowledged' ? true : updated.ackLocked,
          }
        }
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            items: protocols.items.map((it) => (it.id === itemId ? updated : it)),
          },
        }
        next = appendAudit(next, {
          action: 'protocol_ack_admin_fix',
          detail: `${protocol?.number ?? ''} · п.${existing.sortOrder}: ${reason}`,
          oldValue: existing.ackStatus,
          newValue: updated.ackStatus,
          ...actor,
        })
        return next
      })
      return ok
    },

    registerProtocolAttachment(attachment: ProtocolAttachment): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const protocols = normalizeProtocolsStore(s.protocols ?? createDefaultProtocolsStore())
        if (protocols.attachments.some((a) => a.id === attachment.id)) return s
        ok = true
        const actor = who()
        const ownerItems =
          attachment.ownerKind === 'item'
            ? protocols.items.map((it) =>
                it.id === attachment.ownerId
                  ? {
                      ...it,
                      attachmentIds: [...new Set([...it.attachmentIds, attachment.id])],
                      signedAttachmentId:
                        attachment.kind === 'signed_ack'
                          ? attachment.id
                          : it.signedAttachmentId,
                      updatedAt: new Date().toISOString(),
                    }
                  : it,
              )
            : protocols.items
        const ownerProtocols =
          attachment.ownerKind === 'protocol'
            ? protocols.protocols.map((p) =>
                p.id === attachment.ownerId
                  ? {
                      ...p,
                      attachmentIds: [...new Set([...p.attachmentIds, attachment.id])],
                      updatedAt: new Date().toISOString(),
                    }
                  : p,
              )
            : protocols.protocols
        let next: AppStore = {
          ...s,
          protocols: {
            ...protocols,
            attachments: [...protocols.attachments, attachment],
            items: ownerItems,
            protocols: ownerProtocols,
          },
        }
        next = appendAudit(next, {
          action: 'protocol_attach',
          detail: `${attachment.fileName} · ${attachment.kind ?? 'general'}`,
          ...actor,
        })
        return next
      })
      return ok
    },
  }
}

function pushProtocolNotification(input: {
  kind: ProtocolNotificationKind
  protocolId: string
  itemId?: string
  toEmployeeId?: string
  title: string
  body?: string
}): ProtocolNotification {
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    protocolId: input.protocolId,
    itemId: input.itemId,
    toEmployeeId: input.toEmployeeId,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
  }
}
