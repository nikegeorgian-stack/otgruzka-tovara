const PREFIX = 'fst-pwd-changed:'

export function markPasswordChangeComplete(email: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${email.trim().toLowerCase()}`, '1')
  } catch {
    /* ignore */
  }
}

export function isPasswordChangeComplete(email: string | null | undefined): boolean {
  if (!email) return false
  try {
    return sessionStorage.getItem(`${PREFIX}${email.trim().toLowerCase()}`) === '1'
  } catch {
    return false
  }
}

export function clearPasswordChangeComplete(email: string | null | undefined): void {
  if (!email) return
  try {
    sessionStorage.removeItem(`${PREFIX}${email.trim().toLowerCase()}`)
  } catch {
    /* ignore */
  }
}
