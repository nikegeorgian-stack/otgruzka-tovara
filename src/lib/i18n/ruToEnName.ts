/**
 * Passport-style Latin draft from Russian spelling (ICAO-like).
 * User can always edit manually.
 */

import { hasCyrillic } from '@/lib/i18n/ruToKaName'

const FIRST_NAME_MAP: Record<string, string> = {
  ника: 'Nika',
  гиорги: 'Giorgi',
  гиоргий: 'Giorgi',
  георгий: 'Giorgi',
  георги: 'Giorgi',
  давид: 'David',
  давит: 'Davit',
  леван: 'Levan',
  ираклий: 'Irakli',
  иракли: 'Irakli',
  важа: 'Vazha',
  зоя: 'Zoya',
  мария: 'Maria',
  нана: 'Nana',
  тамара: 'Tamara',
  тамар: 'Tamar',
  нино: 'Nino',
  софио: 'Sofio',
  софия: 'Sofia',
  александр: 'Alexander',
  александра: 'Alexandra',
  михаил: 'Mikheil',
  михеил: 'Mikheil',
  бека: 'Beka',
  лаша: 'Lasha',
  гига: 'Giga',
  зураб: 'Zurab',
  мераб: 'Merab',
  шоте: 'Shota',
  шота: 'Shota',
  каха: 'Kakha',
  кахабер: 'Kakhaber',
  темур: 'Temur',
  тимур: 'Temur',
  гуджа: 'Gudja',
  гужа: 'Gudja',
  валера: 'Valera',
  валерий: 'Valeri',
  карло: 'Karlo',
}

const DIGRAPHS: Array<[string, string]> = [
  ['кс', 'ks'],
  ['дж', 'j'],
  ['дз', 'dz'],
  ['тч', 'ch'],
  ['тш', 'ch'],
  ['шв', 'shv'],
  ['щ', 'shch'],
  ['ш', 'sh'],
  ['ч', 'ch'],
  ['ж', 'zh'],
  ['х', 'kh'],
  ['ц', 'ts'],
  ['ю', 'yu'],
  ['я', 'ya'],
  ['ё', 'yo'],
  ['э', 'e'],
  ['ы', 'y'],
]

const SINGLE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  ь: '',
  ъ: '',
  "'": '',
  '’': '',
}

function capitalizeToken(latin: string): string {
  if (!latin) return ''
  return latin.charAt(0).toUpperCase() + latin.slice(1)
}

function transliterateToken(token: string): string {
  const lower = token.toLowerCase()
  const mapped = FIRST_NAME_MAP[lower]
  if (mapped) return mapped

  let i = 0
  let out = ''
  while (i < lower.length) {
    let hit = false
    for (const [from, to] of DIGRAPHS) {
      if (lower.startsWith(from, i)) {
        out += to
        i += from.length
        hit = true
        break
      }
    }
    if (hit) continue
    const ch = lower[i]!
    if (SINGLE[ch] !== undefined) {
      out += SINGLE[ch]
    } else if (/[a-z0-9]/i.test(ch)) {
      out += ch.toLowerCase()
    } else if (!/[\u0430-\u044f\u0451]/i.test(ch)) {
      out += ch
    }
    i += 1
  }
  return capitalizeToken(out)
}

/** Russian (or mixed) title / FIO → Latin draft. Empty if no Cyrillic. */
export function ruNameToEn(fullNameRu: string): string {
  const raw = fullNameRu.trim()
  if (!raw) return ''
  if (!hasCyrillic(raw)) return ''

  return raw
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$/.test(part) || part === '-') return part
      return transliterateToken(part)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
