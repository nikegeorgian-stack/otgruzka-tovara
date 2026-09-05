/** Геометрия «хрома»: сайдбар + нижняя панель окон. */

export const SIDEBAR_W_EXPANDED = '14rem'
export const SIDEBAR_W_COLLAPSED = '3.5rem'
export const TASKBAR_H = '3.25rem'

/**
 * z-index слои (см. index.css + modalScope):
 *  560+ — инструктор (подсветка / карточка шага) — выше модалок
 *  450+ — приветствие / критичные блокировки
 *  420+ — модалки и полноэкранные редакторы/печать (MODAL_Z_BASE)
 *  410 — сайдбар
 *  400 — workspace-taskbar
 *   90 — виджеты (панели коуча; триггеры — в сайдбаре SupportToolsBar)
 */

/**
 * Открытая панель коуча — у края сайдбара (кнопки уже внутри панели меню).
 */
export const FAB_PANEL_DOCK_CLASS = [
  'fixed print:hidden',
  'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-3',
  'lg:bottom-[calc(3.25rem+1rem)] lg:left-[calc(var(--app-sidebar-w,3.5rem)+0.75rem)]',
].join(' ')

/** Тост «новое письмо» — у левого края сайдбара, не в рабочей зоне справа. */
export const FAB_TOAST_DOCK_CLASS = [
  'fixed print:hidden w-[min(22rem,calc(100vw-1.5rem))]',
  'bottom-[calc(5.5rem+1rem+env(safe-area-inset-bottom,0px))] left-3',
  'lg:bottom-[calc(3.25rem+1rem)] lg:left-[calc(var(--app-sidebar-w,3.5rem)+0.75rem)]',
].join(' ')
export const SIDEBAR_Z = 410
export const TASKBAR_Z = 400
/** Нижняя граница для fullscreen поверх хрома (= MODAL_Z_BASE). */
export const FULLSCREEN_OVER_CHROME_Z = 420
import { ensureCoachPortalRoot } from '@/lib/ui/portalRoots'

/** Инструктор поверх AppDialog / ModalBackdrop (портал в #coach-root). */
export const COACH_Z = 560

/** Корневой контейнер коуча — после #modal-root (см. portalRoots). */
export function getCoachPortalRoot(): HTMLElement {
  return ensureCoachPortalRoot()
}

export function zOverChrome(z: number): number {
  return Math.max(z, FULLSCREEN_OVER_CHROME_Z)
}

export const SIDEBAR_EXPANDED_STORAGE_KEY = 'fst-sidebar-expanded'

/** Backdrop документных окон: не перекрывает сайдбар и taskbar на lg+. */
export const CHROME_BACKDROP_CLASS =
  'app-dialog-backdrop fixed top-0 right-0 bottom-0 left-0 flex items-end justify-center p-0 pt-[env(safe-area-inset-top,0px)] sm:items-center sm:p-4 lg:left-[var(--app-sidebar-w,3.5rem)] lg:bottom-[3.25rem]'

export function readSidebarExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSidebarExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, expanded ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function applySidebarExpandedToDom(expanded: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.sidebarExpanded = expanded ? '1' : '0'
  document.documentElement.style.setProperty(
    '--app-sidebar-w',
    expanded ? SIDEBAR_W_EXPANDED : SIDEBAR_W_COLLAPSED,
  )
}
