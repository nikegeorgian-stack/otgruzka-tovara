/** Одноразовый пароль для выдачи пользователю (мин. 8 символов, буквы + цифры). */
export function generateOneTimePassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${out}7a`
}
