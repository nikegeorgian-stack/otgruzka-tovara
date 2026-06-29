import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

export const SHARED_STORE_ID = 'fibercell-main'

/** Читает fst-web/.env или .env.production */
export function loadFirebaseEnv() {
  const dir = dirname(fileURLToPath(import.meta.url))
  for (const name of ['.env', '.env.production']) {
    const path = join(dir, '..', name)
    if (!existsSync(path)) continue
    const env = Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
    if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) return env
  }
  throw new Error('Не найден fst-web/.env или fst-web/.env.production с ключами Firebase')
}

export function requireAdminPassword() {
  const password = process.env.FST_ADMIN_PASSWORD
  if (password) return password
  console.error('Задайте пароль admin@fibercell.net:')
  console.error('  $env:FST_ADMIN_PASSWORD="..."; npm run clear:hr-cloud')
  console.error('  или:  powershell -ExecutionPolicy Bypass -File scripts\\clear-hr-cloud.ps1')
  process.exit(1)
}

export async function connectCloudFirebase() {
  const env = loadFirebaseEnv()
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
  })
  const auth = getAuth(app)
  const db = getFirestore(app)
  const email = process.env.FST_ADMIN_EMAIL ?? 'admin@fibercell.net'
  await signInWithEmailAndPassword(auth, email, requireAdminPassword())
  console.log('Вход:', email)
  return { db, auth, email }
}
