import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import type {
  ProtocolAssignmentStatus,
  ProtocolItem,
  ProtocolPriority,
} from '@/lib/protocols/types'
import type { ProtocolItemDraft } from '@/store/slices/protocolsSlice'
import type { AppStore } from '@/lib/types'

const STATUSES: ProtocolAssignmentStatus[] = [
  'new',
  'sent_for_ack',
  'acknowledged',
  'in_progress',
  'done',
  'overdue',
  'cancelled',
]

const PRIOS: ProtocolPriority[] = ['low', 'normal', 'high', 'urgent']

type Props = {
  open: boolean
  store: AppStore
  protocolId: string
  item: ProtocolItem | null
  onClose: () => void
  onSave: (draft: ProtocolItemDraft) => void
}

export function ProtocolItemEditorDialog({
  open,
  store,
  protocolId,
  item,
  onClose,
  onSave,
}: Props) {
  const { t, locale } = useI18n()
  const employees = store.employees.filter((e) => e.active && e.hrStatus !== 'fired')
  const [dirty, setDirty] = useState(false)
  const [decision, setDecision] = useState('')
  const [assignmentText, setAssignmentText] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<ProtocolPriority>('normal')
  const [controllerId, setControllerId] = useState<string | null>(null)
  const [status, setStatus] = useState<ProtocolAssignmentStatus>('new')
  const [comment, setComment] = useState('')
  const [pickAssignee, setPickAssignee] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDirty(false)
    setDecision(item?.decision ?? '')
    setAssignmentText(item?.assignmentText ?? '')
    setAssignees(item?.assigneeEmployeeIds ?? [])
    setDueDate(item?.dueDate ?? '')
    setPriority(item?.priority ?? 'normal')
    setControllerId(item?.controllerEmployeeId ?? null)
    setStatus(item?.status ?? 'new')
    setComment(item?.comment ?? '')
    setPickAssignee(null)
  }, [open, item])

  const mark = () => setDirty(true)

  const save = () => {
    onSave({
      id: item?.id,
      protocolId,
      decision: decision.trim(),
      assignmentText: assignmentText.trim(),
      assigneeEmployeeIds: assignees,
      dueDate: dueDate || undefined,
      priority,
      controllerEmployeeId: controllerId ?? undefined,
      status,
      comment: comment.trim() || undefined,
      sortOrder: item?.sortOrder,
    })
    setDirty(false)
    onClose()
  }

  const empLabel = (id: string) => {
    const e = store.employees.find((x) => x.id === id)
    return e ? employeeName(e, locale) : id.slice(0, 8)
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={item ? t('protocols.item.edit') : t('protocols.item.create')}
      size="xl"
      dirty={dirty}
      onSaveDirty={save}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">{t('protocols.item.decision')}</span>
          <textarea
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            rows={2}
            value={decision}
            onChange={(e) => {
              setDecision(e.target.value)
              mark()
            }}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">{t('protocols.item.assignment')}</span>
          <textarea
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            rows={3}
            value={assignmentText}
            onChange={(e) => {
              setAssignmentText(e.target.value)
              mark()
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">{t('protocols.item.dueDate')}</span>
          <input
            type="date"
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value)
              mark()
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">{t('protocols.item.priority')}</span>
          <select
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as ProtocolPriority)
              mark()
            }}
          >
            {PRIOS.map((p) => (
              <option key={p} value={p}>
                {t(`protocols.priority.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">{t('protocols.item.status')}</span>
          <select
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ProtocolAssignmentStatus)
              mark()
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`protocols.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm">
          <span className="text-stone-600">{t('protocols.item.controller')}</span>
          <div className="mt-1">
            <EmployeePicker
              employees={employees}
              value={controllerId}
              onChange={(id) => {
                setControllerId(id)
                mark()
              }}
            />
          </div>
        </div>
        <div className="sm:col-span-2 text-sm">
          <span className="text-stone-600">{t('protocols.item.assignees')}</span>
          <ul className="mt-1 flex flex-wrap gap-2">
            {assignees.map((id) => (
              <li
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs"
              >
                {empLabel(id)}
                <button
                  type="button"
                  className="text-stone-500 hover:text-rose-600"
                  onClick={() => {
                    setAssignees((a) => a.filter((x) => x !== id))
                    mark()
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 max-w-sm">
            <EmployeePicker
              employees={employees.filter((e) => !assignees.includes(e.id))}
              value={pickAssignee}
              placeholder={t('protocols.item.addAssignee')}
              onChange={(id) => {
                if (!id) return
                setAssignees((a) => (a.includes(id) ? a : [...a, id]))
                setPickAssignee(null)
                mark()
              }}
            />
          </div>
        </div>
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">{t('protocols.item.comment')}</span>
          <textarea
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            rows={2}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value)
              mark()
            }}
          />
        </label>
      </div>
    </AppDialog>
  )
}
