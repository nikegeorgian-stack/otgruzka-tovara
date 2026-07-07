export type UnsavedCloseChoice = 'save' | 'discard' | 'cancel'

export type UnsavedCloseApi = {
  confirmUnsaved: (opts?: {
    title?: string
    message?: string
  }) => Promise<UnsavedCloseChoice>
}

/** Закрытие модалки: без вопросов если чисто; иначе «Сохранить / Не сохранять / Отмена». */
export async function requestModalClose(
  api: UnsavedCloseApi,
  opts: {
    isDirty: () => boolean
    save?: () => boolean | Promise<boolean>
    close: () => void
    message?: string
    title?: string
  },
): Promise<void> {
  if (!opts.isDirty()) {
    opts.close()
    return
  }
  const choice = await api.confirmUnsaved({
    title: opts.title,
    message: opts.message,
  })
  if (choice === 'cancel') return
  if (choice === 'discard') {
    opts.close()
    return
  }
  if (choice === 'save') {
    if (!opts.save) {
      opts.close()
      return
    }
    const ok = await opts.save()
    if (ok) opts.close()
  }
}
