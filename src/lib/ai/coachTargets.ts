export type Locale = 'ru' | 'ka'

export type CoachTarget = {
  /** Ключ цели = значение data-coach в DOM. */
  key: string
  /** Раздел приложения, куда ведёт цель (для кнопки «Открыть»). */
  view: string
  labelRu: string
  labelKa: string
  /** Что пользователь делает в этом разделе — для подсказок и аналитики. */
  aboutRu: string
  /** Ключевые слова для распознавания темы вопроса (аналитика). */
  keywords: string[]
}

/**
 * Карта разделов приложения. Используется и для подсветки (data-coach="nav:<view>"),
 * и как «карта возможностей» в системном промпте коуча, и для распознавания темы.
 */
export const COACH_TARGETS: CoachTarget[] = [
  {
    key: 'nav:month',
    view: 'month',
    labelRu: 'Табель',
    labelKa: 'ტაბელი',
    aboutRu: 'месячный табель: коды смен (8, 11, Н, В, ОТ, Б), план/факт, бригады, графики',
    keywords: ['табель', 'смена', 'код', 'график', 'бригад', 'план', 'факт', 'ночн', 'выходн'],
  },
  {
    key: 'nav:summary',
    view: 'summary',
    labelRu: 'Сводка',
    labelKa: 'შემაჯამებელი',
    aboutRu: 'сводные показатели по табелю и месяцу',
    keywords: ['сводк', 'итог', 'отчёт', 'отчет'],
  },
  {
    key: 'nav:director',
    view: 'director',
    labelRu: 'Дирекция',
    labelKa: 'დირექცია',
    aboutRu: 'заказы клиентов, кокпит планирования, аналитика и риски',
    keywords: ['заказ клиент', 'дирекц', 'кокпит', 'клиент', 'риск'],
  },
  {
    key: 'nav:production',
    view: 'production',
    labelRu: 'Производство',
    labelKa: 'წარმოება',
    aboutRu: 'сменные заявки на производство, бригады, печать смен',
    keywords: ['производств', 'сменн', 'заявк', 'выработк'],
  },
  {
    key: 'nav:planner',
    view: 'planner',
    labelRu: 'Планировщик',
    labelKa: 'დამგეგმავი',
    aboutRu: 'производственные заказы, планы выпуска, расчёт сырья и резервирование',
    keywords: ['планировщ', 'план выпуск', 'заказ производ', 'сырь', 'резерв'],
  },
  {
    key: 'nav:warehouse',
    view: 'warehouse',
    labelRu: 'Склад',
    labelKa: 'საწყობი',
    aboutRu: 'остатки, приход/расход, инвентаризация, документы, импорт накладных, выдача',
    keywords: ['склад', 'остат', 'приход', 'расход', 'инвентар', 'накладн', 'выдач', 'номенклат'],
  },
  {
    key: 'nav:procurement',
    view: 'procurement',
    labelRu: 'Закупки',
    labelKa: 'შესყიდვები',
    aboutRu: 'заказы поставщикам, контейнеры, трекинг доставки, аналитика',
    keywords: ['закуп', 'поставщ', 'контейнер', 'трекинг', 'доставк'],
  },
  {
    key: 'nav:technologist',
    view: 'technologist',
    labelRu: 'Технолог',
    labelKa: 'ტექნოლოგი',
    aboutRu: 'рецептуры, контроль качества (входной, пропитка, климат), задания на замес',
    keywords: ['технолог', 'рецепт', 'качеств', 'пропитк', 'климат', 'контрол', 'замес задан'],
  },
  {
    key: 'nav:mixer',
    view: 'mixer',
    labelRu: 'Миксер',
    labelKa: 'მიქსერი',
    aboutRu: 'задания на замес от технолога, проведение замеса, этикетки (QR/штрихкод)',
    keywords: ['миксер', 'замес', 'этикетк', 'qr', 'штрихкод', 'куб'],
  },
  {
    key: 'nav:hr',
    view: 'hr',
    labelRu: 'Кадры',
    labelKa: 'კადრები',
    aboutRu: 'сотрудники, посещаемость, расчёт зарплаты',
    keywords: ['кадр', 'сотрудник', 'персонал', 'зарплат', 'посещаем', 'hr'],
  },
  {
    key: 'nav:finance',
    view: 'finance',
    labelRu: 'Финансы',
    labelKa: 'ფინანსები',
    aboutRu: 'ставки, курсы валют, финансовые показатели',
    keywords: ['финанс', 'ставк', 'курс', 'валют'],
  },
  {
    key: 'nav:directories',
    view: 'directories',
    labelRu: 'Справочники',
    labelKa: 'ცნობარები',
    aboutRu: 'контрагенты, позиции, рецептуры, бригады, упаковка, готовая продукция',
    keywords: ['справочник', 'контрагент', 'позиц', 'упаковк', 'готов продукц'],
  },
  {
    key: 'nav:journals',
    view: 'journals',
    labelRu: 'Журналы',
    labelKa: 'ჟურნალები',
    aboutRu: 'журнал событий и действий по разделам',
    keywords: ['журнал', 'событ', 'истори', 'лог'],
  },
  {
    key: 'nav:settings',
    view: 'settings',
    labelRu: 'Настройки',
    labelKa: 'პარამეტრები',
    aboutRu: 'настройки, пользователи и роли, доступы, резервные копии',
    keywords: ['настройк', 'пользовател', 'роль', 'доступ', 'бэкап', 'резерв коп'],
  },
]

