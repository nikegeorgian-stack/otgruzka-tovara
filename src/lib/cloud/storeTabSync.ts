const CHANNEL_ID = 'fst-uchet-store-v1'

export type StoreTabMessage =
  | { type: 'cloud-saved'; revision: number; fingerprint: string }
  | { type: 'request-refresh' }

export function notifyStoreTabsSaved(revision: number, fingerprint: string): void {
  try {
    const ch = new BroadcastChannel(CHANNEL_ID)
    ch.postMessage({ type: 'cloud-saved', revision, fingerprint } satisfies StoreTabMessage)
    ch.close()
  } catch {
    /* BroadcastChannel unsupported */
  }
}

export function requestStoreTabsRefresh(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL_ID)
    ch.postMessage({ type: 'request-refresh' } satisfies StoreTabMessage)
    ch.close()
  } catch {
    /* ignore */
  }
}

export function listenStoreTabMessages(
  onMessage: (msg: StoreTabMessage) => void,
): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL_ID)
    ch.onmessage = (ev: MessageEvent<StoreTabMessage>) => {
      if (ev.data?.type) onMessage(ev.data)
    }
    return () => ch.close()
  } catch {
    return () => {}
  }
}
