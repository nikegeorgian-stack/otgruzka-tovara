/** Счётчик блокировок прокрутки body — предотвращает «залипание» overflow:hidden. */
let lockCount = 0
let prevOverflow: string | null = null

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (lockCount === 0) {
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
      document.body.style.overflow = prevOverflow ?? ''
      prevOverflow = null
    }
  }
}

/** Сброс всех блокировок (аварийный, при смене раздела). */
export function resetBodyScrollLock(): void {
  if (typeof document === 'undefined') return
  lockCount = 0
  document.body.style.overflow = prevOverflow ?? ''
  prevOverflow = null
}
