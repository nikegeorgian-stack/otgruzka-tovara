import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

export type FstFirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

function readConfig(): FstFirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!apiKey || !projectId) return null
  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  }
}

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const cfg = readConfig()
    if (!cfg) throw new Error('firebase_not_configured')
    app = initializeApp(cfg)
  }
  return app
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp())
  return auth
}

/** FST web: только Firestore в облаке — localStorage/IndexedDB не используем (лимит квоты). */
const isFstWeb = import.meta.env.VITE_FST_WEB === 'true'

/** IndexedDB-кэш Firestore; web — memory cache (большая база fibercell-main не влезает в IndexedDB). */
export function getFirestoreDb(): Firestore {
  if (!db) {
    const firebaseApp = getFirebaseApp()
    if (isFstWeb) {
      db = initializeFirestore(firebaseApp, { localCache: memoryLocalCache() })
      return db
    }
    try {
      db = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      })
    } catch (err) {
      console.warn('FST: persistent Firestore cache unavailable, using memory cache', err)
      db = initializeFirestore(firebaseApp, { localCache: memoryLocalCache() })
    }
  }
  return db
}
