import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { fileToDataUrl } from '@/lib/hr/files'
import { isAllowedHrDocumentHost, isGoogleDriveUrl } from '@/lib/hr/documentPreview'

export const HR_ATTACH_MAX_BYTES = 3 * 1024 * 1024

const HR_ATTACH_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export type HrAttachmentValue = {
  /** Все вложения: data URL файла и/или http(s) ссылки (Drive и др.). */
  urls: string[]
  fileName?: string
}

type Props = {
  value: HrAttachmentValue
  onChange: (next: HrAttachmentValue) => void
  hintKey?: string
  /** Разрешить несколько ссылок (по умолчанию да). */
  allowMultiple?: boolean
}

function normalizeUrls(urls: string[]): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const u = raw.trim()
    if (!u || out.includes(u)) continue
    out.push(u)
  }
  return out
}

/**
 * Вложение: файл с компьютера (data URL) и/или одна/несколько ссылок (обычно Google Drive).
 */
export function HrAttachmentField({
  value,
  onChange,
  hintKey,
  allowMultiple = true,
}: Props) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setFieldError(null)
    if (file.size > HR_ATTACH_MAX_BYTES) {
      setFieldError(t('hr.attach.errTooLarge'))
      return
    }
    if (file.type && !HR_ATTACH_MIME.has(file.type) && !file.type.startsWith('image/')) {
      setFieldError(t('hr.attach.errType'))
      return
    }
    setBusy(true)
    try {
      const url = await fileToDataUrl(file)
      const withoutData = value.urls.filter((u) => !u.startsWith('data:'))
      onChange({
        urls: normalizeUrls([...withoutData, url]),
        fileName: file.name,
      })
    } finally {
      setBusy(false)
    }
  }

  function addLink() {
    const url = linkDraft.trim()
    if (!url) return
    setFieldError(null)
    if (!isAllowedHrDocumentHost(url) || !isGoogleDriveUrl(url)) {
      setFieldError(t('hr.attach.errLinkHost'))
      return
    }
    if (!allowMultiple) {
      const withoutHttp = value.urls.filter((u) => !u.startsWith('http'))
      onChange({ urls: normalizeUrls([...withoutHttp, url]), fileName: value.fileName })
    } else {
      onChange({ urls: normalizeUrls([...value.urls, url]), fileName: value.fileName })
    }
    setLinkDraft('')
  }

  function removeUrl(url: string) {
    const next = value.urls.filter((u) => u !== url)
    const clearedFile = url.startsWith('data:')
    onChange({
      urls: next,
      fileName: clearedFile ? undefined : value.fileName,
    })
  }

  function clearAll() {
    onChange({ urls: [], fileName: undefined })
    setLinkDraft('')
    setFieldError(null)
  }

  return (
    <div className="space-y-2 rounded-md border border-stone-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {t('hr.attach.title')}
      </p>
      <p className="text-[11px] text-stone-500">{t(hintKey ?? 'hr.attach.hint')}</p>

      <label className="block text-[11px] font-medium text-stone-500">
        {t('hr.attach.file')}
        <input
          type="file"
          accept="image/*,.pdf,application/pdf"
          disabled={busy}
          className="mt-1 block w-full text-sm"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-[11px] font-medium text-stone-500">
          {allowMultiple ? t('hr.attach.linkAdd') : t('hr.attach.link')}
          <input
            className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-2 text-sm"
            value={linkDraft}
            placeholder={t('hr.attach.linkPh')}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink()
              }
            }}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-stone-200 px-3 py-2 text-xs font-semibold hover:bg-stone-50"
          onClick={addLink}
        >
          {allowMultiple ? t('hr.attach.addLink') : t('hr.attach.applyLink')}
        </button>
      </div>

      {fieldError && (
        <p className="text-[11px] font-medium text-red-700" role="alert">
          {fieldError}
        </p>
      )}

      {value.urls.length > 0 && (
        <ul className="space-y-1.5">
          {value.urls.map((url) => {
            const isDrive = isGoogleDriveUrl(url)
            const isData = url.startsWith('data:')
            const label = isDrive
              ? t('hr.attach.driveOk')
              : isData
                ? value.fileName || t('hr.attach.fileOk')
                : url.slice(0, 72)
            return (
              <li
                key={url.slice(0, 80)}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-100 bg-emerald-50/60 px-2.5 py-1.5 text-xs text-emerald-900"
              >
                <span className="min-w-0 truncate" title={isData ? value.fileName : url}>
                  {label}
                </span>
                <button
                  type="button"
                  className="shrink-0 font-semibold underline"
                  onClick={() => removeUrl(url)}
                >
                  {t('hr.attach.clear')}
                </button>
              </li>
            )
          })}
          {value.urls.length > 1 && (
            <li>
              <button
                type="button"
                className="text-[11px] font-semibold text-stone-500 underline"
                onClick={clearAll}
              >
                {t('hr.attach.clearAll')}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Собрать urls из старых полей договора. */
export function attachmentValueFromContract(c: {
  documentUrl?: string
  documentUrls?: string[]
  documentFileName?: string
}): HrAttachmentValue {
  const urls = normalizeUrls([...(c.documentUrls ?? []), c.documentUrl ?? ''])
  return { urls, fileName: c.documentFileName }
}

export function contractFieldsFromAttachment(v: HrAttachmentValue): {
  documentUrl?: string
  documentUrls?: string[]
  documentFileName?: string
} {
  const urls = normalizeUrls(v.urls)
  return {
    documentUrl: urls[0],
    documentUrls: urls.length > 0 ? urls : undefined,
    documentFileName: v.fileName,
  }
}
