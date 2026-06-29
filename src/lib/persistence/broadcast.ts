/** Синхронизация между вкладками одного браузера (дополнение к SQLite poll). */
export const STORE_BROADCAST_CHANNEL = 'fibercell-store-updated'

export type StoreBroadcastMessage = {
  type: 'store_saved'
  updatedAt: string
}

export function postStoreSaved(updatedAt: string): void {
  try {
    const ch = new BroadcastChannel(STORE_BROADCAST_CHANNEL)
    ch.postMessage({ type: 'store_saved', updatedAt } satisfies StoreBroadcastMessage)
    ch.close()
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function subscribeStoreSaved(
  onSaved: (updatedAt: string) => void,
): () => void {
  try {
    const ch = new BroadcastChannel(STORE_BROADCAST_CHANNEL)
    ch.onmessage = (ev: MessageEvent<StoreBroadcastMessage>) => {
      if (ev.data?.type === 'store_saved' && ev.data.updatedAt) {
        onSaved(ev.data.updatedAt)
      }
    }
    return () => ch.close()
  } catch {
    return () => {}
  }
}
