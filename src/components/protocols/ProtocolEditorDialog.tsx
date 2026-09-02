import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import type { MeetingProtocol } from '@/lib/protocols/types'
import type { ProtocolDraft } from '@/store/slices/protocolsSlice'
import type { AppStore } from '@/lib/types'

type Props = {
  open: boolean
  store: AppStore
  protocol: MeetingProtocol | null
  defaultSecretaryEmployeeId?: string
  onClose: () => void
  onSave: (draft: ProtocolDraft) => void
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(local: string): string {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

export function ProtocolEditorDialog({
  open,
  store,
  protocol,
  defaultSecretaryEmployeeId,
  onClose,
  onSave,
}: Props) {
  const { t, locale } = useI18n()
  const employees = store.employees.filter((e) => e.active && e.hrStatus !== 'fired')
  const [dirty, setDirty] = useState(false)
  const [meetingLocal, setMeetingLocal] = useState('')
  const [topic, setTopic] = useState('')
  const [place, setPlace] = useState('')
  const [chairId, setChairId] = useState<string | null>(null)
  const [secretaryId, setSecretaryId] = useState<string | null>(null)
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [pickParticipant, setPickParticipant] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDirty(false)
    setMeetingLocal(toLocalInput(protocol?.meetingAt ?? new Date().toISOString()))
    setTopic(protocol?.topic ?? '')
    setPlace(protocol?.place ?? '')
    setChairId(protocol?.chairEmployeeId ?? null)
    setSecretaryId(protocol?.secretaryEmployeeId ?? defaultSecretaryEmployeeId ?? null)
    setParticipantIds(protocol?.participantEmployeeIds ?? [])
    setNotes(protocol?.notes ?? '')
    setPickParticipant(null)
  }, [open, protocol, defaultSecretaryEmployeeId])

  const mark = () => setDirty(true)

  const save = () => {
    onSave({
      id: protocol?.id,
      meetingAt: fromLocalInput(meetingLocal),
      topic: topic.trim() || t('protocols.untitled'),
      place: place.trim() || undefined,
      chairEmployeeId: chairId ?? undefined,
      secretaryEmployeeId: secretaryId ?? undefined,
      participantEmployeeIds: participantIds,
      notes: notes.trim() || undefined,
    })
    setDirty(false)
    onClose()
  }

  const addParticipant = (id: string | null) => {
    if (!id) return
    setParticipantIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setPickParticipant(null)
    mark()
  }

  const empLabel = (id: string) => {
    const e = store.employees.find((x) => x.id === id)
    return e ? employeeName(e, locale) : id.slice(0, 8)
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={protocol ? t('protocols.editTitle') : t('protocols.createTitle')}
      subtitle={protocol?.number}
      size="xl"
      dirty={dirty}
      onSaveDirty={save}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={save} data-coach="protocols:save">
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">{t('protocols.field.topic')}</span>
          <input
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value)
              mark()
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">{t('protocols.field.meetingAt')}</span>
          <input
            type="datetime-local"
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={meetingLocal}
            onChange={(e) => {
              setMeetingLocal(e.target.value)
              mark()
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">{t('protocols.field.place')}</span>
          <input
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            value={place}
            onChange={(e) => {
              setPlace(e.target.value)
              mark()
            }}
          />
        </label>
        <div className="text-sm">
          <span className="text-stone-600">{t('protocols.field.chair')}</span>
          <div className="mt-1">
            <EmployeePicker
              employees={employees}
              value={chairId}
              onChange={(id) => {
                setChairId(id)
                mark()
              }}
            />
          </div>
        </div>
        <div className="text-sm">
          <span className="text-stone-600">{t('protocols.field.secretary')}</span>
          <div className="mt-1">
            <EmployeePicker
              employees={employees}
              value={secretaryId}
              onChange={(id) => {
                setSecretaryId(id)
                mark()
              }}
            />
          </div>
        </div>
        <div className="sm:col-span-2 text-sm">
          <span className="text-stone-600">{t('protocols.field.participants')}</span>
          <ul className="mt-1 flex flex-wrap gap-2">
            {participantIds.map((id) => (
              <li
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs"
              >
                {empLabel(id)}
                <button
                  type="button"
                  className="text-stone-500 hover:text-rose-600"
                  onClick={() => {
                    setParticipantIds((p) => p.filter((x) => x !== id))
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
              employees={employees.filter((e) => !participantIds.includes(e.id))}
              value={pickParticipant}
              placeholder={t('protocols.addParticipant')}
              onChange={addParticipant}
            />
          </div>
        </div>
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">{t('protocols.field.notes')}</span>
          <textarea
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5"
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              mark()
            }}
          />
        </label>
      </div>
    </AppDialog>
  )
}
