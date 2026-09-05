/**
 * Smoke: исходник normalizeSuggestion сохраняет adminReply*.
 * Run: node scripts/verify-feedback-reply-normalize.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'src/lib/aiChat/init.ts'), 'utf8')

const markers = [
  'item.adminReply = r.adminReply.trim()',
  'item.adminReplyAt = r.adminReplyAt',
  'item.adminReplyBy = r.adminReplyBy.trim()',
  'notifyFeedbackReplyPush',
]

for (const m of markers.slice(0, 3)) {
  if (!src.includes(m)) {
    console.error('FAIL: missing in normalizeSuggestion:', m)
    process.exit(1)
  }
}

const notifySrc = fs.readFileSync(path.join(root, 'src/lib/cloud/fstPushNotify.ts'), 'utf8')
if (!notifySrc.includes('notifyFeedbackReplyPush')) {
  console.error('FAIL: notifyFeedbackReplyPush missing')
  process.exit(1)
}

const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
if (!appSrc.includes('notifyFeedbackReplyPush')) {
  console.error('FAIL: App.tsx does not wire reply push')
  process.exit(1)
}
if (!appSrc.includes('userLogin: item?.userLogin')) {
  console.error('FAIL: App.tsx does not pass userLogin to notify')
  process.exit(1)
}

const initSrc = fs.readFileSync(path.join(root, 'src/lib/aiChat/init.ts'), 'utf8')
if (!initSrc.includes('item.userLogin')) {
  console.error('FAIL: userLogin not preserved in normalize')
  process.exit(1)
}

console.log('ok: adminReply normalize + reply push + userLogin wired')
