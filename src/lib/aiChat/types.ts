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
  /** Распознанная область/тема вопроса (если определена). */
  topic?: string
}

/** Тип обращения к администратору. */
export type FeedbackKind = 'bug' | 'idea'

/** Статус в журнале администратора. */
export type FeedbackStatus = 'new' | 'seen' | 'done'

/**
 * Предложение / сообщение об ошибке.
 * Неудаляемое — для разбора системным администратором.
 */
export type SuggestionEntry = {
  id: string
  ts: number
  userId: string | null
  userName: string
  roleId: string
  view: string
  text: string
  /** bug = ошибка, idea = предложение (по умолчанию idea — старые записи). */
  kind: FeedbackKind
  /** new → уведомление админу; seen / done — в журнале. */
  status: FeedbackStatus
  /** Короткий заголовок (опционально). */
  title?: string
  /**
   * Логин/email отправителя (для уведомления и «Мои обращения»).
   * Важнее userId: id может быть Firebase uid или id из access.
   */
  userLogin?: string
  /** Когда админ сменил статус. */
  statusUpdatedAt?: number
  statusUpdatedBy?: string
  /** Ответ администратора (тема обработана). */
  adminReply?: string
  adminReplyAt?: number
  adminReplyBy?: string
}

export type AiChatStore = {
  entries: AiChatEntry[]
  suggestions: SuggestionEntry[]
}
