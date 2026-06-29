import { allowedTargets, coachSystemPrompt, type Locale } from './coachTargets'

export type CoachSuggestion =
  | { type: 'navigate'; view: string }
  | { type: 'highlight'; target: string }

export type CoachTurn = { role: 'user' | 'assistant'; content: string }

export type RunCoachArgs = {
  apiKey: string
  baseUrl: string
  model: string
  locale: Locale
  currentView: string
  history: CoachTurn[]
  userText: string
  /** Роль пользователя (для тона ответа). */
  roleLabel?: string
  /** Разделы в рамках компетенции пользователя. Подсказки ограничиваются ими. */
  allowedViews?: string[]
  /** Запасная модель — пробуется при 429/5xx (напр. более «лёгкая» с отдельной квотой). */
  fallbackModel?: string
  signal?: AbortSignal
}

/** Ошибка HTTP от провайдера с понятным текстом и кодом для логики повтора. */
export class CoachHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'CoachHttpError'
  }
}

export type CoachResult = {
  reply: string
  suggestions: CoachSuggestion[]
}

const ACTIONS_MARKER = '@@ACTIONS@@'

function parseActions(
  raw: string,
  validViews: Set<string>,
  validTargets: Set<string>,
): { text: string; suggestions: CoachSuggestion[] } {
  const idx = raw.lastIndexOf(ACTIONS_MARKER)
  if (idx === -1) return { text: raw.trim(), suggestions: [] }

  const text = raw.slice(0, idx).trim()
  const jsonPart = raw.slice(idx + ACTIONS_MARKER.length).trim()
  const suggestions: CoachSuggestion[] = []
  try {
    const parsed = JSON.parse(jsonPart) as unknown
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const obj = item as Record<string, unknown>
        if (obj.type === 'navigate' && typeof obj.view === 'string' && validViews.has(obj.view)) {
          suggestions.push({ type: 'navigate', view: obj.view })
        } else if (
          obj.type === 'highlight' &&
          typeof obj.target === 'string' &&
          validTargets.has(obj.target)
        ) {
          suggestions.push({ type: 'highlight', target: obj.target })
        }
      }
    }
  } catch {
    // битый JSON действий — игнорируем, оставляем только текст
  }
  // дедуп
  const seen = new Set<string>()
  const unique = suggestions.filter((s) => {
    const k = s.type === 'navigate' ? `n:${s.view}` : `h:${s.target}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { text, suggestions: unique }
}

async function describeHttpError(res: Response, locale: Locale): Promise<string> {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message ?? ''
  } catch {
    detail = ''
  }
  const ka = locale === 'ka'
  switch (res.status) {
    case 429:
      return ka
        ? 'Gemini-ის მოთხოვნების ლიმიტი ამოიწურა (429). დაელოდეთ ერთ წუთს და სცადეთ თავიდან, ან შეამოწმეთ ტარიფი/ბილინგი Google AI Studio-ში.'
        : 'Превышен лимит запросов Gemini (429). Подождите минуту и попробуйте снова, либо проверьте тариф/биллинг в Google AI Studio.'
    case 401:
    case 403:
      return ka
        ? 'Gemini-ის გასაღები არასწორია ან არ აქვს წვდომა (პარამეტრები → AI).'
        : 'Ключ Gemini неверен или нет доступа (Настройки → ИИ).'
    case 400:
      return ka
        ? `არასწორი მოთხოვნა Gemini-სთან${detail ? `: ${detail}` : ''}.`
        : `Неверный запрос к Gemini${detail ? `: ${detail}` : ''}.`
    default:
      return ka
        ? `Gemini-ის შეცდომა (${res.status})${detail ? `: ${detail}` : ''}.`
        : `Ошибка Gemini (${res.status})${detail ? `: ${detail}` : ''}.`
  }
}

export async function runCoach(args: RunCoachArgs): Promise<CoachResult> {
  const {
    apiKey,
    baseUrl,
    model,
    locale,
    currentView,
    history,
    userText,
    roleLabel,
    allowedViews,
    fallbackModel,
    signal,
  } = args

  const targets = allowedTargets(allowedViews)
  const validViews = new Set(targets.map((t) => t.view))
  const validTargets = new Set(targets.map((t) => t.key))

  const messages = [
    {
      role: 'system' as const,
      content: coachSystemPrompt(locale, currentView, { roleLabel, allowedViews }),
    },
    ...history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userText },
  ]

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`

  async function requestOnce(useModel: string): Promise<CoachResult> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: useModel, messages, temperature: 0.3 }),
      signal,
    })

    if (!res.ok) {
      throw new CoachHttpError(res.status, await describeHttpError(res, locale))
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      throw new Error(locale === 'ka' ? 'მოდელის პასუხი ცარიელია.' : 'Пустой ответ модели.')
    }

    const { text, suggestions } = parseActions(content, validViews, validTargets)
    return { reply: text || content.trim(), suggestions }
  }

  const modelsToTry = [model]
  if (fallbackModel && fallbackModel.trim() && fallbackModel !== model) {
    modelsToTry.push(fallbackModel)
  }

  let lastError: unknown
  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      return await requestOnce(modelsToTry[i])
    } catch (err) {
      lastError = err
      const isLast = i === modelsToTry.length - 1
      const retriable =
        err instanceof CoachHttpError && (err.status === 429 || err.status >= 500)
      if (isLast || !retriable) throw err
      // иначе — пробуем запасную модель
    }
  }
  throw lastError
}
