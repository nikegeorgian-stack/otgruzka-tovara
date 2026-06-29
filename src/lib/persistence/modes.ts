import { USE_LOCAL_DB } from '@/lib/localDb/config'

export type PersistenceMode = 'sqlite' | 'localStorage' | 'firestore'

export function getPersistenceMode(): PersistenceMode {
  if (import.meta.env.VITE_FST_WEB === 'true') return 'firestore'
  if (USE_LOCAL_DB) return 'sqlite'
  return 'localStorage'
}

export function persistenceModeLabel(mode: PersistenceMode): string {
  switch (mode) {
    case 'sqlite':
      return 'SQLite (data/tabel.db)'
    case 'firestore':
      return 'Firebase Firestore (fst-uchet)'
    case 'localStorage':
      return 'localStorage браузера'
  }
}
