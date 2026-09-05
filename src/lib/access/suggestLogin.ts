import { ruNameToEn } from '@/lib/i18n/ruToEnName'
import { hasCyrillic } from '@/lib/i18n/ruToKaName'

/** Домен корпоративной почты FiberCell (логин = e-mail на вебе). */
export const FST_LOGIN_EMAIL_DOMAIN = 'fibercell.net'

function cleanToken(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

/**
 * Латиница из ФИО: кириллица → passport-style, иначе очистка латиницы.
 */
export function latinizeDisplayName(displayName: string): string {
  const raw = displayName.trim()
  if (!raw) return ''
  if (hasCyrillic(raw)) return ruNameToEn(raw)
  return raw
}

/**
 * Локальная часть логина из ФИО.
 * Порядок как в кадрах: «Фамилия Имя [Отчество]» → `имя.фамилия`.
 * Одно слово → оно же.
 */
export function suggestLoginLocalPart(displayName: string): string {
  const latin = latinizeDisplayName(displayName)
  const parts = latin
    .split(/[\s-]+/)
    .map(cleanToken)
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  const surname = parts[0]!
  const first = parts[1]!
  return `${first}.${surname}`
}

export type SuggestLoginOptions = {
  /** Веб: логин = e-mail. По умолчанию true. */
  asEmail?: boolean
  domain?: string
  /** Уже занятые логины (без учёта регистра). */
  taken?: Iterable<string>
}

/**
 * Черновик логина/e-mail из имени. Можно править вручную.
 * При коллизии добавляет 2, 3… к локальной части.
 */
export function suggestLoginFromDisplayName(
  displayName: string,
  opts?: SuggestLoginOptions,
): string {
  const local = suggestLoginLocalPart(displayName)
  if (!local) return ''

  const asEmail = opts?.asEmail !== false
  const domain = (opts?.domain ?? FST_LOGIN_EMAIL_DOMAIN).trim().toLowerCase()
  const taken = new Set(
    [...(opts?.taken ?? [])].map((x) => x.trim().toLowerCase()).filter(Boolean),
  )

  const build = (n: number) => {
    const part = n <= 1 ? local : `${local}${n}`
    return asEmail ? `${part}@${domain}` : part
  }

  for (let n = 1; n < 100; n++) {
    const candidate = build(n)
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return build(1)
}