export function targetLabel(key: string, locale: Locale): string | null {
  const target = COACH_TARGETS.find((t) => t.key === key)
  if (!target) return null
  return locale === 'ka' ? target.labelKa : target.labelRu
}

export function viewLabel(view: string, locale: Locale): string | null {
  const target = COACH_TARGETS.find((t) => t.view === view)
  if (!target) return null
  return locale === 'ka' ? target.labelKa : target.labelRu
}

/** Простое распознавание темы вопроса по ключевым словам (для аналитики). */
export function detectTopic(text: string): string | null {
  const low = text.toLowerCase()
  let best: { view: string; score: number } | null = null
  for (const target of COACH_TARGETS) {
    let score = 0
    for (const kw of target.keywords) {
      if (low.includes(kw)) score += 1
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { view: target.view, score }
    }
  }
  return best?.view ?? null
}

/** Цели, доступные пользователю по его компетенции (списку разделов). */
export function allowedTargets(allowedViews?: string[]): CoachTarget[] {
  if (!allowedViews || allowedViews.length === 0) return COACH_TARGETS
  const set = new Set(allowedViews)
  return COACH_TARGETS.filter((t) => set.has(t.view))
}

/** Карта возможностей разделов для системного промпта (только в рамках компетенции). */
export function capabilitiesText(targets: CoachTarget[]): string {
  return targets.map((t) => `- ${t.view} ("${t.labelRu}"): ${t.aboutRu}`).join('\n')
}

export type CoachPromptScope = {
  roleLabel?: string
  allowedViews?: string[]
}

export function coachSystemPrompt(
  locale: Locale,
  currentView: string,
  scope: CoachPromptScope = {},
): string {
  const langLine =
    locale === 'ka'
      ? 'Answer in Georgian (ქართული).'
      : 'Отвечай по-русски.'
  const targets = allowedTargets(scope.allowedViews)
  const roleLine = scope.roleLabel
    ? `Пользователь работает в роли «${scope.roleLabel}».`
    : ''
  const targetKeys = targets.map((t) => t.key).join(', ')
  return `Ты — встроенный помощник-наставник системы учёта FiberCell «Табель + Склад + Производство» (завод пропитки, Грузия).
Твоя задача — объяснять сотрудникам КАК и ЧТО делать в приложении по их запросу: пошагово, простыми словами, коротко. ${langLine}

${roleLine}
ВАЖНО — компетенция: помогай ТОЛЬКО по разделам и задачам ниже (это всё, к чему у пользователя есть доступ).
Если вопрос про данные, действия или разделы вне этого списка — вежливо сообщи, что это вне его доступа, и предложи обратиться к ответственному сотруднику или администратору. Не описывай шаги для недоступных разделов.

Распознавай намерение пользователя, даже если вопрос сформулирован неточно, и предлагай конкретные действия.
Не выдумывай данные (остатки, табель, заказы) — ты только подсказываешь, где и как это сделать, а не сообщаешь цифры.
Пиши обычным текстом без markdown-разметки (без *, #, **, таблиц и блоков кода). Шаги оформляй короткими строками вида «1) …», «2) …».

Доступные пользователю разделы и что в них делают:
${capabilitiesText(targets)}

Текущий открытый раздел пользователя: ${currentView}.

Когда уместно показать пользователю, куда нажать, заверши ответ ОТДЕЛЬНОЙ последней строкой строго в формате:
@@ACTIONS@@ [{"type":"navigate","view":"<view>"},{"type":"highlight","target":"<key>"}]
Допустимые view: ${targets.map((t) => t.view).join(', ') || '(нет)'}.
Допустимые target (для подсветки): ${targetKeys || '(нет)'}.
Если действия не нужны — не добавляй строку @@ACTIONS@@. Не упоминай этот формат в обычном тексте ответа.`
}
