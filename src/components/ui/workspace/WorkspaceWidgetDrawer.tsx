import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/context/I18nContext'

type Props = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  widthClass?: string
}

const WIDGET_Z = 90

export function WorkspaceWidgetDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  widthClass = 'w-full max-w-md sm:max-w-lg',
}: Props) {
  const { t } = useI18n()
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="workspace-widget-root print:hidden" style={{ zIndex: WIDGET_Z }}>
      <button
        type="button"
        className="workspace-widget-backdrop"
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${panelId}-title`}
        className={`workspace-widget-panel ${widthClass}`}
      >
        <header className="workspace-widget-panel__head">
          <div className="min-w-0">
            <h2 id={`${panelId}-title`} className="workspace-widget-panel__title">
              {title}
            </h2>
            {subtitle ? (
              <p className="workspace-widget-panel__subtitle">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="workspace-widget-panel__close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </header>
        <div className="workspace-widget-panel__body">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
