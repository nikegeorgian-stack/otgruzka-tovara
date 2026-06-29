/**
 * Синхронизирует allowlist email в firestore.rules с src/lib/cloud/fstWebAllowedEmails.ts
 * Run: node scripts/sync-firestore-rules.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '../..')
const allowedPath = join(repoRoot, 'src/lib/cloud/fstWebAllowedEmails.ts')
const adminPath = join(repoRoot, 'src/lib/cloud/fstAdmin.ts')
const rulesPath = join(__dirname, '../firestore.rules')

const src = readFileSync(allowedPath, 'utf8')
const match = src.match(/FST_WEB_ALLOWED_EMAILS\s*=\s*\[([\s\S]*?)\]\s*as const/)
if (!match) {
  console.error('Could not parse FST_WEB_ALLOWED_EMAILS from', allowedPath)
  process.exit(1)
}

const adminMatch = readFileSync(adminPath, 'utf8').match(
  /FST_ADMIN_EMAIL\s*=\s*'([^']+)'/,
)
const adminEmail = adminMatch?.[1]?.toLowerCase()
if (!adminEmail) {
  console.error('Could not parse FST_ADMIN_EMAIL from', adminPath)
  process.exit(1)
}

const emails = [
  adminEmail,
  ...[...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase()),
]
const unique = [...new Set(emails)]

const emailLines = unique.map((e) => `          '${e}',`).join('\n')

const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAllowedFstEmail() {
      return request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.lower() in [
${emailLines}
        ];
    }

    match /fstStores/{storeId} {
      allow read, write: if isAllowedFstEmail() && (
        request.auth.uid == storeId ||
        storeId == 'fibercell-main'
      );
    }
  }
}
`

writeFileSync(rulesPath, rules, 'utf8')
console.log('Updated firestore.rules with', unique.length, 'emails:')
for (const e of unique) console.log('  -', e)
