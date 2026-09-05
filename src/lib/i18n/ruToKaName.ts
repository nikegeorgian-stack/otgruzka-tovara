/**
 * Phonetic Mkhedruli draft from Russian FIO spelling.
 * User can always edit manually in the employee card.
 */

const FIRST_NAME_MAP: Record<string, string> = {
  "ника": "ნიკა",
  "гиорги": "გიორგი",
  "гиоргий": "გიორგი",
  "георгий": "გიორგი",
  "георги": "გიორგი",
  "давид": "დავით",
  "давит": "დავით",
  "леван": "ლევან",
  "ираклий": "ირაკლი",
  "иракли": "ირაკლი",
  "важа": "ვაჟა",
  "зоя": "ზოია",
  "мария": "მარია",
  "нана": "ნანა",
  "тамара": "თამარა",
  "тамар": "თამარ",
  "нино": "ნინო",
  "софио": "სოფიო",
  "софия": "სოფია",
  "александр": "ალექსანდრე",
  "александра": "ალექსანდრა",
  "михаил": "მიხეილ",
  "михеил": "მიხეილ",
  "бека": "ბექა",
  "лаша": "ლაშა",
  "гига": "გიგა",
  "зураб": "ზურაბ",
  "мераб": "მერაბ",
  "шоте": "შოთა",
  "шота": "შოთა",
  "каха": "კახა",
  "кахабер": "კახაბერ",
  "темур": "თემურ",
  "тимур": "თემურ",
  "гуджа": "გუჯა",
  "гужа": "გუჯა",
}

const DIGRAPHS: Array<[string, string]> = [
  ["дж", "ჯ"],
  ["дз", "ძ"],
  ["тч", "ჭ"],
  ["тш", "ჭ"],
  ["гх", "ღ"],
  ["кх", "ქ"],
  ["пх", "ფ"],
  ["тх", "თ"],
  ["шв", "შვ"],
  ["ц", "წ"],
  ["ч", "ჩ"],
  ["ш", "შ"],
  ["щ", "შჩ"],
  ["ж", "ჟ"],
  ["х", "ხ"],
  ["ю", "იუ"],
  ["я", "ია"],
  ["ё", "იო"],
  ["э", "ე"],
  ["ы", "ი"],
]

const SINGLE: Record<string, string> = {
  "а": "ა",
  "б": "ბ",
  "в": "ვ",
  "г": "გ",
  "д": "დ",
  "е": "ე",
  "з": "ზ",
  "и": "ი",
  "й": "ი",
  "к": "კ",
  "л": "ლ",
  "м": "მ",
  "н": "ნ",
  "о": "ო",
  "п": "პ",
  "р": "რ",
  "с": "ს",
  "т": "ტ",
  "у": "უ",
  "ф": "ფ",
  "ь": "",
  "ъ": "",
  "'": "",
  "’": "",
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
    } else if (/[a-z]/i.test(ch)) {
      out += ch
    } else if (!/[\u0430-\u044f\u0451]/i.test(ch)) {
      out += ch
    }
    i += 1
  }
  return out
}

export function hasCyrillic(text: string): boolean {
  return /[\u0430-\u044f\u0451\u0410-\u042f\u0401]/.test(text)
}

export function ruNameToKa(fullNameRu: string): string {
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

export function surnameKaFromFullNameKa(nameKa: string): string {
  return nameKa.trim().split(/\s+/)[0] ?? ''
}

