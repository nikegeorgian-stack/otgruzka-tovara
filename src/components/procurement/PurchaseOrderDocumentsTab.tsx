import { useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import {
  formatAttachmentSize,
  MAX_ATTACHMENTS_PER_ORDER,
  readOrderAttachment,
} from '@/lib/procurement/attachments'
import type { PurchaseOrderAttachment, PurchaseOrderAttachmentKind } from '@/lib/procurement/types'

const KINDS: PurchaseOrderAttachmentKind[] = [
  'contract',
  'invoice',
  'packing_list',
  'specification',
  'correspondence',
  'customs',
  'scan',
  'other',
]

type Props = {
  attachments: PurchaseOrderAttachment[]
  onChange: (attachments: PurchaseOrderAttachment[]) => void
}

export function PurchaseOrderDocumentsTab({ attachments, onChange }: Props) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [defaultKind, setDefaultKind] = useState<PurchaseOrderAttachmentKind>('scan')

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    if (attachments.length >= MAX_ATTACHMENTS_PER_ORDER) {
      setError(t('procurement.attach.max'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const next = [...attachments]
      for (const file of Array.from(files)) {
        if (next.length >= MAX_ATTACHMENTS_PER_ORDER) break
        try {
          const att = await readOrderAttachment(file, defaultKind)
          next.push(att)
        } catch (e) {
          const code = e instanceof Error ? e.message : ''
          setError(
            code === 'file_too_large'
              ? t('procurement.attach.tooLarge')
              : t('procurement.attach.typeError'),
          )
        }
      }
      onChange(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500">{t('procurement.attach.hint')}</p>

      {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-teal-200 bg-teal-50/40 p-4">
        <label className="text-xs font-semibold text-stone-600">
          {t('procurement.attach.defaultKind')}
          <select
            className="mt-1 block rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={defaultKind}
            onChange={(e) => setDefaultKind(e.target.value as PurchaseOrderAttachmentKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`procurement.attach.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
        >
          {busy ? t('procurement.attach.uploading') : t('procurement.attach.add')}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            void onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <p className="text-xs text-stone-500">
          {attachments.length}/{MAX_ATTACHMENTS_PER_ORDER} · {t('procurement.attach.limit')}
        </p>
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-stone-400">{t('procurement.attach.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex flex-wrap items-center gap-3 rounded-sm border border-grid bg-white px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{att.name}</p>
                <p className="text-[11px] text-stone-400">
                  {formatAttachmentSize(att.sizeBytes)} ·{' '}
                  {new Date(att.uploadedAt).toLocaleString('ru-RU')}
                </p>
              </div>
              <select
                className="rounded-sm border border-grid px-2 py-1 text-xs"
                value={att.kind}
                onChange={(e) =>
                  onChange(
                    attachments.map((a) =>
                      a.id === att.id
                        ? { ...a, kind: e.target.value as PurchaseOrderAttachmentKind }
                        : a,
                    ),
                  )
                }
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`procurement.attach.kind.${k}`)}
                  </option>
                ))}
              </select>
              <a
                href={att.dataUrl}
                download={att.name}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-teal-700 hover:underline"
              >
                {t('procurement.attach.open')}
              </a>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => onChange(attachments.filter((a) => a.id !== att.id))}
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
