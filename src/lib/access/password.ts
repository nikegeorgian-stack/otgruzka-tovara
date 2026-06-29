export async function hashPassword(
  password: string,
  salt?: string,
): Promise<{ hash: string; salt: string }> {
  const s = salt ?? crypto.randomUUID()
  const data = new TextEncoder().encode(`${s}:${password}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { hash, salt: s }
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  if (!hash?.trim() || !salt?.trim()) return false
  const { hash: next } = await hashPassword(password, salt)
  return next === hash
}
