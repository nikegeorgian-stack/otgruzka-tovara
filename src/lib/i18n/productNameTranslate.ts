/**
 * Смысловой черновик KA/EN для наименований ГП / номенклатуры.
 * Сначала словарь терминов, неизвестное — фонетический fallback.
 * Пользователь всегда может поправить вручную.
 */

import { hasCyrillic, ruNameToKa } from './ruToKaName'
import { ruNameToEn } from './ruToEnName'

type Lex = { en: string; ka: string }

/** Целые фразы (после normalize) — приоритет над словами */
const PHRASES: Array<{ ru: string; en: string; ka: string }> = [
  { ru: 'сетка белая', en: 'White mesh', ka: 'თეთრი ბადე' },
  { ru: 'белая сетка', en: 'White mesh', ka: 'თეთრი ბადე' },
  { ru: 'сетка черная', en: 'Black mesh', ka: 'შავი ბადე' },
  { ru: 'черная сетка', en: 'Black mesh', ka: 'შავი ბადე' },
  { ru: 'ратл белый', en: 'White RATL', ka: 'თეთრი რატლი' },
  { ru: 'белый ратл', en: 'White RATL', ka: 'თეთრი რატლი' },
  { ru: 'мембрана белая', en: 'White membrane', ka: 'თეთრი მემბრანა' },
  { ru: 'белая мембрана', en: 'White membrane', ka: 'თეთრი მემბრანა' },
]

/** Отдельные слова / словоформы */
const WORDS: Record<string, Lex> = {
  // типы
  сетка: { en: 'mesh', ka: 'ბადე' },
  сетки: { en: 'mesh', ka: 'ბადე' },
  сеток: { en: 'mesh', ka: 'ბადე' },
  ратл: { en: 'RATL', ka: 'რატლი' },
  ратла: { en: 'RATL', ka: 'რატლი' },
  мембрана: { en: 'membrane', ka: 'მემბრანა' },
  мембраны: { en: 'membrane', ka: 'მემბრანა' },
  суровье: { en: 'greige', ka: 'სუროვიე' },
  пропитка: { en: 'impregnation', ka: 'გაჟღენთვა' },
  рулон: { en: 'roll', ka: 'რულონი' },
  рулона: { en: 'roll', ka: 'რულონი' },
  рулоны: { en: 'rolls', ka: 'რულონები' },

  // цвета
  белая: { en: 'white', ka: 'თეთრი' },
  белый: { en: 'white', ka: 'თეთრი' },
  белое: { en: 'white', ka: 'თეთრი' },
  белые: { en: 'white', ka: 'თეთრი' },
  белых: { en: 'white', ka: 'თეთრი' },
  черная: { en: 'black', ka: 'შავი' },
  черный: { en: 'black', ka: 'შავი' },
  черное: { en: 'black', ka: 'შავი' },
  черные: { en: 'black', ka: 'შავი' },
  чёрная: { en: 'black', ka: 'შავი' },
  чёрный: { en: 'black', ka: 'შავი' },
  синяя: { en: 'blue', ka: 'ლურჯი' },
  синий: { en: 'blue', ka: 'ლურჯი' },
  синее: { en: 'blue', ka: 'ლურჯი' },
  зеленая: { en: 'green', ka: 'მწვანე' },
  зеленый: { en: 'green', ka: 'მწვანე' },
  зелёная: { en: 'green', ka: 'მწვანე' },
  зелёный: { en: 'green', ka: 'მწვანე' },
  красная: { en: 'red', ka: 'წითელი' },
  красный: { en: 'red', ka: 'წითელი' },
  желтая: { en: 'yellow', ka: 'ყვითელი' },
  желтый: { en: 'yellow', ka: 'ყვითელი' },
  жёлтая: { en: 'yellow', ka: 'ყვითელი' },
  жёлтый: { en: 'yellow', ka: 'ყვითელი' },
  серая: { en: 'grey', ka: 'ნაცრისფერი' },
  серый: { en: 'grey', ka: 'ნაცრისფერი' },
  оранжевая: { en: 'orange', ka: 'ნარინჯისფერი' },
  оранжевый: { en: 'orange', ka: 'ნარინჯისფერი' },
  коричневая: { en: 'brown', ka: 'ყავისფერი' },
  коричневый: { en: 'brown', ka: 'ყავისფერი' },

  // прочее
  ультра: { en: 'Ultra', ka: 'Ultra' },
  ultra: { en: 'Ultra', ka: 'Ultra' },
  кат: { en: 'cat.', ka: 'კატ.' },
  категория: { en: 'category', ka: 'კატეგორია' },
  готовая: { en: 'finished', ka: 'მზა' },
  продукция: { en: 'goods', ka: 'პროდუქცია' },
  цвет: { en: 'color', ka: 'ფერი' },
  цвета: { en: 'color', ka: 'ფერი' },
}

