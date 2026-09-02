import { resetBodyScrollLock } from '@/lib/ui/bodyScrollLock'

/** Закрыть эфемерные overlay (confirm, печать) при смене раздела. */
export const FST_CLOSE_OVERLAYS = 'fst:close-overlays'

/** Свернуть рабочие окна в нижнюю панель. */
export const FST_MINIMIZE_OVERLAYS = 'fst:minimize-overlays'

const PRINT_BODY_CLASSES = [
  'print-preview-open',
  'print-labels',
  'print-receipt',
  'print-inventory',
  'print-attendance-log',
  'print-cube-labels',
  'print-daily-issue',
  'payslip-print-open',
  'candidate-anketa-print-open',
] as const

export function dispatchCloseOverlays(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FST_CLOSE_OVERLAYS))
}

export function onCloseOverlays(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(FST_CLOSE_OVERLAYS, handler)
  return () => window.removeEventListener(FST_CLOSE_OVERLAYS, handler)
}

export function dispatchMinimizeOverlays(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FST_MINIMIZE_OVERLAYS))
}

/** Восстановить конкретное окно по id (карточка сотрудника и т.п.). */
export const FST_RESTORE_WINDOW = 'fst:restore-window'

export function dispatchRestoreWindow(id: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FST_RESTORE_WINDOW, { detail: { id } }))
}

export function onRestoreWindow(handler: (id: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id
    if (id) handler(id)
  }
  window.addEventListener(FST_RESTORE_WINDOW, listener)
  return () => window.removeEventListener(FST_RESTORE_WINDOW, listener)
}

export function onMinimizeOverlays(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(FST_MINIMIZE_OVERLAYS, handler)
  return () => window.removeEventListener(FST_MINIMIZE_OVERLAYS, handler)
}

/**
 * Смена раздела: свернуть рабочие окна, закрыть печать/эфемерное,
 * сбросить scroll-lock и классы печати.
 */
export function releaseUiChrome(): void {
  dispatchMinimizeOverlays()
  dispatchCloseOverlays()
  resetBodyScrollLock()
  if (typeof document === 'undefined') return
  for (const cls of PRINT_BODY_CLASSES) {
    document.body.classList.remove(cls)
  }
}
