import {
  appendEntries,
  appendSuggestion,
  patchSuggestionStatus,
  replyToSuggestion as applyReplyToSuggestion,
} from '@/lib/aiChat/init'
import type { AiChatEntry, FeedbackStatus, SuggestionEntry } from '@/lib/aiChat/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

/**
 * Лог обращений к ИИ-помощнику и журнал обратной связи.
 * Записи suggestions не удаляются — только смена статуса / ответ админом.
 */
export function createAiChatSlice({ setStore }: StoreSliceDeps) {
  return {
    appendAiChatEntries(entries: AiChatEntry[]) {
      if (!entries.length) return
      patchStore(setStore, (s) => ({
        ...s,
        aiChat: appendEntries(s.aiChat ?? { entries: [], suggestions: [] }, entries),
      }))
    },

    /** Сотрудник: ошибка или предложение → журнал админа (status=new). */
    addSuggestion(item: SuggestionEntry) {
      patchStore(setStore, (s) => ({
        ...s,
        aiChat: appendSuggestion(s.aiChat ?? { entries: [], suggestions: [] }, {
          ...item,
          kind: item.kind ?? 'idea',
          status: item.status ?? 'new',
        }),
      }))
    },

    /** Системный администратор меняет статус в журнале. */
    setSuggestionStatus(id: string, status: FeedbackStatus, byName?: string) {
      patchStore(setStore, (s) => ({
        ...s,
        aiChat: patchSuggestionStatus(
          s.aiChat ?? { entries: [], suggestions: [] },
          id,
          status,
          byName,
        ),
      }))
    },

    /** Админ отвечает и по умолчанию закрывает тему. */
    replyToSuggestion(id: string, reply: string, byName?: string, close = true) {
      patchStore(setStore, (s) => ({
        ...s,
        aiChat: applyReplyToSuggestion(
          s.aiChat ?? { entries: [], suggestions: [] },
          id,
          reply,
          byName,
          close,
        ),
      }))
    },
  }
}
