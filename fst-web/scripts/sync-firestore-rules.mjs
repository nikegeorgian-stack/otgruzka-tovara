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

const adminSrc = readFileSync(adminPath, 'utf8')
const adminEmails = [...adminSrc.matchAll(/FST_ADMIN_EMAILS?\s*=\s*\[([\s\S]*?)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase()))
const singleAdmin = adminSrc.match(/FST_ADMIN_EMAIL\s*=\s*'([^']+)'/)?.[1]?.toLowerCase()
if (singleAdmin) adminEmails.unshift(singleAdmin)

const legacyEmails = [
  ...new Set([
    ...adminEmails,
    ...[...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase()),
  ]),
]

const adminOnlyLines = [...new Set(adminEmails)]
  .map((e) => `          '${e}',`)
  .join('\n')
const legacyLines = legacyEmails.map((e) => `        '${e}',`).join('\n')

const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSysAdminEmail() {
      return request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.lower() in [
${adminOnlyLines}
        ];
    }

    function legacyAllowedEmails() {
      return [
${legacyLines}
      ];
    }

    function isAllowedFstEmail() {
      return request.auth != null
        && request.auth.token.email != null
        && (
          isSysAdminEmail()
          || request.auth.token.email.lower() in legacyAllowedEmails()
          || (
            exists(/databases/$(database)/documents/fstConfig/access)
            && request.auth.token.email.lower() in get(/databases/$(database)/documents/fstConfig/access).data.allowedLogins
          )
        );
    }

    match /fstConfig/access {
      allow read: if request.auth != null && request.auth.token.email != null;
      allow write: if isSysAdminEmail();
    }

    match /fstStores/{storeId} {
      allow read, write: if isAllowedFstEmail() && (
        request.auth.uid == storeId ||
        storeId == 'fibercell-main'
      );
    }

    match /fstSyncMeta/{storeId} {
      allow read, write: if isAllowedFstEmail() && (
        request.auth.uid == storeId ||
        storeId == 'fibercell-main'
      );
    }

    match /fstStoreShards/{shardId} {
      allow read, write: if isAllowedFstEmail() && (
        shardId.matches('^' + request.auth.uid + '__.*') ||
        shardId.matches('^fibercell-main__.*')
      );
    }

    match /fstMonthArchive/{archiveId} {
      allow read, write: if isAllowedFstEmail() && (
        archiveId.matches('^' + request.auth.uid + '__.*') ||
        archiveId.matches('^fibercell-main__.*')
      );
    }
  }
}
`

writeFileSync(rulesPath, rules, 'utf8')
console.log('Updated firestore.rules with', legacyEmails.length, 'legacy emails:')
for (const e of legacyEmails) console.log('  -', e)
