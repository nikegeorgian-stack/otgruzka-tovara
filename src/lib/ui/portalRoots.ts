/**
 * Порталы модалок и инструктора.
 * Порядок в body всегда: … → #modal-root → #coach-root.
 * Раньше оба вызывали appendChild(…, last) и перетягивали друг друга —
 * из‑за этого при открытии «?» поверх окна оно моргало.
 */

function ensureEl(id: string): HTMLElement {
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('div')
    el.id = id
  }
  return el
}

/** modal перед coach; без лишних перемещений, если порядок уже верный. */
function syncPortalOrder(modal: HTMLElement, coach: HTMLElement): void {
  const body = document.body
  if (modal.parentElement !== body) body.appendChild(modal)
  if (coach.parentElement !== body) {
    if (modal.parentElement === body) modal.after(coach)
    else body.appendChild(coach)
  }

  // coach должен быть после modal; не трогаем, если уже следует
  const coachFollowsModal =
    (modal.compareDocumentPosition(coach) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  if (!coachFollowsModal) {
    modal.after(coach)
  }
}

export function ensureModalPortalRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement
  }
  const modal = ensureEl('modal-root')
  const coach = ensureEl('coach-root')
  syncPortalOrder(modal, coach)
  return modal
}

export function ensureCoachPortalRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement
  }
  const modal = ensureEl('modal-root')
  const coach = ensureEl('coach-root')
  syncPortalOrder(modal, coach)
  return coach
}
