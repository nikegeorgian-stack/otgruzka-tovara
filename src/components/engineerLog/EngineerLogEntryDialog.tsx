import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { VoiceDictationButton } from '@/components/engineerLog/VoiceDictationButton'
import { useI18n } from '@/context/I18nContext'
import type { EngineerLogDraft } from '@/lib/engineerLog/init'
import {
  ENGINEER_LOG_KINDS,
  type EngineerLogChecklistItem,
  type EngineerLogEntryKind,
  type EngineerLogSeverity,
  type EngineerLogStatus,
} from '@/lib/engineerLog/types'

type Props = {
  draft: EngineerLogDraft
  onClose: () => void
  onSave: (draft: EngineerLogDraft) => void
}

function tagsToText(tags: string[]): string {
  return tags.join(', ')
}

function textToTags(raw: string): string[] {
  return raw
    .split(/[,;#]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function EngineerLogEntryDialog({ draft, onClose, onSave }: Props) {
  const { t } = useI18n()
  const [kind, setKind] = useState<EngineerLogEntryKind>(draft.kind)
  const [date, setDate] = useState(draft.date)
  const [title, setTitle] = useState(draft.title)
  const [body, setBody] = useState(draft.body)
  const [tagsText, setTagsText] = useState(tagsToText(draft.tags))
  const [area, setArea] = useState(draft.area ?? '')
  const [equipment, setEquipment] = useState(draft.equipment ?? '')
  const [severity, setSeverity] = useState<EngineerLogSeverity | ''>(draft.severity ?? '')
  const [status, setStatus] = useState<EngineerLogStatus | ''>(draft.status ?? '')
  const [pinned, setPinned] = useState(Boolean(draft.pinned))
  const [checklist, setChecklist] = useState<EngineerLogChecklistItem[]>(draft.checklist ?? [])
  const [newItem, setNewItem] = useState('')

  const baseline = useMemo(
    () =>
      JSON.stringify({
        kind: draft.kind,
        date: draft.date,
        title: draft.title,
        body: draft.body,
        tags: draft.tags,
        area: draft.area ?? '',
        equipment: draft.equipment ?? '',
        severity: draft.severity ?? '',
        status: draft.status ?? '',
        pinned: Boolean(draft.pinned),
        checklist: draft.checklist ?? [],
      }),
    [draft],
  )

  const current = JSON.stringify({
    kind,
    date,
    title,
    body,
    tags: textToTags(tagsText),
    area,
    equipment,
    severity,
    status,
    pinned,
    checklist,
  })
  const dirty = current !== baseline

  function save() {
    const trimmedTitle = title.trim() || t(`engineerLog.kind.${kind}`)
    onSave({
      id: draft.id,
      createdAt: draft.createdAt,
      kind,
      date,
      title: trimmedTitle,
      body,
      tags: textToTags(tagsText),
      area: area.trim() || undefined,
      equipment: equipment.trim() || undefined,
      severity: severity || undefined,
      status: status || undefined,
      pinned,
      checklist: checklist.length ? checklist : undefined,
      authorId: draft.authorId,
      authorName: draft.authorName,
    })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={draft.id ? t('engineerLog.editTitle') : t('engineerLog.newTitle')}
      subtitle={t(`engineerLog.kind.${kind}`)}
      size="lg"
      dirty={dirty}
      onSaveDirty={save}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-9 cursor-pointer rounded-sm border border-grid bg-surface px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-paper"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="h-9 cursor-pointer rounded-sm bg-accent px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-accent-hover"
            onClick={save}
          >
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-3 px-1 py-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.kind')}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as EngineerLogEntryKind)}
              className="mt-1 h-10 w-full rounded-sm border border-grid bg-surface px-2 text-sm outline-none focus:border-accent"
            >
              {ENGINEER_LOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`engineerLog.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.date')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-ink-muted">
          {t('engineerLog.field.title')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            placeholder={t('engineerLog.field.titlePh')}
          />
        </label>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink-muted">{t('engineerLog.field.body')}</span>
            <VoiceDictationButton
              onText={(chunk) =>
                setBody((prev) => {
                  const next = chunk.trim()
                  if (!next) return prev
                  return prev.trim() ? `${prev.trim()} ${next}` : next
                })
              }
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            placeholder={t('engineerLog.field.bodyPh')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.area')}
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.equipment')}
            <input
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.severity')}
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as EngineerLogSeverity | '')}
              className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">—</option>
              <option value="info">{t('engineerLog.severity.info')}</option>
              <option value="watch">{t('engineerLog.severity.watch')}</option>
              <option value="critical">{t('engineerLog.severity.critical')}</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-ink-muted">
            {t('engineerLog.field.status')}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as EngineerLogStatus | '')}
              className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">—</option>
              <option value="open">{t('engineerLog.status.open')}</option>
              <option value="done">{t('engineerLog.status.done')}</option>
              <option value="deferred">{t('engineerLog.status.deferred')}</option>
            </select>
          </label>
        </div>

        <label className="block text-xs font-medium text-ink-muted">
          {t('engineerLog.field.tags')}
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="mt-1 w-full rounded-sm border border-grid bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
            placeholder={t('engineerLog.field.tagsPh')}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          {t('engineerLog.pin')}
        </label>

        <div>
          <p className="text-xs font-medium text-ink-muted">{t('engineerLog.field.checklist')}</p>
          <ul className="mt-2 space-y-1.5">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.done}
                  onChange={() =>
                    setChecklist((list) =>
                      list.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)),
                    )
                  }
                />
                <input
                  value={c.text}
                  onChange={(e) =>
                    setChecklist((list) =>
                      list.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)),
                    )
                  }
                  className="min-w-0 flex-1 rounded-sm border border-grid px-2 py-1 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  className="text-xs text-rose-600"
                  onClick={() => setChecklist((list) => list.filter((x) => x.id !== c.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder={t('engineerLog.field.checklistPh')}
              className="min-w-0 flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const text = newItem.trim()
                  if (!text) return
                  setChecklist((list) => [...list, { id: crypto.randomUUID(), text, done: false }])
                  setNewItem('')
                }
              }}
            />
            <button
              type="button"
              className="cursor-pointer rounded-sm border border-grid px-3 text-sm hover:bg-paper"
              onClick={() => {
                const text = newItem.trim()
                if (!text) return
                setChecklist((list) => [...list, { id: crypto.randomUUID(), text, done: false }])
                setNewItem('')
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </AppDialog>
  )
}
