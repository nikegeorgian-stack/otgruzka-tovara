export type AiChatRole = 'user' | 'assistant'

/**
 * Запись обращения к ИИ-помощнику. Лог НЕудаляемый: записи только добавляются,
 * чтобы администратор мог собирать аналитику по затруднениям персонала.
 */
export type AiChatEntry = {
  id: string
  /** Сессия (одна «тема» диалога). */
  sessionId: string
  ts: number
  userId: string | null
  userName: string
  roleId: string
  /** Раздел приложения, из которого задан вопрос. */
  view: string
  role: AiChatRole
  content: string
  /** Распознанная область/тема вопроса (для аналитики), если определена. */
  topic?: string
}

/** Предложение от сотрудника (коллектива). Неудаляемое — для разбора администратором. */
export type SuggestionEntry = {
  id: string
  ts: number
  userId: string | null
  userName: string
  roleId: string
  view: string
  text: string
}

export type AiChatStore = {
  entries: AiChatEntry[]
  suggestions: SuggestionEntry[]
}
