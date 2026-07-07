/**
 * Переключает приложение на Firebase-проект из .env.target
 * (обновляет firebase.client.json и .firebaserc).
 *
 * Run: npm run switch:firebase-project
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from './_firebaseEnv.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { env } = loadEnvFile('target')
const projectId = env.VITE_FIREBASE_PROJECT_ID

const clientJson = {
  VITE_FIREBASE_API_KEY: env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: projectId,
  VITE_FIREBASE_STORAGE_BUCKET:
    env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  VITE_FIREBASE_APP_ID: env.VITE_FIREBASE_APP_ID ?? '',
  VITE_FST_WEB: 'true',
}

writeFileSync(join(root, 'firebase.client.json'), JSON.stringify(clientJson, null, 2) + '\n', 'utf8')

const firebasercPath = join(root, '.firebaserc')
const firebaserc = existsSync(firebasercPath)
  ? JSON.parse(readFileSync(firebasercPath, 'utf8'))
  : { projects: {} }
firebaserc.projects = firebaserc.projects ?? {}
firebaserc.projects.default = projectId
writeFileSync(firebasercPath, JSON.stringify(firebaserc, null, 2) + '\n', 'utf8')

console.log(`Переключено на Firebase-проект: ${projectId}`)
console.log('  firebase.client.json — обновлён')
console.log('  .firebaserc — default =', projectId)
console.log('\nДальше: git commit, deploy rules, vercel --prod')
