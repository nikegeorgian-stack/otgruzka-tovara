import { monthKey, parseMonthKey, shiftMonth } from '@/lib/dates'
import { normalizeCode, normalizeTarget } from '@/lib/ai/timesheetHelpers'
import type { AppStore, DayCode, Employee, ScheduleType } from '@/lib/types'
import {
  extractBrigadeFromText,
  findBrigadeByVoice,
  findEmployeeByVoiceName,
  findEmployeesInText,
} from '@/lib/voiceNames'

const ACTION_WORDS = new Set([
  'ночная',
  'ночь',
  'ночную',
  'отпуск',
  'выходной',
  'больничный',
  'прогул',
  'поставь',
  'поставить',
  'проставь',
  'назнач',
  'назначить',
  'переведи',
  'найди',
  'найти',
  'поиск',
  'сколько',
  'остаток',
  'осталось',
  'приход',
  'расход',
  'проведи',
  'открой',
  'табель',
  'склад',
  'бригада',
  'бригаду',
  'бригаде',
  'числа',
  'число',
  'факте',
  'факт',
  'плане',
  'план',
  'график',
  'смени',
  'измени',
  'весь',
  'всей',
  'всех',
  'сотрудник',
  'сотруднику',
  'заполн',
  'копир',
  'праздник',
  'следующ',
  'предыдущ',
  'текущ',
  'оплат',
  'настрой',
  'коды',
  'сводк',
  'статус',
  'пересчит',
  'освобод',
  'снять',
  'замен',
  'поменя',
])

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findEmployeesInTextFuzzy(text: string, employees: Employee[]): Employee[] {
  const active = employees.filter((e) => e.active)
  const map = new Map<string, Employee>()

  for (const e of findEmployeesInText(text, active)) {
    map.set(e.id, e)
  }

  const segments = text
    .split(/\s+и\s+|,\s*|\s+а\s+также\s+/gi)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const segment of segments.length ? segments : [text]) {
    const one = findEmployeeByVoiceName(active, segment)
    if (one) map.set(one.id, one)

    const words = norm(segment)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !ACTION_WORDS.has(w))

    for (const w of words) {
      const emp = findEmployeeByVoiceName(active, w)
      if (emp) map.set(emp.id, emp)
    }

    for (let i = 0; i < words.length - 1; i += 1) {
      const chunk = `${words[i]} ${words[i + 1]}`
      const emp = findEmployeeByVoiceName(active, chunk)
      if (emp) map.set(emp.id, emp)
    }
  }

  return [...map.values()]
}

function employeesInBrigade(store: AppStore, brigade: string, month: string): Employee[] {
  const active = store.employees.filter((e) => e.active)
  const byField = active.filter((e) => norm(e.brigade ?? '') === norm(brigade))
  if (byField.length) return byField

  const sheet = store.months[month]
  if (!sheet) return byField

  const ids = new Set<string>()
  for (const row of sheet.rows) {
    if (norm(row.brigade) === norm(brigade) && row.employeeId) {
      ids.add(row.employeeId)
    }
  }
  return active.filter((e) => ids.has(e.id))
}

function parseCodeFromText(text: string): DayCode | null {
  const t = norm(text)
  if (/\b8\b/.test(t) && !/(18|28)/.test(t)) return '8'
  if (/\b11\b/.test(t)) return '11'
  if (/\b22\b/.test(t)) return '22'
  if (/ночн|ночь|ночную/.test(t)) return 'Н'
  if (/выходн|выход/.test(t)) return 'В'
  if (/неоплач|без содерж|за свой сч/.test(t)) return 'ОО'
  if (/отпуск|отгу/.test(t)) return 'ОТ'
  if (/больнич|больник|болеет/.test(t)) return 'Б'
  if (/прогул|не вышел/.test(t)) return 'X'
  if (/простой|простаива/.test(t)) return 'ПР'
  return normalizeCode(text)
}

function parseDayRange(text: string): { fromDay?: number; toDay?: number; day?: number } {
  const t = norm(text)
  const range =
    t.match(/(?:с|от)\s*(\d{1,2})\s*(?:по|до|-|–)\s*(\d{1,2})/) ??
    t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/)
  if (range) {
    return { fromDay: Number(range[1]), toDay: Number(range[2]) }
  }

  const from = t.match(/(?:с|от)\s*(\d{1,2})(?:\s*го|\s*числ)?/)
  if (from) return { fromDay: Number(from[1]) }

  const day = t.match(/(?:день|число|на)\s*(\d{1,2})/) ?? t.match(/\b(\d{1,2})\b/)
  if (day) return { day: Number(day[1]) }

  return {}
}

