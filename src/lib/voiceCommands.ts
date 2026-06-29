import { monthKey } from './dates'
import type { DayCode, Group2x2, ShiftMode, ViewId } from './types'

export type VoiceAction =
  | { type: 'nav'; view: ViewId }
  | { type: 'month'; delta: -1 | 1 }
  | { type: 'goMonth'; month: string }
  | { type: 'currentMonth' }
  | { type: 'layout'; layout: 'dual' | 'plan' | 'fact' }
  | { type: 'print'; brigadeQuery?: string; variant?: 'plan' | 'fact' | 'both' }
  | { type: 'confirm' }
  | { type: 'cancelPending' }
  | { type: 'undo' }
  | { type: 'addSlot' }
  | { type: 'removeEmptySlot' }
  | { type: 'bulkHoliday' }
  | { type: 'bulkCopy52' }
  | { type: 'search'; query: string }
  | { type: 'clearSearch' }
  | { type: 'clearFilters' }
  | { type: 'filterBrigade'; query: string }
  | { type: 'filterSchedule'; schedule: '5/2 8ч' | '2/2 11ч' | '1/1 11ч' | '' }
  | { type: 'assign'; name: string; brigadeQuery?: string }
  | { type: 'unassign'; name: string }
  | { type: 'replaceInBrigade'; brigadeQuery?: string; fromName: string; toName: string }
  | { type: 'swapEmployees'; nameA: string; nameB: string }
  | {
      type: 'changeSchedule'
      name: string
      fromDay: number
      schedule: import('./types').ScheduleType
    }
  | {
      type: 'changeEmployeeShift'
      name: string
      fromDay: number
      schedule?: import('./types').ScheduleType
      group2x2?: Group2x2
      shiftMode?: ShiftMode
    }
  | { type: 'permanentAssign'; name: string; brigadeQuery: string }
  | { type: 'regenerateMonth' }
  | { type: 'regenerateEmployee'; name: string }
  | { type: 'setCode'; name?: string; day?: number; code: DayCode; mode?: 'plan' | 'fact' }
  | {
      type: 'setCodeRange'
      name: string
      fromDay: number
      toDay: number
      code: DayCode
      mode?: 'plan' | 'fact'
    }
  | { type: 'locale'; locale: 'ru' | 'ka' }
  | { type: 'exportJson' }
  | { type: 'warehouseReceipt'; name: string; qty: number }
  | { type: 'warehouseBalance'; name: string }
  | { type: 'warehouseExport' }
  | { type: 'warehousePrint' }
  | { type: 'help' }
  | { type: 'hotkeys' }

const MONTH_STEMS: [string, number][] = [
  ['январ', 1],
  ['феврал', 2],
  ['март', 3],
  ['апрел', 4],
  ['май', 5],
  ['мая', 5],
  ['июн', 6],
  ['июл', 7],
  ['август', 8],
  ['сентябр', 9],
  ['октябр', 10],
  ['ноябр', 11],
  ['декабр', 12],
]

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CODE_WORDS: { words: string[]; code: DayCode }[] = [
  { words: ['восьмерка', 'восемь', 'восемь часов'], code: '8' },
  { words: ['одиннадцать', 'одиннадцать часов'], code: '11' },
  { words: ['ночная', 'ночь', 'ночную', 'ночную смену'], code: 'Н' },
  { words: ['двадцать два', '22 часа'], code: '22' },
  { words: ['выходной', 'выходной день', 'выход'], code: 'В' },
  {
    words: [
      'неоплачиваемый отпуск',
      'неоплатный отпуск',
      'отпуск без содержания',
      'за свой счет',
      'за свой счёт',
    ],
    code: 'ОО',
  },
  { words: ['отпуск', 'отгулы'], code: 'ОТ' },
  { words: ['больничный', 'больник', 'больной', 'болеет'], code: 'Б' },
  { words: ['прогул', 'не вышел'], code: 'X' },
  { words: ['простой', 'простаивает'], code: 'ПР' },
  { words: ['очистить', 'пусто', 'сброс', 'удалить код'], code: '' },
]

function parseCode(text: string): DayCode | null {
  if (/\b8\b/.test(text) && !/(18|28)/.test(text)) return '8'
  if (/\b11\b/.test(text)) return '11'
  if (/\b22\b/.test(text)) return '22'
  for (const { words, code } of CODE_WORDS) {
    if (words.some((w) => text.includes(w))) return code
  }
  return null
}

