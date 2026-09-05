import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope, type ModalInitialFocus } from '@/hooks/useModalScope'
import { useWindowChrome } from '@/hooks/useWindowChrome'
import { CHROME_BACKDROP_CLASS } from '@/lib/ui/chromeLayout'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl' | 'preview'
  zIndex?: number
  blockBackdropClose?: boolean
  accent?: boolean
  onPrimaryAction?: () => void
  disableEnterSubmit?: boolean
  initialFocus?: ModalInitialFocus
  /** Сворачивание в панель (по умолчанию — да, если есть провайдер). */
  minimizable?: boolean
  /** Системный диалог: без сворачивания, закрытие по фону. */
  ephemeral?: boolean
  /** Есть несохранённые изменения — спросить при закрытии крестиком. */
  dirty?: boolean
  /** Сохранить при выборе «Сохранить» в диалоге несохранённых. */
  onSaveDirty?: () => void | Promise<void>
}

const WIDTH = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  preview: 'max-w-[min(98vw,1400px)]',
} as const

export function AppDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'lg',
  zIndex: zIndexProp = 420,
  blockBackdropClose = false,
  accent = false,
  onPrimaryAction,
  disableEnterSubmit = false,
  initialFocus = 'first',
  minimizable,
  ephemeral = false,
  dirty = false,
  onSaveDirty,
}: Props) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLDivElement>(null)

  const {
    visible,
    canMinimize,
    handleMinimize,
    requestClose,
    onBackdropInteract,
  } = useWindowChrome({
    open,
    title,
    onClose,
    dirty,
    onSaveDirty,
    minimizable,
    ephemeral,
  })

  const { zIndex: stackZIndex } = useModalScope({
    open: visible,
    onClose: () => {
      void requestClose()
    },
    containerRef: panelRef,
    onPrimaryAction,
    disableEnterSubmit,
    initialFocus,
  })
  const zIndex = Math.max(zIndexProp, stackZIndex)

  const onBackdropMouseDown = useCallback(
    (e: MouseEvent) => {
      if (blockBackdropClose) return
      if (e.target !== e.currentTarget) return
      onBackdropInteract()
    },
    [blockBackdropClose, onBackdropInteract],
  )

  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [visible])

  if (!visible) return null

  return createPortal(
    <div
      className={CHROME_BACKDROP_CLASS}
      style={{ zIndex }}
      role="presentation"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className={`app-dialog-panel flex w-full flex-col overflow-hidden rounded-t-sm border bg-white shadow-sm sm:rounded-sm ${accent ? 'app-dialog-panel-accent' : 'border-grid'} ${WIDTH[size]}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-grid bg-stone-50 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id="app-dialog-title" className="text-base font-bold tracking-tight text-ink sm:text-lg">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-sm leading-snug text-stone-500">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canMinimize && (
              <button
                type="button"
                className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
                aria-label={t('workspace.minimize')}
                title={t('workspace.minimize')}
                onClick={handleMinimize}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path
                    d="M4 14h12"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
              aria-label={t('common.close')}
              onClick={() => {
                void requestClose()
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="app-dialog-body">{children}</div>

        {footer && (
          <footer className="app-dialog-footer border-t border-grid bg-stone-50 px-4 pt-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
