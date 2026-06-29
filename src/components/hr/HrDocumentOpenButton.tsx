import { useState, type MouseEvent } from 'react'
import { HrDocumentPreviewModal } from '@/components/hr/HrDocumentPreviewModal'
import { useI18n } from '@/context/I18nContext'
import type { HrDocument } from '@/lib/hr/types'

type Props = {
  doc: HrDocument
  className?: string
  /** Текст кнопки (по умолчанию «Открыть») */
  label?: string
  /** Компактная иконка-ссылка без текста */
  compact?: boolean
  onClick?: (e: MouseEvent) => void
}

export function HrDocumentOpenButton({ doc, className = '', label, compact, onClick }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  if (!doc.fileUrl) return null

  const text = label ?? (compact ? '↗' : t('hr.document.open'))

  return (
    <>
      <button
        type="button"
        className={
          className ||
          'text-xs font-semibold text-accent hover:underline'
        }
        title={doc.title}
        onClick={(e) => {
          onClick?.(e)
          setOpen(true)
        }}
      >
        {compact ? '↗' : text}
      </button>
      {open && <HrDocumentPreviewModal doc={doc} onClose={() => setOpen(false)} />}
    </>
  )
}
