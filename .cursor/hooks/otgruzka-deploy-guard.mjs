/**
 * Otgruzka deploy / data guard — Cursor beforeShellExecution hook.
 * Blocks cloud wipe / overwrite. Reminds agent on UI deploy commands.
 * Stdin: JSON { command, cwd, ... } → stdout: { permission, user_message?, agent_message? }
 */
import { readFileSync } from 'node:fs'

function readInput() {
  try {
    const raw = readFileSync(0, 'utf8')
    if (!raw.trim()) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj))
}

const DENY_PATTERNS = [
  {
    re: /\bnpm\s+run\s+clear:/i,
    why: 'clear:* стирает/чистит облачные данные. Запрещено без явной отдельной просьбы пользователя.',
  },
  {
    re: /\bclear:(hr-cloud|cloud)/i,
    why: 'Скрипт очистки облака запрещён политикой Otgruzka.',
  },
  {
    re: /\bnpm\s+run\s+import:cloud/i,
    why: 'import:cloud* заливает локальный/бэкап стор поверх Firestore — так пропадали ЗП и табель.',
  },
  {
    re: /\bimport:cloud/i,
    why: 'import:cloud* запрещён: источник правды — SQL Connect otgruzka-tovara-service.',
  },
  {
    re: /\bclean:cloud-store:apply\b/i,
    why: 'clean:cloud-store:apply перезаписывает облачный стор. Запрещено.',
  },
  {
    re: /\bfirestore:delete\b|\bdeleteCollection\b/i,
    why: 'Удаление коллекций Firestore запрещено из агентского шелла.',
  },
  {
    re: /firebase\s+deploy[^&\n|;]*--only\s+[^\n]*firestore/i,
    why: 'Деплой Firestore rules/indexes — только по явной просьбе, не как часть «деплой».',
  },
  {
    // firebase deploy of anything that is not hosting-only
    re: /firebase\s+deploy(?![^&\n|;]*--only\s+hosting)/i,
    why:
      'firebase deploy без --only hosting может затронуть rules/данные. Разрешён только: firebase deploy --only hosting --project otgruzka-tovara',
  },
  {
    re: /\bmigrate:sql-connect\b|\bmigrate:cloud-store\b|\bmigrate:firebase-project\b/i,
    why: 'Миграция стора SQL/Firestore не часть «деплой». Только по отдельной явной просьбе.',
  },
]

const ACTIVE_DENY = DENY_PATTERNS

const DEPLOY_RE =
  /deploy:otgruzka|vercel\s+(deploy\s+)?--prod|firebase\s+deploy[^&\n|;]*--only\s+hosting/i

const input = readInput()
const command = String(input.command ?? '')

for (const rule of ACTIVE_DENY) {
  if (rule.re.test(command)) {
    // Allow the one safe hosting-only form even if a broader pattern matched wrongly
    if (
      /firebase\s+deploy/i.test(command) &&
      /--only\s+hosting\b/i.test(command) &&
      !/--only\s+[^\n]*firestore/i.test(command)
    ) {
      continue
    }
    out({
      permission: 'deny',
      user_message: `Otgruzka guard: команда заблокирована.\n${rule.why}`,
      agent_message: `DENIED by otgruzka-deploy-guard: ${rule.why} Используй только UI-деплой: npm run deploy:otgruzka:quick. Не утверждай «задеплоено», пока не сверишь index-*.js на https://otgruzka-tovara.vercel.app. Данные Firestore не трогать.`,
    })
    process.exit(0)
  }
}

if (DEPLOY_RE.test(command)) {
  out({
    permission: 'allow',
    agent_message: [
      'Otgruzka deploy guard: UI-only deploy path.',
      'Checklist before telling user «готово»:',
      '1) tsc --noEmit passed',
      '2) account nikegeorgian / project otgruzka-tovara',
      '3) verify https://otgruzka-tovara.vercel.app bundle index-….js',
      '4) say explicitly: данные Firestore не трогал',
      '5) update docs/DEPLOY.md + fst-session-memory',
      'Read skill otgruzka-deploy-auditor if unsure.',
    ].join(' '),
  })
  process.exit(0)
}

out({ permission: 'allow' })
process.exit(0)