function parseDay(text: string): number | undefined {
  const m =
    text.match(/(?:день|число|на)\s*(\d{1,2})/) ?? text.match(/\b(\d{1,2})\b/)
  if (!m) return undefined
  const d = Number(m[1])
  return d >= 1 && d <= 31 ? d : undefined
}

function parseDayRange(text: string): { from: number; to: number } | null {
  const m =
    text.match(/(?:с|от)\s*(\d{1,2})\s*(?:по|до|-)\s*(\d{1,2})/) ??
    text.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/)
  if (!m) return null
  const from = Number(m[1])
  const to = Number(m[2])
  if (from < 1 || to > 31 || from > to) return null
  return { from, to }
}

function parseFromDay(text: string): number | undefined {
  const m =
    text.match(/(?:с|от)\s*(?:такого\s*то\s*)?(?:числа\s*)?(\d{1,2})(?:\s*го|\s*числ)?/) ??
    text.match(/(?:начиная|начало)\s*(?:с\s*)?(\d{1,2})/)
  if (!m) return undefined
  const d = Number(m[1])
  return d >= 1 && d <= 31 ? d : undefined
}

function parseScheduleSpeech(text: string): import('./types').ScheduleType | null {
  if (/5\s*[/.\\]\s*2|пять\s*два|пятиднев|5\s*2\s*8|восьмичас/.test(text)) return '5/2 8ч'
  if (/1\s*[/.\\]\s*1|один\s*один|через\s*день|день\s*через\s*день/.test(text)) return '1/1 11ч'
  if (/2\s*[/.\\]\s*2|два\s*два|сменн|11\s*час|одиннадцатичас/.test(text)) return '2/2 11ч'
  return null
}

