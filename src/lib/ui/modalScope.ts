/** Селектор фокусируемых элементов внутри модального окна. */
export const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[data-modal-autofocus]',
].join(', ')

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  )
}

export type EnterSubmitMode = 'ignore' | 'submit' | 'ctrl-only'

/** Можно ли на Enter выполнить основное действие модалки. */
export function enterSubmitMode(target: EventTarget | null): EnterSubmitMode {
  if (!(target instanceof HTMLElement)) return 'ignore'
  if (target.closest('[data-modal-ignore-enter]')) return 'ignore'

  const tag = target.tagName
  if (tag === 'BUTTON' || tag === 'A') return 'ignore'
  if (tag === 'TEXTAREA' || target.isContentEditable) return 'ctrl-only'
  if (tag === 'SELECT') return 'ignore'

  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type.toLowerCase()
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range'].includes(type)) {
      return 'ignore'
    }
  }

  return 'submit'
}

// --- Стек вложенных модалок: Esc и z-index ---

export const MODAL_Z_BASE = 130
export const MODAL_Z_STEP = 20
export const POPOVER_Z_OFFSET = 10

let modalStack: string[] = []
const stackListeners = new Set<() => void>()

function notifyModalStack(): void {
  stackListeners.forEach((fn) => fn())
}

export function subscribeModalStack(listener: () => void): () => void {
  stackListeners.add(listener)
  return () => stackListeners.delete(listener)
}

export function modalZIndexAt(stackIndex: number): number {
  return MODAL_Z_BASE + (stackIndex + 1) * MODAL_Z_STEP
}

/** z-index для новой модалки до регистрации (избегает мигания на первом кадре). */
export function peekModalZIndexForNew(): number {
  return modalZIndexAt(modalStack.length)
}

export function getModalZIndex(id: string): number {
  const i = modalStack.indexOf(id)
  return i >= 0 ? modalZIndexAt(i) : peekModalZIndexForNew()
}

/** Выпадающие панели (подбор, код ячейки) — выше верхней модалки. */
export function getPopoverZIndex(): number {
  if (modalStack.length === 0) return modalZIndexAt(0) + POPOVER_Z_OFFSET
  const topId = modalStack[modalStack.length - 1]!
  return getModalZIndex(topId) + POPOVER_Z_OFFSET
}

/** Корневой контейнер для всех модалок — всегда последний в body. */
export function getModalPortalRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement
  }
  let el = document.getElementById('modal-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'modal-root'
    document.body.appendChild(el)
  } else if (el.parentElement?.lastElementChild !== el) {
    document.body.appendChild(el)
  }
  return el
}

export function registerModal(id: string): void {
  modalStack.push(id)
  notifyModalStack()
}

export function unregisterModal(id: string): void {
  modalStack = modalStack.filter((x) => x !== id)
  notifyModalStack()
}

export function isTopModal(id: string): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id
}

export function trapTabKey(container: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return

  const focusable = getFocusableElements(container)
  if (focusable.length === 0) {
    e.preventDefault()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault()
      last.focus()
    }
    return
  }

  if (active === last) {
    e.preventDefault()
    first.focus()
  }
}
