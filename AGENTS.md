# FST — табель и склад

Учётная система (табель/HR, склад, закупки, производство, технолог, финансы) на
React + TypeScript + Vite + Tailwind. Десктоп и веб используют **общий код** в `src/`.

## Otgruzka (текущий прод)

| | |
|--|--|
| UI (канон) | https://otgruzka-tovara.vercel.app |
| Hosting | https://otgruzka-tovara.web.app |
| Firebase | `otgruzka-tovara` |
| **Данные** | **только SQL Connect** (`otgruzka-tovara-service`) |

Политика данных и анти-wipe: **`OTGRUZKA.md`**, правило агента: `.cursor/rules/fst-data-integrity.mdc`.<br>
Деплой по слову «деплой»: `npm run deploy:otgruzka:quick` — **только UI**, без трогания SQL/Firestore.

## Агент цепочек (перед правками в Cursor)

Перед коррекциями агент собирает связи модулей (graphify) и пишет бриф:

```powershell
npm run agent:chain-brief -- "тема" [СимволA] [СимволB]
```

- Скил: `.cursor/skills/fst-chain-context/SKILL.md`
- Правило: `.cursor/rules/fst-chain-context.mdc`
- Вывод: `.cursor/context/CHAIN_BRIEF.md`
- В приложении (Настройки, доступ управления): панель «Агент цепочек»

## Структура

- `src/` — всё приложение (общий код десктопа и веба).
- `fst-web/` — обёртка веб-версии (Firebase). Алиас `@` → корневой `src/`.
- `server/` — бэкенд (auth, CEC, трекинг контейнеров).
- `docs/` — документация: `ARCHITECTURE.md`, `CLOUD_INTEGRATION.md`,
  `TECHNOLOGIST_QC.md`, **`DEPLOY.md`**, **`PLATFORMS.md`** (веб / APK / Windows).
- **`OTGRUZKA.md`** — источник данных прод (SQL Connect only).

## Деплой

См. `docs/DEPLOY.md` и `OTGRUZKA.md`. Для Otgruzka из корня:

```powershell
npm run deploy:otgruzka:quick
```

- Vercel (канон): https://otgruzka-tovara.vercel.app
- Firebase Hosting: https://otgruzka-tovara.web.app

Логин приложения: `admin@fibercell.net` (Firebase Auth проекта `otgruzka-tovara`).

## Конвенции

- Язык интерфейса: RU/KA (i18n в `src/i18n`, функции `t` / `tf`).
- Печать: стили в `src/styles/print.css`; для PDF (html2canvas) бордеры ≥ `1px`,
  избегать субпиксельных рамок и слишком мелкого текста.
- Перед коммитом: `npx tsc --noEmit` должен проходить без ошибок.

## Срезы на дату и время (as-of)

Для отчётов «на момент» используйте единый паттерн:

- **Хук:** `useAsOfSnapshot()` — состояние `enabled`, `date`, `time`, `scope`, `asOfIso`.
- **UI:** `AsOfSnapshotBar` из `@/components/asOf/AsOfSnapshotBar` (ключи i18n `asOf.*`).
- **Утилиты:** `@/lib/asOf/snapshot` (`buildAsOfIso`, `recordsBeforeAsOf`, `warehouseStoreAsOf`).
- **Склад:** `computeAllBalancesAsOf` / `movementsBeforeAsOf`.
- **Производство:** `summarizeProductionDay(..., asOfIso?)`, фильтр заявок по `postedAt`.
- **Финансы:** `monthStatement(store, month, asOfDate?)`, `employeeLedger(..., asOfDate?)`.
- **Журналы:** `filterJournalEntries(..., { asOfIso })`.

В новых экранах с остатками, движениями или KPI добавляйте `AsOfSnapshotBar` и передавайте `asOfIso`/`asOfDate` в расчётные функции, а не дублируйте логику фильтрации в компонентах.

## Spec Kit (только крупные новые фичи)

- **Цикл:** `constitution` → `specify` → `clarify?` → `plan` → `tasks` → `analyze` → `implement` → **`converge`**
- Мелкий багфикс — **без** Spec Kit
- Инфра: `.specify/`, скилы `.cursor/skills/speckit-*`

## Agent system (2026-09-02)

- **Память:** `.cursor/context/CURRENT_STATE.md` (короткий индекс в `fst-session-memory.mdc`)
- **Guardian:** subagent `project-guardian` (read-only) перед межмодульными правками
- **Verify:** subagent `product-verifier` после реализации
- **Гид:** [`docs/OTGRUZKA-SKILLS-GUIDE.md`](docs/OTGRUZKA-SKILLS-GUIDE.md)
- **Скилы:** только `.cursor/skills/` (архив: `docs/agent-system/archive/`)

## Skills после перелогина Cursor

Скилы лежат **в папке проекта** (не в аккаунте Cursor). После re-login папка не стирается.

| Группа | Скилы | Назначение |
|--------|-------|------------|
| Ядро FST | `fst-architecture`, `fst-domain-invariants`, `fst-payroll-georgia`, `fst-warehouse-stock`, `fst-procurement` | домен |
| Otgruzka | `otgruzka-browser-verify`, `otgruzka-deploy-auditor`, `fst-design-system`, `fst-e2e-critical-flows` | прод, UI, E2E |
| Subagents | `project-guardian`, `product-verifier`, `security-auditor`, `timesheet-doc-critic` | `.cursor/agents/` |
| Speckit | 8 active (`speckit-*`) | крупные фичи → **`converge`** |
| Firebase | `firebase-*`, `firebase-hosting-basics` | Auth, SQL Connect, Hosting |
| Vercel | `vercel-react-best-practices`, `vercel-composition-patterns` | React |
| Роутер | `fst-core-policy`, `fst-skill-router`, `fst-data-integrity` | always-on (короткие) |

**Единый гид (задача→скил, сценарии, каталог):** [`docs/OTGRUZKA-SKILLS-GUIDE.md`](docs/OTGRUZKA-SKILLS-GUIDE.md)

Прод Otgruzka: https://otgruzka-tovara.vercel.app · данные = SQL Connect · см. `OTGRUZKA.md`.<br>
Если скилы «не видны» в чате — открой **новый чат** в этой папке проекта.