function extractName(text: string, prefixes: string[]): string | null {
  for (const p of prefixes) {
    if (text.startsWith(p + ' ')) return text.slice(p.length + 1).trim()
    const re = new RegExp(`${p}\\s+(.+)`)
    const m = text.match(re)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

function parseReplaceCommand(t: string): VoiceAction | null {
  const brigadeFirst = t.match(
    /(?:в\s+)?(?:бригад[еа]|отдел[е]?)\s+(.+?)\s+замени(?:ть)?\s+(.+?)\s+на\s+(.+)/,
  )
  if (brigadeFirst) {
    return {
      type: 'replaceInBrigade',
      brigadeQuery: brigadeFirst[1].trim(),
      fromName: brigadeFirst[2].trim(),
      toName: brigadeFirst[3].trim(),
    }
  }

  const replace = t.match(/замени(?:ть)?\s+(.+?)\s+на\s+(.+)/)
  if (replace) {
    const tail = replace[2]
    const onSplit = tail.match(/^(.+?)\s+(?:в|на)\s+(?:бригад[еу]|отдел[е]?)\s+(.+)/)
    if (onSplit) {
      return {
        type: 'replaceInBrigade',
        fromName: replace[1].trim(),
        toName: onSplit[1].trim(),
        brigadeQuery: onSplit[2].trim(),
      }
    }
    return {
      type: 'replaceInBrigade',
      fromName: replace[1].trim(),
      toName: tail.trim(),
    }
  }

  const instead = t.match(/вместо\s+(.+?)\s+(?:поставь|назначь|ставь|поставить)\s+(.+)/)
  if (instead) {
    const tail = instead[2]
    const br = tail.match(/^(.+?)\s+(?:в|на)\s+(?:бригад[еу]|отдел[е]?)\s+(.+)/)
    if (br) {
      return {
        type: 'replaceInBrigade',
        fromName: instead[1].trim(),
        toName: br[1].trim(),
        brigadeQuery: br[2].trim(),
      }
    }
    return {
      type: 'replaceInBrigade',
      fromName: instead[1].trim(),
      toName: tail.trim(),
    }
  }

  return null
}

function parseSwapCommand(t: string): VoiceAction | null {
  const m =
    t.match(/(?:поменяй|поменять)\s*местами\s+(.+?)\s+и\s+(.+)/) ??
    t.match(/(?:поменяй|поменять)\s+(.+?)\s+и\s+(.+)\s+местами/)
  if (m) return { type: 'swapEmployees', nameA: m[1].trim(), nameB: m[2].trim() }
  return null
}

function stripScheduleWords(text: string): string {
  return text
    .replace(/график\s*(5.?2|2.?2|пять.?два|два.?два)/g, ' ')
    .replace(/(?:5.?2|2.?2|пять.?два|два.?два)\s*(?:на|→)\s*(?:5.?2|2.?2|пять.?два|два.?два)/g, ' ')
    .replace(/(?:сменить|поставить|изменить|поменять)\s*график/g, ' ')
    .replace(/график|расписани[ея]|смен[ауы]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseGroup2x2(text: string): Group2x2 | null {
  if (/групп\w*\s*[аa]|групп\w*\s*альф/i.test(text)) return 'А'
  if (/групп\w*\s*[бb]|групп\w*\s*бета/i.test(text)) return 'Б'
  return null
}

function parseShiftMode(text: string): ShiftMode | null {
  if (/ночн|ночь|ночную/i.test(text)) return 'night'
  if (/дневн|днем|днём|день\b/i.test(text)) return 'day'
  return null
}

function parseChangeEmployeeShiftCommand(t: string): VoiceAction | null {
  const hasGroup = /групп/i.test(t)
  const hasShift = /ночн|дневн|днем|днём/i.test(t)
  const hasSchedule = parseScheduleSpeech(t) !== null
  if (!hasGroup && !hasShift && !hasSchedule) return null
  if (/^(график|все\s*графики)/.test(t) && !parseFromDay(t) && !hasGroup && !hasShift) {
    return null
  }

  let schedule = parseScheduleSpeech(t)
  const swap = t.match(
    /(?:с|со)\s*(5\s*[/.\\]?\s*2|2\s*[/.\\]?\s*2|пять\s*два|два\s*два)\s*(?:на|→)\s*(5\s*[/.\\]?\s*2|2\s*[/.\\]?\s*2|пять\s*два|два\s*два)/,
  )
  if (swap) schedule = parseScheduleSpeech(swap[2]) ?? schedule

  const group2x2 = parseGroup2x2(t) ?? undefined
  const shiftMode = parseShiftMode(t) ?? undefined
  if (!schedule && !group2x2 && !shiftMode) return null

  const fromDay = parseFromDay(t) ?? 1
  let namePart = stripScheduleWords(t)
  namePart = namePart
    .replace(/групп\w*\s*[абab]/gi, ' ')
    .replace(/ночн\w*|дневн\w*|днем|днём/gi, ' ')
    .replace(/(?:с|от)\s*(?:такого\s*то\s*)?(?:числа\s*)?\d{1,2}(?:\s*го|\s*числ)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!namePart || namePart.length < 2) return null

  if (schedule && !group2x2 && !shiftMode) {
    return { type: 'changeSchedule', name: namePart, fromDay, schedule }
  }

  return {
    type: 'changeEmployeeShift',
    name: namePart,
    fromDay,
    schedule: schedule ?? undefined,
    group2x2,
    shiftMode,
  }
}

function parsePermanentAssign(t: string): VoiceAction | null {
  const m =
    t.match(
      /(?:переведи|перевести|назнач(?:ить|и|ь))\s+(.+?)\s+(?:в|на)\s+(?:бригад[уа]|отдел)\s+(.+?)(?:\s+навсегда|\s+постоянно)?$/,
    ) ??
    t.match(
      /(?:переведи|перевести)\s+(.+?)\s+(?:в|на)\s+(пропитк\w*.+?)(?:\s+навсегда|\s+постоянно)?$/,
    ) ??
    t.match(/(.+?)\s+(?:в|на)\s+(?:бригад[уа]|отдел|пропитк\w*)\s+(.+?)\s+(?:навсегда|постоянно)/)
  if (!m) return null
  if (!/(навсегда|постоянно)/.test(t)) return null
  return { type: 'permanentAssign', name: m[1].trim(), brigadeQuery: m[2].trim() }
}

function parsePrintBrigade(t: string): VoiceAction | null {
  const m =
    t.match(/^(?:печать|распечат(?:ать|ай|ка))\s+(?:бригад[уа]|отдел)?\s*(.+)/) ??
    t.match(/^распечатай\s+(?:бригад[уа]|отдел)\s+(.+)/)
  if (!m?.[1]) return null
  const q = m[1].trim()
  if (/^(план|факт|табель|все)/.test(q) && !/пропитк|[12]\s*[.\s]*[12]/.test(q)) return null
  let variant: 'plan' | 'fact' | 'both' | undefined
  if (/\bфакт/.test(t)) variant = 'fact'
  else if (/\bплан/.test(t)) variant = 'plan'
  return { type: 'print', brigadeQuery: q.replace(/\b(план|факт)\b/g, '').trim(), variant }
}

function parseAssignToBrigade(t: string): VoiceAction | null {
  const m =
    t.match(/назнач(?:ить|и|ь)\s+(.+?)\s+(?:в|на)\s+(?:бригад[уа]|отдел)\s+(.+)/) ??
    t.match(/назнач(?:ить|и|ь)\s+(.+?)\s+(?:в|на)\s+(пропитк\w*.+)/)
  if (!m) return null
  return { type: 'assign', name: m[1].trim(), brigadeQuery: m[2].trim() }
}

function parseSpeechMonth(text: string): string | null {
  const yearMatch = text.match(/(20\d{2})/)
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
  for (const [stem, month] of MONTH_STEMS) {
    if (text.includes(stem)) return monthKey(year, month)
  }
  return null
}

function extractCodeCommandName(text: string): string | undefined {
  const named = extractName(text, ['поставить код', 'проставить код', 'код', 'проставить'])
  if (named) return named
  let cleaned = text
  for (const { words } of CODE_WORDS) {
    for (const w of words) cleaned = cleaned.replaceAll(w, ' ')
  }
  cleaned = cleaned
    .replace(/\d{1,2}/g, ' ')
    .replace(/(?:с|по|до|от|день|число|на|план|факт|весь|месяц)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 2 ? cleaned : undefined
}

export function parseVoiceCommand(raw: string): VoiceAction | null {
  const t = norm(raw)
  if (!t) return null

  if (/^(да|подтверждаю|верно|ок|окей|согласен|давай)/.test(t)) return { type: 'confirm' }
  if (/^(нет|отмена|не надо|стой)/.test(t)) return { type: 'cancelPending' }
  if (/^(отмени|назад|верни|undo|откат)/.test(t)) return { type: 'undo' }

  if (/^(стоп|выключи|хватит|тише|замолчи)/.test(t)) return null

  if (/^(справка|помощь|команды|что умеешь|инструкция)/.test(t)) return { type: 'help' }
  if (/^(горячие клавиши|клавиши)/.test(t)) return { type: 'hotkeys' }

  if (/^(русский|на русском|язык русский)/.test(t)) return { type: 'locale', locale: 'ru' }
  if (/^(грузинский|на грузинском|язык грузинский)/.test(t)) {
    return { type: 'locale', locale: 'ka' }
  }

  if (/^экспорт\s*склад/.test(t)) return { type: 'warehouseExport' }
  if (/^печать\s*склад/.test(t)) return { type: 'warehousePrint' }

  if (/^(экспорт|сохранить|бэкап|backup|скачать json)/.test(t)) return { type: 'exportJson' }

  const whReceipt =
    t.match(/^приход\s+(\d+(?:[.,]\d+)?)\s+(.+)/) ??
    t.match(/^положи\s+(\d+(?:[.,]\d+)?)\s+(.+)/)
  if (whReceipt) {
    return {
      type: 'warehouseReceipt',
      qty: Number(whReceipt[1].replace(',', '.')),
      name: whReceipt[2].trim(),
    }
  }

  const whBal = t.match(/^остаток\s+(.+)/) ?? t.match(/^сколько\s+(.+)/)
  if (whBal) return { type: 'warehouseBalance', name: whBal[1].trim() }

  if (/^(табель|tabel)/.test(t)) return { type: 'nav', view: 'month' }
  if (/^(сотрудники|персонал|кадры)/.test(t)) return { type: 'nav', view: 'directories' }
  if (/^(справочник|справочники|номенклатур)/.test(t)) return { type: 'nav', view: 'directories' }
  if (/^(сводка|итоги|отчет)/.test(t)) return { type: 'nav', view: 'summary' }
  if (/^(оплата|зарплата|начисления|бухгалтерия)/.test(t)) return { type: 'nav', view: 'pay' }
  if (/^склад/.test(t)) return { type: 'nav', view: 'warehouse' }
  if (/^коды/.test(t)) return { type: 'nav', view: 'directories' }
  if (/^настройки/.test(t)) return { type: 'nav', view: 'settings' }

  if (/текущ(ий|его)\s*месяц|сегодняшний\s*месяц|этот\s*месяц/.test(t)) {
    return { type: 'currentMonth' }
  }

  const speechMonth = parseSpeechMonth(t)
  if (speechMonth && !parseCode(t)) return { type: 'goMonth', month: speechMonth }

  if (/следующ(ий|его)\s*месяц|месяц\s*вперед/.test(t)) return { type: 'month', delta: 1 }
  if (/предыдущ(ий|его)\s*месяц|месяц\s*назад/.test(t)) return { type: 'month', delta: -1 }

  if (/^(показать всех|сбросить поиск|очистить поиск|все сотрудники)/.test(t)) {
    return { type: 'clearSearch' }
  }
  if (/^(все бригады|сбросить фильтр|без фильтра|очистить фильтр)/.test(t)) {
    return { type: 'clearFilters' }
  }

  if (/график\s*(5.?2|пять.?два|пятиднев)/.test(t)) {
    return { type: 'filterSchedule', schedule: '5/2 8ч' }
  }
  if (/график\s*(1.?1|один.?один|через.?день)/.test(t)) {
    return { type: 'filterSchedule', schedule: '1/1 11ч' }
  }
  if (/график\s*(2.?2|два.?два|сменн)/.test(t)) {
    return { type: 'filterSchedule', schedule: '2/2 11ч' }
  }
  if (/^все\s*графики/.test(t)) return { type: 'filterSchedule', schedule: '' }

  if (/^(бригада|отдел|показать бригаду)\s+/.test(t)) {
    const q = t.replace(/^(бригада|отдел|показать бригаду)\s+/, '').trim()
    if (q) return { type: 'filterBrigade', query: q }
  }

  if (/^обзор$/.test(t)) return { type: 'layout', layout: 'dual' }
  if (/^план$/.test(t)) return { type: 'layout', layout: 'plan' }
  if (/^факт$/.test(t)) return { type: 'layout', layout: 'fact' }

  if (/^печать|распечат/.test(t)) {
    const br = parsePrintBrigade(t)
    if (br) return br
    return { type: 'print' }
  }
  if (/^(добавить|плюс)\s*место/.test(t)) return { type: 'addSlot' }
  if (/^(убрать|минус|удалить)\s*место/.test(t)) return { type: 'removeEmptySlot' }
  if (/^праздник/.test(t)) return { type: 'bulkHoliday' }
  if (/копир(овать|уй)\s*план|план\s*в\s*факт|заполн(ить|и)\s*факт/.test(t)) {
    return { type: 'bulkCopy52' }
  }

  if (/пересчит(ать|ай)\s*план|обнов(ить|и)\s*план|перегенер/.test(t)) {
    return { type: 'regenerateMonth' }
  }

  const permanentCmd = parsePermanentAssign(t)
  if (permanentCmd) return permanentCmd

  const replaceCmd = parseReplaceCommand(t)
  if (replaceCmd) return replaceCmd

  const swapCmd = parseSwapCommand(t)
  if (swapCmd) return swapCmd

  const shiftCmd = parseChangeEmployeeShiftCommand(t)
  if (shiftCmd) return shiftCmd

  const assignBrigade = parseAssignToBrigade(t)
  if (assignBrigade) return assignBrigade

  const searchQ = extractName(t, ['найти', 'поиск', 'искать', 'где'])
  if (searchQ && parseCode(searchQ) === null) return { type: 'search', query: searchQ }

  const unName = extractName(t, ['освободить', 'снять', 'убрать сотрудника'])
  if (unName && !unName.includes('место')) return { type: 'unassign', name: unName }

  const regName = extractName(t, ['пересчитать', 'обновить'])
  if (regName && !regName.includes('план') && parseCode(regName) === null) {
    return { type: 'regenerateEmployee', name: regName }
  }

  const assignName = extractName(t, ['назначить', 'выбрать', 'поставить', 'ставь'])
  if (assignName && !assignName.includes('место') && parseCode(assignName) === null) {
    const brInName = assignName.match(/^(.+?)\s+(?:в|на)\s+(?:бригад[уа]|отдел)\s+(.+)/)
    if (brInName) {
      return { type: 'assign', name: brInName[1].trim(), brigadeQuery: brInName[2].trim() }
    }
    return { type: 'assign', name: assignName }
  }

  const mode: 'plan' | 'fact' | undefined = t.includes('факт')
    ? 'fact'
    : t.includes('план')
      ? 'plan'
      : undefined

  const code = parseCode(t)
  if (code !== null) {
    const range = parseDayRange(t)
    const name = extractCodeCommandName(t)
    if (range && name) {
      return { type: 'setCodeRange', name, fromDay: range.from, toDay: range.to, code, mode }
    }
    return { type: 'setCode', name, day: parseDay(t), code, mode }
  }

  return null
}
