/**
 * Копирует данные админа → fstStores/fibercell-main (общая база для HR).
 * Run: $env:FST_ADMIN_PASSWORD="..."; node scripts/migrate-shared-store.mjs
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc, getFirestore, setDoc, serverTimestamp } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_UID = 'OKp2JjSjdTVc8jhX2SjHICcVSV63'
const SHARED_ID = 'fibercell-main'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

const email = process.env.FST_ADMIN_EMAIL ?? 'admin@fibercell.net'
const password = process.env.FST_ADMIN_PASSWORD
if (!password) {
  console.error('Задайте FST_ADMIN_PASSWORD (пароль admin@fibercell.net в Firebase)')
  process.exit(1)
}

await signInWithEmailAndPassword(auth, email, password)
console.log('Вход:', email)

const sharedRef = doc(db, `fstStores/${SHARED_ID}`)
const sharedSnap = await getDoc(sharedRef)
if (sharedSnap.exists() && sharedSnap.data()?.payload?.employees?.length > 0) {
  console.log('Общая база уже заполнена — миграция не нужна.')
  process.exit(0)
}

const legacySnap = await getDoc(doc(db, `fstStores/${ADMIN_UID}`))
if (!legacySnap.exists() || !legacySnap.data()?.payload) {
  console.log('Старых данных админа нет — войдите admin на сайт один раз.')
  process.exit(0)
}

const data = legacySnap.data()
await setDoc(sharedRef, {
  payload: data.payload,
  app: 'FST',
  version: data.version ?? 6,
  updatedAt: serverTimestamp(),
  migratedFrom: ADMIN_UID,
})

const n = data.payload?.employees?.length ?? 0
console.log(`Готово: fstStores/${SHARED_ID} — ${n} сотрудников. HR видит те же данные.`)
