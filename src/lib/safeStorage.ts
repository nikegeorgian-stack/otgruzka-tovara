function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false
  if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) return true
  const msg = String(e.message ?? '')
  return /quota/i.test(msg)
}

/** Безопасная запись в localStorage — не бросает, логирует квоту. */
export function safeLocalSet(key: string, value: string): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (isQuotaError(e)) {
      console.warn('[FST] localStorage quota exceeded, key skipped:', key)
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    }
    return false
  }
}

export function safeLocalGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalRemove(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function safeSessionSet(key: string, value: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    sessionStorage.setItem(key, value)
    return true
  } catch (e) {
    if (isQuotaError(e)) {
      console.warn('[FST] sessionStorage quota exceeded, key skipped:', key)
    }
    return false
  }
}

export function safeSessionGet(key: string): string | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionRemove(key: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Глобальный обработчик quota-ошибок (Firestore IndexedDB / storage). */
export function installStorageQuotaGuard(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : ''
    if (/quotaBytesPerItem|QuotaExceeded|quota exceeded/i.test(msg)) {
      console.warn('[FST] Storage quota error (ignored):', msg)
      ev.preventDefault()
    }
  })
}
