/**
 * Quick check: can we write fstStores doc to Firestore?
 * Run: node fst-web/scripts/test-cloud-save.mjs
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getFirestore, setDoc, serverTimestamp } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

function stripUndefinedDeep(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = stripUndefinedDeep(v)
  }
  return out
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

const email = process.env.FST_ADMIN_EMAIL
const password = process.env.FST_ADMIN_PASSWORD
if (!email || !password) {
  console.error('Задайте FST_ADMIN_EMAIL и FST_ADMIN_PASSWORD в окружении.')
  process.exit(1)
}

const { user } = await signInWithEmailAndPassword(auth, email, password)
console.log('Signed in:', user.uid)

const payload = stripUndefinedDeep({
  version: 6,
  employees: [{ id: '1', fullName: 'Test', hourlyRate: undefined, active: true }],
  settings: { locale: 'ru' },
})

await setDoc(
  doc(db, `fstStores/${user.uid}`),
  {
    payload,
    app: 'FST',
    version: 6,
    updatedAt: serverTimestamp(),
  },
  { merge: true },
)

console.log('Save OK')
