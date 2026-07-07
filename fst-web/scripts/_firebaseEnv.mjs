import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

export const SHARED_STORE_ID = 'fibercell-main'

const ENV_FILES = {
  source: ['.env', '.env.production', 'firebase.client.json'],
  target: ['.env.target'],
}

function parseEnvFile(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
      }),
  )
}

export function loadEnvFile(kind) {
  const names = ENV_FILES[kind]
  for (const name of names) {
    const path = join(scriptsDir, '..', name)
    if (!existsSync(path)) continue
    const env = parseEnvFile(path)
    if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) return { env, path }
  }
  if (kind === 'target') {
    throw new Error(
      'Создайте fst-web/.env.target с ключами НОВОГО Firebase-проекта (см. .env.target.example)',
    )
  }
  throw new Error('Не найден fst-web/.env или .env.production с ключами Firebase (источник)')
}

export function firebaseConfigFromEnv(env) {
  const projectId = env.VITE_FIREBASE_PROJECT_ID
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  }
}

export async function connectFirebase({ env, label, email, password, appName }) {
  const app = initializeApp(firebaseConfigFromEnv(env), appName)
  const auth = getAuth(app)
  const db = getFirestore(app)
  await signInWithEmailAndPassword(auth, email, password)
  console.log(`[${label}] Вход: ${email} → ${env.VITE_FIREBASE_PROJECT_ID}`)
  return { app, auth, db }
}

export async function disconnectFirebase({ app, auth }) {
  await signOut(auth).catch(() => {})
  await deleteApp(app).catch(() => {})
}

export function requirePassword(envName) {
  const password = process.env[envName]
  if (password) return password
  console.error(`Задайте пароль: $env:${envName}="..."`)
  process.exit(1)
}
