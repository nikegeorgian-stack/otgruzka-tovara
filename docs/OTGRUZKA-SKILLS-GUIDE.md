# Otgruzka — agent system guide (v2)

**Обновлено:** 2026-09-02 · **Активных скилов:** 53 (`.cursor/skills/` only)

Прод: https://otgruzka-tovara.vercel.app · Данные: SQL Connect · Память: `.cursor/context/CURRENT_STATE.md`

Архив: `docs/agent-system/archive/` · Валидация: `npm run agent:validate`

---

## Always-on rules (короткие)

| Rule | Назначение |
|------|------------|
| `fst-core-policy.mdc` | Источники истины, scope, запреты |
| `fst-data-integrity.mdc` | SQL, anti-wipe |
| `fst-session-memory.mdc` | Индекс → `CURRENT_STATE.md` |
| `fst-skill-router.mdc` | Куда смотреть SKILL.md |

## Scoped rules (по glob / задаче)

| Rule | Когда |
|------|--------|
| `graphify.mdc` | `src/`, `fst-web/` — исследование кода |
| `fst-chain-context.mdc` | Межмодульные правки |
| `fst-architecture.mdc` | Store, ViewId, модули |
| `fst-action-journals.mdc` | `store/slices`, cloud, journals |
| `fst-coach-sync.mdc`, `fst-coach-accompaniment.mdc` | UI, i18n, coach |
| `fst-print-layout.mdc` | print/PDF/Excel |
| `fst-web-prod-truth.mdc` | Баги, проверка прода |
| `fst-deploy-otgruzka.mdc` | Явный деплой |

---

## Subagents

| Agent | Режим | Когда |
|-------|-------|-------|
| **`project-guardian`** | read-only | Store, SQL, роли, склад, ЗП, производство |
| **`product-verifier`** | review | После реализации — diff, tests, journals, coach |
| **`security-auditor`** | read-only | Security review |
| **`timesheet-doc-critic`** | specialized | Табель-документы PASS/FAIL |

Legacy: `docs/agent-system/archive/agents/`

---

## Тип задачи → rule → skill → subagent → проверка

| Тип задачи | Rule | Skill | Subagent | Проверка |
|------------|------|-------|----------|----------|
| Межмодульная фича | chain + architecture | `fst-chain-context`, `fst-domain-invariants` | `project-guardian` | `product-verifier` |
| Табель / ЗП | architecture | `fst-payroll-georgia` | `project-guardian` | tests + Vercel `#/month` |
| Склад | journals | `fst-warehouse-stock` | `project-guardian` | journals + `#/warehouse` |
| UI экран | coach-* | `fst-design-system`, `frontend-ui-engineering` | — | coach audit + Vercel |
| Баг на проде | web-prod-truth | `otgruzka-browser-verify` | — | Vercel Ctrl+F5 |
| Деплой UI | deploy-otgruzka | `otgruzka-deploy-auditor` | — | bundle on Vercel |
| Печать | print-layout | `fst-print-layout`, `print-forms` | — | visual print test |
| SQL / sync | data-integrity | `firebase-data-connect` | `project-guardian` | no clear/import |
| Крупная новая фича | — | `speckit-*` → **`converge`** | `project-guardian` | `product-verifier` |
| Мелкий багфикс | core-policy | domain skill | — | `product-verifier` |
| E2E (будущее) | — | `fst-e2e-critical-flows` | — | test env only |

---

## Spec Kit (только крупные фичи)

1. `speckit-constitution`
2. `speckit-specify`
3. `speckit-clarify` (если нужно)
4. `speckit-plan`
5. `speckit-tasks`
6. `speckit-analyze`
7. `speckit-implement`
8. **`speckit-converge`** — обязательно до «готово»

Мелкий багфикс — **без** Spec Kit.

---

## Workflow

1. Read `CURRENT_STATE.md`
2. `project-guardian` или `npm run agent:chain-brief -- "тема"`
3. `incremental-implementation`
4. `product-verifier`
5. `otgruzka-browser-verify` (UI)
6. Update `CURRENT_STATE.md`

`graphify update .` — после завершённого изменения кода, не каждой строки.

---

## Активные скилы (53)

### Otgruzka / FST
`fst-architecture`, `fst-chain-context`, `fst-domain-invariants`, `fst-design-system`, `fst-e2e-critical-flows`, `fst-payroll-georgia`, `fst-warehouse-stock`, `fst-procurement`, `fst-print-layout`, `fst-action-journals`, `otgruzka-browser-verify`, `otgruzka-deploy-auditor`, `nika-start`, `print-forms`, `html-to-pdf`

### UI / process
`frontend-ui-engineering`, `web-design-guidelines`, `anthropic-frontend-design`, `vercel-react-best-practices`, `vercel-composition-patterns`, `incremental-implementation`, `planning-and-task-breakdown`, `code-simplification`, `code-review-and-quality`, `test-driven-development`, `debugging-and-error-recovery`, `interview-me`, `idea-refine`, …

### Firebase
`firebase-basics`, `firebase-auth-basics`, `firebase-firestore`, `firebase-data-connect`, `firebase-security-rules-auditor`, `firebase-hosting-basics`, `firebase-app-hosting-basics`

### Spec Kit (8)
`speckit-constitution`, `speckit-specify`, `speckit-clarify`, `speckit-plan`, `speckit-tasks`, `speckit-analyze`, `speckit-implement`, `speckit-converge`

Полный список: `ls .cursor/skills`

---

## Архивировано (2026-09-02)

См. [`docs/agent-system/archive/README.md`](agent-system/archive/README.md) — 16 named skills + 39 duplicates, ранее лежавших в устаревшем каталоге `.agents` (не канон, в commit не входит).

Примеры: `ui-ux-pro-max`, `deploy-to-vercel`, `openopc-request-analysis`, `speckit-checklist`, `speckit-taskstoissues`, Firebase crashlytics/remote-config/ai-logic, xcode, extension-to-functions.

Каталог `.agents` deprecated: не источник скилов; канон только `.cursor/skills/`.

---

## Hooks (`.cursor/hooks.json`)

| Event | Script |
|-------|--------|
| `sessionStart` | `session-start.mjs` → CURRENT_STATE index |
| `preCompact` | `pre-compact-reminder.mjs` |
| `stop` | `stop-memory-check.mjs` |
| `beforeShellExecution` | `otgruzka-deploy-guard.mjs` (unchanged) |

---

## Обновление CURRENT_STATE.md

После значимой сессии агент обновляет:

- дату, **именованные baseline/checkpoint** (не live HEAD — его даёт `sessionStart`), bundle (если деплой)
- текущую задачу / выполнено / открытые проблемы
- следующий безопасный шаг, модули, docs to sync

**Не хранить:** пароли, токены, `.env`, PII.

---

## External sources

| Skill | Source |
|-------|--------|
| `vercel-composition-patterns` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/composition-patterns` — see `SOURCE.md` |
| Addy pack (partial) | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — archived duplicates in `docs/agent-system/archive/` |

---

*Канон: `.cursor/skills/` · Rules: `.cursor/rules/` · Agents: `.cursor/agents/`*
