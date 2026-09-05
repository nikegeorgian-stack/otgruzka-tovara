import type { DirectorySection } from '@/lib/directories/types'

const KEY = 'fst.directory.openIntent.v1'

export type DirectoryOpenIntent = {
  section: DirectorySection
  /** Сразу открыть карточку создания */
  create?: boolean
}

export function writeDirectoryOpenIntent(intent: DirectoryOpenIntent): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(intent))
  } catch {
    /* ignore */
  }
}

export function consumeDirectoryOpenIntent(
  section: DirectorySection,
): DirectoryOpenIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DirectoryOpenIntent
    if (parsed.section !== section) return null
    sessionStorage.removeItem(KEY)
    return parsed
  } catch {
    return null
  }
}