function parseSchedule(text: string): ScheduleType | null {
  const t = norm(text)
  if (/5\s*[/.\\]\s*2|пятиднев|5\s*2\s*8|восьмичас/.test(t)) return '5/2 8ч'
  if (/1\s*[/.\\]\s*1|один\s*один|через\s*день|день\s*через\s*день/.test(t)) return '1/1 11ч'
  if (/2\s*[/.\\]\s*2|сменн|11\s*час|два\s*два/.test(t)) return '2/2 11ч'
  return null
}

function parseMonth(text: string, activeMonth: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}`

  const t = norm(text)
  const stems: [RegExp, number][] = [
    [/январ/i, 1],
    [/феврал/i, 2],
    [/март/i, 3],
    [/апрел/i, 4],
    [/\bмай\b|мая/i, 5],
    [/июн/i, 6],
    [/июл/i, 7],
    [/август/i, 8],
    [/сентябр/i, 9],
    [/октябр/i, 10],
    [/ноябр/i, 11],
    [/декабр/i, 12],
  ]
  const yearMatch = t.match(/(20\d{2})/)
  const year = yearMatch ? Number(yearMatch[1]) : parseMonthKey(activeMonth).year
  for (const [re, mo] of stems) {
    if (re.test(t)) return monthKey(year, mo)
  }
  return undefined
}

function stripReplaceTail(name: string): string {
  return name
    .replace(
      /\s+(?:за|на)\s+(?:май|мар|январ|феврал|апрел|июн|июл|август|сен|окт|нояб|дек|\d{4}-\d{2}).*$/i,
      '',
    )
    .replace(/\s+(?:за|на)\s+\d{1,2}.*$/i, '')
    .replace(/\s+в\s+(?:плане|факте|план|факт).*$/i, '')
    .replace(/\s+(?:мес(?:я|е)ц|мсесяц).*$/i, '')
    .trim()
}

function parseReplaceOrSwapIntent(
  raw: string,
  store: AppStore,
  activeMonth: string,
): SmartParseResult | null {
  const t = norm(raw)
  const month = parseMonth(raw, activeMonth) ?? activeMonth

  const brigadeFirst = t.match(
    /(?:^|\s)(?:в\s+)?(?:бригад[ае]|отдел[е]?)\s+(.+?)\s+замени(?:ть)?\s+(.+?)\s+на\s+(.+)/,
  )
  if (brigadeFirst) {
    const brigadeQ = brigadeFirst[1].trim()
    const from = stripReplaceTail(brigadeFirst[2].trim())
    const to = stripReplaceTail(brigadeFirst[3].trim())
    if (!from || !to) return null
    const brigade =
      extractBrigadeFromText(raw, store.brigades) ??
      findBrigadeByVoice(store.brigades, brigadeQ)
    return {
      tools: [
        {
          name: 'replace_in_brigade',
          args: { brigade: brigade ?? brigadeQ, from, to, month },
        },
      ],
    }
  }

  const replace = t.match(/замени(?:ть)?\s+(.+?)\s+на\s+(.+)/)
  if (replace) {
    const from = stripReplaceTail(replace[1].trim())
    const tail = replace[2].trim()
    const brSplit = tail.match(/^(.+?)\s+(?:в|на)\s+(?:бригад[уеа]|отдел[е]?)\s+(.+)/)
    const to = stripReplaceTail(brSplit ? brSplit[1] : tail)
    const brigade =
      (brSplit ? findBrigadeByVoice(store.brigades, brSplit[2].trim()) : undefined) ??
      extractBrigadeFromText(raw, store.brigades)
    if (!from || !to) return null
    return {
      tools: [
        {
          name: 'replace_in_brigade',
          args: {
            brigade: brigade ?? brSplit?.[2]?.trim(),
            from,
            to,
            month,
          },
        },
      ],
    }
  }

  const swap =
    t.match(/(?:поменяй|поменять)\s*(?:местами\s+)?(.+?)\s+и\s+(.+?)(?:\s+местами)?$/) ??
    t.match(/(?:поменяй|поменять)\s+(.+?)\s+и\s+(.+)\s+местами/)
  if (swap) {
    return {
      tools: [
        {
          name: 'swap_employee_rows',
          args: {
            employeeA: stripReplaceTail(swap[1].trim()),
            employeeB: stripReplaceTail(swap[2].trim()),
            month,
          },
        },
      ],
    }
  }

  return null
}

export type SmartToolCall = { name: string; args: Record<string, unknown> }

export type SmartParseResult =
  | { help: string }
  | { clarify: string }
  | { tools: SmartToolCall[] }

export function parseSmartIntent(
  raw: string,
  store: AppStore,
  activeMonth: string,
): SmartParseResult | null {
  const t = norm(raw)
  if (!t) return null

  const replaceOrSwap = parseReplaceOrSwapIntent(raw, store, activeMonth)
  if (replaceOrSwap) return replaceOrSwap

  const month = parseMonth(raw, activeMonth) ?? activeMonth
  const target = normalizeTarget(raw)
  const days = parseDayRange(raw)
  const code = parseCodeFromText(raw)
  const schedule = parseSchedule(raw)
  const brigade = extractBrigadeFromText(raw, store.brigades)

  let employees = findEmployeesInTextFuzzy(raw, store.employees)

  if (
    employees.length === 0 &&
    brigade &&
    /(?:всей|всех|всю|бригад)/.test(t)
  ) {
    employees = employeesInBrigade(store, brigade, month)
  }

  // --- Склад ---
  if (/(что|какие).*(заканчива|конча|дефицит|мало)/.test(t)) {
    return { tools: [{ name: 'list_low_stock', args: {} }] }
  }

  const whBal =
    raw.match(/(?:сколько|остаток|осталось)\s+(?:осталось\s+)?(.+)/i) ??
    raw.match(/остаток\s+(.+)/i)
  if (whBal?.[1]) {
    return { tools: [{ name: 'warehouse_balance', args: { query: whBal[1].trim() } }] }
  }

  const issue =
    raw.match(/(?:проведи\s+)?расход\s+(\d+(?:[.,]\d+)?)\s+(.+?)(?:\s+на\s+бригад[уа]\s+(.+))?$/i) ??
    raw.match(/списать\s+(\d+(?:[.,]\d+)?)\s+(.+?)(?:\s+на\s+бригад[уа]\s+(.+))?$/i)
  if (issue) {
    return {
      tools: [
        {
          name: 'warehouse_document',
          args: {
            type: 'issue',
            lines: [{ name: issue[2].trim(), quantity: Number(issue[1].replace(',', '.')) }],
            brigade: issue[3]?.trim(),
          },
        },
      ],
    }
  }

  const receipt =
    raw.match(/(?:проведи\s+)?приход\s+(\d+(?:[.,]\d+)?)\s+(.+)/i) ??
    raw.match(/положи\s+(?:на\s+склад\s+)?(\d+(?:[.,]\d+)?)\s+(.+)/i)
  if (receipt) {
    return {
      tools: [
        {
          name: 'warehouse_document',
          args: {
            type: 'receipt',
            lines: [{ name: receipt[2].trim(), quantity: Number(receipt[1].replace(',', '.')) }],
          },
        },
      ],
    }
  }

  if (/подбор|подбери/.test(t)) {
    const q = raw.replace(/.*(?:подбор|подбери)\s*/i, '').trim() || raw
    return { tools: [{ name: 'open_warehouse_pick_modal', args: { query: q } }] }
  }

  if (/(?:есть|найди)\s+(?:на\s+складе\s+)?(.+)/.test(t)) {
    const m = t.match(/(?:есть|найди)\s+(?:на\s+складе\s+)?(.+)/)
    if (m?.[1]) {
      return { tools: [{ name: 'warehouse_balance', args: { query: m[1].trim() } }] }
    }
  }

  if (/(?:освобод|снять|убери)\s/.test(t) && employees.length > 0) {
    return {
      clarify: `Снятие «${employees.map((e) => e.fullName).join(', ')}» из строки табеля пока через интерфейс. Или: «назначить другого в бригаду».`,
    }
  }

  // --- Навигация / сводка ---
  if (/^(сводка|статус)/.test(t)) {
    return { tools: [{ name: 'get_app_summary', args: {} }] }
  }
  if (/^(список бригад|какие бригады)/.test(t)) {
    return { tools: [{ name: 'list_brigades', args: {} }] }
  }
  if (/^склад/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'warehouse' } }] }
  if (/^(табель|tabel)/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'month' } }] }
  if (/^сотрудники/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'directories' } }] }
  if (/^настройки/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'settings' } }] }
  if (/^оплат/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'pay' } }] }
  if (/^коды/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'directories' } }] }
  if (/^сводка/.test(t)) return { tools: [{ name: 'navigate', args: { view: 'summary' } }] }

  if (/следующ(?:ий|его)\s+месяц/.test(t)) {
    return { tools: [{ name: 'open_month', args: { month: shiftMonth(activeMonth, 1) } }] }
  }
  if (/предыдущ(?:ий|его)\s+месяц/.test(t)) {
    return { tools: [{ name: 'open_month', args: { month: shiftMonth(activeMonth, -1) } }] }
  }
  if (/текущ(?:ий|его)\s+месяц/.test(t)) {
    const now = new Date()
    return {
      tools: [
        {
          name: 'open_month',
          args: {
            month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          },
        },
      ],
    }
  }

  const openMonth = parseMonth(raw, activeMonth)
  if (openMonth && /открой|табель|месяц/.test(t)) {
    return { tools: [{ name: 'open_month', args: { month: openMonth } }] }
  }

  // --- Поиск сотрудника ---
  if (/^(найди|найти|поиск|кто такой|где)\s+/.test(t) || (/найди|найти/.test(t) && employees.length === 0)) {
    const q =
      raw.replace(/^(найди|найти|поиск|кто такой|где)\s+/i, '').trim() ||
      employees[0]?.fullName ||
      raw
    const found = findEmployeeByVoiceName(store.employees, q)
    if (found) employees = [found]
    return { tools: [{ name: 'search_employees', args: { query: q } }] }
  }

  // --- Назначение в бригаду ---
  if (/(назнач|перевед|поставь).*(бригад|отдел|пропитк)/.test(t) && brigade) {
    if (employees.length === 0) {
      return { clarify: `Кого назначить в «${brigade}»? Напишите фамилию.` }
    }
    return {
      tools: employees.map((e) => ({
        name: 'assign_employee_to_brigade',
        args: { employee: e.fullName, brigade, month },
      })),
    }
  }

  // --- Смена графика ---
  if (schedule && (employees.length > 0 || brigade)) {
    const targets =
      employees.length > 0 ? employees : brigade ? employeesInBrigade(store, brigade, month) : []
    if (!targets.length) {
      return { clarify: 'Не нашёл сотрудников для смены графика. Уточните фамилию или бригаду.' }
    }
    const fromDay = days.fromDay ?? days.day ?? 1
    return {
      tools: targets.map((e) => ({
        name: 'change_schedule_from_day',
        args: {
          employee: e.fullName,
          month,
          fromDay,
          schedule,
          target: 'plan',
        },
      })),
    }
  }

  // --- Код в табель ---
  if (code !== null && code !== '') {
    const targets =
      employees.length > 0
        ? employees
        : brigade
          ? employeesInBrigade(store, brigade, month)
          : []

    if (!targets.length) {
      return {
        clarify:
          'Кому поставить код? Напишите фамилию (можно с опечаткой) или бригаду, например: «Солошвили с 15 ночная в факте».',
      }
    }

    if (!days.fromDay && !days.day) {
      return {
        clarify: `Какой день для ${targets.map((e) => e.fullName).join(', ')}? Например: «с 15 по 20» или «15 числа».`,
      }
    }

    const fromDay = days.fromDay ?? days.day!
    let toDay = days.toDay ?? days.fromDay ?? days.day!
    if (!days.toDay && !days.fromDay && days.day) toDay = days.day

    return {
      tools: targets.map((e) => ({
        name: 'set_timesheet_code',
        args: {
          employee: e.fullName,
          month,
          fromDay,
          toDay,
          code,
          target,
        },
      })),
    }
  }

  // --- Только фамилия(и) без действия → поиск / подсказка ---
  if (employees.length > 0) {
    if (employees.length === 1) {
      const e = employees[0]!
      return {
        clarify: `Нашёл: ${e.fullName}${e.brigade ? ` (${e.brigade})` : ''}. Что сделать? Например: «с 15 ночная в факте», «отпуск с 10 по 20», «найди на складе…».`,
      }
    }
    if (!/замени|поменя/i.test(t)) {
      return {
        tools: [{ name: 'search_employees', args: { query: employees.map((e) => e.fullName).join(' ') } }],
      }
    }
  }

  // Нечёткий поиск одного слова как фамилии
  const words = t.split(/\s+/).filter((w) => w.length >= 4 && !ACTION_WORDS.has(w))
  for (const w of words) {
    const emp = findEmployeeByVoiceName(store.employees, w)
    if (emp) {
      return {
        clarify: `Похоже на ${emp.fullName}. Что сделать? Например: «с 15 ночная в факте» или «отпуск с 10 по 20».`,
      }
    }
  }

  return null
}