const NOUNS = new Set([
  'сетка',
  'сетки',
  'сеток',
  'ратл',
  'ратла',
  'мембрана',
  'мембраны',
  'суровье',
  'рулон',
  'рулона',
  'рулоны',
  'пропитка',
  'продукция',
])

const ADJECTIVES = new Set([
  'белая',
  'белый',
  'белое',
  'белые',
  'белых',
  'черная',
  'черный',
  'черное',
  'черные',
  'чёрная',
  'чёрный',
  'синяя',
  'синий',
  'синее',
  'зеленая',
  'зеленый',
  'зелёная',
  'зелёный',
  'красная',
  'красный',
  'желтая',
  'желтый',
  'жёлтая',
  'жёлтый',
  'серая',
  'серый',
  'оранжевая',
  'оранжевый',
  'коричневая',
  'коричневый',
  'готовая',
])

function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function titleEn(word: string): string {
  if (!word) return word
  if (word === word.toUpperCase() && word.length <= 5) return word // RATL, Ultra already
  if (/^[A-Z]/.test(word) && word.slice(1) === word.slice(1).toLowerCase()) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function translateToken(token: string): Lex | null {
  const key = normalizeKey(token)
  if (!key) return null
  if (WORDS[key]) return WORDS[key]
  // «145», «г/м²», латиница — как есть
  if (/^[\d.,]+$/.test(key)) return { en: token, ka: token }
  if (/^(г\/м²|gsm|м|п\.?м)$/i.test(key)) {
    if (/г\/м/i.test(key) || key === 'gsm') return { en: 'gsm', ka: 'გ/მ²' }
    if (key === 'м') return { en: 'm', ka: 'მ' }
    return { en: 'lm', ka: 'პ.მ' }
  }
  if (!hasCyrillic(token)) return { en: token, ka: token }
  return null
}

/**
 * Смысловой перевод наименования продукта.
 * Пример: «Сетка белая» → EN «White mesh», KA «თეთრი ბადე».
 */
export function translateProductName(nameRu: string): { ka: string; en: string } {
  const raw = nameRu.trim()
  if (!raw) return { ka: '', en: '' }

  const norm = normalizeKey(raw)
  for (const p of PHRASES) {
    if (norm === normalizeKey(p.ru)) {
      return { en: p.en, ka: p.ka }
    }
  }

  // Токены: слова и разделители
  const parts = raw.split(/(\s+|[/·,]+)/)
  type Piece =
    | { kind: 'space'; text: string }
    | { kind: 'word'; ru: string; en: string; ka: string; isNoun: boolean; isAdj: boolean }

  const pieces: Piece[] = []
  for (const part of parts) {
    if (!part) continue
    if (/^\s+$/.test(part) || /^[/·,]+$/.test(part)) {
      pieces.push({ kind: 'space', text: part })
      continue
    }
    const lex = translateToken(part)
    const key = normalizeKey(part)
    if (lex) {
      pieces.push({
        kind: 'word',
        ru: key,
        en: lex.en,
        ka: lex.ka,
        isNoun: NOUNS.has(key),
        isAdj: ADJECTIVES.has(key),
      })
    } else {
      // fallback: фонетика
      const en = ruNameToEn(part) || part
      const ka = ruNameToKa(part) || part
      pieces.push({
        kind: 'word',
        ru: key,
        en,
        ka,
        isNoun: false,
        isAdj: false,
      })
    }
  }

  const words = pieces.filter((p): p is Extract<Piece, { kind: 'word' }> => p.kind === 'word')

  // RU часто «существительное + цвет» → EN/KA «цвет + тип»
  if (
    words.length >= 2 &&
    words[0]!.isNoun &&
    words[1]!.isAdj
  ) {
    const [noun, adj, ...rest] = words
    const reordered = [adj!, noun!, ...rest]
    return {
      en: reordered.map((w) => titleEn(w.en)).join(' '),
      ka: reordered.map((w) => w.ka).join(' '),
    }
  }

  // Уже «цвет + тип» или смешанное
  const enOut = words
    .map((w) => titleEn(w.en))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const kaOut = words
    .map((w) => w.ka)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { en: enOut, ka: kaOut }
}
