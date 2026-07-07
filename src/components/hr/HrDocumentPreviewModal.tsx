import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { isGoogleDriveUrl, resolveDocumentPreview } from '@/lib/hr/documentPreview'
import type { HrDocument } from '@/lib/hr/types'

type Props = {
  doc: HrDocument
  onClose: () => void
}

export function HrDocumentPreviewModal({ doc, onClose }: Props) {
  const { t } = useI18n()
  const url = doc.fileUrl ?? ''
  const preview = resolveDocumentPreview(url)
  const google = isGoogleDriveUrl(url)

  return (
    <AppDialog
      open
      onClose={onClose}
      title={doc.title}
      subtitle={doc.docType}
      size="preview"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {google && (
            <p className="text-xs text-stone-500">{t('hr.document.googleHint')}</p>
          )}
          <div className="ml-auto flex gap-2">
            {url.startsWith('data:') && (
              <a
                href={url}
                download={doc.fileName || doc.title}
                className="inline-flex items-center rounded-sm border border-grid px-3 py-1.5 text-sm font-medium hover:bg-white"
              >
                {t('hr.document.download')}
              </a>
            )}
            {(google || preview.kind === 'external') && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-sm border border-grid px-3 py-1.5 text-sm font-medium hover:bg-white"
              >
                {google ? t('hr.document.openInDrive') : t('hr.document.openInBrowser')}
              </a>
            )}
            <Button variant="primary" size="sm" type="button" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex min-h-[min(72vh,780px)] flex-col bg-stone-100">
        {(preview.kind === 'google-embed' || preview.kind === 'pdf-data') && (
          <iframe
            src={preview.src}
            title={doc.title}
            className="min-h-0 flex-1 w-full border-0 bg-white"
            allow="autoplay"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
        {preview.kind === 'image' && (
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={preview.src}
              alt={doc.title}
              className="max-h-[min(72vh,780px)] max-w-full object-contain shadow-sm"
            />
          </div>
        )}
        {preview.kind === 'external' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="max-w-md text-sm text-stone-600">{t('hr.document.previewUnavailable')}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-accent hover:underline"
            >
              {t('hr.document.openInBrowser')}
            </a>
          </div>
        )}
      </div>
    </AppDialog>
  )
}
