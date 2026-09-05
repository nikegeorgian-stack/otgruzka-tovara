import type { EditLockRecord } from './types'

const CHANNEL = 'fst-edit-locks-v1'
const TAB_KEY = 'fst-edit-lock-tab-id'

export type LocalLockMessage =
  | { type: 'acquire'; lock: EditLockRecord }
  | { type: 'release'; resourceId: string; tabId: string }
  | { type: 'heartbeat'; lock: EditLockRecord }
  | { type: 'request' }

function readTabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      sessionStorage.setItem(TAB_KEY, id)
    }
    return id
  } catch {
    return `tab-${Date.now()}`
  }
}

export const editLockTabId = readTabId()

const localMap = new Map<string, EditLockRecord>()
const listeners = new Set<(resourceId: string) => void>()

function notify(resourceId: string) {
  for (const l of listeners) l(resourceId)
}

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (ev: MessageEvent<LocalLockMessage>) => {
        const msg = ev.data
        if (!msg?.type) return
        if (msg.type === 'acquire' || msg.type === 'heartbeat') {
          localMap.set(msg.lock.resourceId, msg.lock)
          notify(msg.lock.resourceId)
        } else if (msg.type === 'release') {
          const cur = localMap.get(msg.resourceId)
          if (cur && cur.holder.tabId === msg.tabId) {
            localMap.delete(msg.resourceId)
            notify(msg.resourceId)
          }
        } else if (msg.type === 'request') {
          for (const lock of localMap.values()) {
            broadcast({ type: 'heartbeat', lock })
          }
        }
      }
      broadcast({ type: 'request' })
    } catch {
      channel = null
    }
  }
  return channel
}

function broadcast(msg: LocalLockMessage) {
  try {
    getChannel()?.postMessage(msg)
  } catch {
    /* ignore */
  }
}

export function localGetLock(resourceId: string): EditLockRecord | null {
  getChannel()
  return localMap.get(resourceId) ?? null
}

export function localSetLock(lock: EditLockRecord): void {
  localMap.set(lock.resourceId, lock)
  broadcast({ type: 'acquire', lock })
  notify(lock.resourceId)
}

export function localHeartbeat(lock: EditLockRecord): void {
  localMap.set(lock.resourceId, lock)
  broadcast({ type: 'heartbeat', lock })
  notify(lock.resourceId)
}

export function localRelease(resourceId: string, tabId: string): void {
  const cur = localMap.get(resourceId)
  if (cur && cur.holder.tabId === tabId) {
    localMap.delete(resourceId)
  }
  broadcast({ type: 'release', resourceId, tabId })
  notify(resourceId)
}

export function subscribeLocalLocks(cb: (resourceId: string) => void): () => void {
  getChannel()
  listeners.add(cb)
  return () => listeners.delete(cb)
}
