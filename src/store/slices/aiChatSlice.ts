import { appendEntries, appendSuggestion } from '@/lib/aiChat/init'
import type { AiChatEntry, SuggestionEntry } from '@/lib/aiChat/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

/**
 * Лог обращений к ИИ-помощнику. Сознательно НЕ содержит действий удаления —
 * записи можно только добавлять, чтобы администратор собирал аналитику.
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

    /** Сотрудник оставляет предложение коллектива (неудаляемо). */
    addSuggestion(item: SuggestionEntry) {
      patchStore(setStore, (s) => ({
        ...s,
        aiChat: appendSuggestion(s.aiChat ?? { entries: [], suggestions: [] }, item),
      }))
    },
  }
}
