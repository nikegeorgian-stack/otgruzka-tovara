import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type ConfirmOptions = {
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Деструктивное действие — кнопка подтверждения красная. */
  danger?: boolean
}

type AlertOptions = {
  title?: string
  message: ReactNode
  okLabel?: string
}

type ConfirmContextValue = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  alert: (opts: AlertOptions) => Promise<void>
  /** Несохранённые изменения: save | discard | cancel */
  confirmUnsaved: (opts?: {
    title?: string
    message?: string
    saveLabel?: string
    discardLabel?: string
    cancelLabel?: string
  }) => Promise<'save' | 'discard' | 'cancel'>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOptions }
  | { kind: 'alert'; opts: AlertOptions }
  | {
      kind: 'unsaved'
      opts: {
        title?: string
        message?: string
        saveLabel?: string
        discardLabel?: string
        cancelLabel?: string
      }
    }
  | null

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<DialogState>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)
  const unsavedResolverRef = useRef<((value: 'save' | 'discard' | 'cancel') => void) | null>(null)

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setState(null)
  }, [])

  const closeUnsaved = useCallback((result: 'save' | 'discard' | 'cancel') => {
    unsavedResolverRef.current?.(result)
    unsavedResolverRef.current = null
    setState(null)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setState({ kind: 'confirm', opts })
    })
  }, [])

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve()
      setState({ kind: 'alert', opts })
    })
  }, [])

  const confirmUnsaved = useCallback(
    (opts?: {
      title?: string
      message?: string
      saveLabel?: string
      discardLabel?: string
      cancelLabel?: string
    }) => {
      return new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
        unsavedResolverRef.current = resolve
        setState({ kind: 'unsaved', opts: opts ?? {} })
      })
    },
    [],
  )

  const value = useMemo(
    () => ({ confirm, alert, confirmUnsaved }),
    [confirm, alert, confirmUnsaved],
  )

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state?.kind === 'confirm' && (
        <AppDialog
          open
          size="md"
          onClose={() => close(false)}
          title={state.opts.title ?? t('common.confirmTitle')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button
                variant={state.opts.danger ? 'danger' : 'primary'}
                size="sm"
                onClick={() => close(true)}
              >
                {state.opts.confirmLabel ?? t('common.confirm')}
              </Button>
            </div>
          }
        >
          <div className="px-5 py-4 text-sm leading-relaxed text-ink whitespace-pre-line">
            {state.opts.message}
          </div>
        </AppDialog>
      )}
      {state?.kind === 'alert' && (
        <AppDialog
          open
          size="md"
          onClose={() => close(true)}
          title={state.opts.title ?? t('common.notice')}
          footer={
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => close(true)}>
                {state.opts.okLabel ?? t('common.ok')}
              </Button>
            </div>
          }
        >
          <div className="px-5 py-4 text-sm leading-relaxed text-ink whitespace-pre-line">
            {state.opts.message}
          </div>
        </AppDialog>
      )}
      {state?.kind === 'unsaved' && (
        <AppDialog
          open
          size="md"
          blockBackdropClose
          disableEnterSubmit
          onClose={() => closeUnsaved('cancel')}
          title={state.opts.title ?? t('common.unsavedTitle')}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => closeUnsaved('cancel')}>
                {state.opts.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => closeUnsaved('discard')}>
                {state.opts.discardLabel ?? t('common.discardChanges')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => closeUnsaved('save')}>
                {state.opts.saveLabel ?? t('common.save')}
              </Button>
            </div>
          }
        >
          <div className="px-5 py-4 text-sm leading-relaxed text-ink whitespace-pre-line">
            {state.opts.message ?? t('common.unsavedChanges')}
          </div>
        </AppDialog>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used within ConfirmProvider')
  }
  return ctx
}
