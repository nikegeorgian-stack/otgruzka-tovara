# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-02<br>
**Канон URL:** https://otgruzka-tovara.vercel.app

## Confirmed facts

| Поле | Значение | Как подтверждено |
|------|----------|------------------|
| Git `HEAD` (короткий) | `61681f9` | `git rev-parse --short HEAD` на 2026-09-02 (эта сессия валидации) |
| Данные прод | SQL Connect `otgruzka-tovara-service` | `OTGRUZKA.md` |
| UI канон | Vercel `otgruzka-tovara` | `AGENTS.md` / `OTGRUZKA.md` |
| Канон скилов | `.cursor/skills/` only | agent-system refactor 2026-09-02 |

## Last-known (не перепроверялось в этой сессии)

| Поле | Значение | Статус |
|------|----------|--------|
| UI bundle | `index-C1fKaFGo.js` | last-known из прошлой сессии (technologist slice 1 + push табель); **не** re-verified сейчас |
| Commit на момент записи | `61681f9` | был `HEAD` при записи; сверить с текущим `git rev-parse --short HEAD` |

## Текущая задача

Закрытие технических недочётов agent system (frontmatter, skills-lock, hooks schema, память).<br>
Продуктовый срез **канбан технолога / состав ГП** — не начат.

## Выполнено недавно

- Technologist slice 1: `technicalName`, склад для технолога, журналы (код + деплой в прошлой сессии)
- Agent system: always-on сокращены, архив дублей, `project-guardian`, `product-verifier`, `CURRENT_STATE`

## Открытые проблемы

- Полный UI-аудит по разделам — не завершён
- Kanban технолога / состав ГП — только в плане

## Принятые решения

- SQL Connect = данные; Vercel = UI truth
- Always-on: `fst-core-policy`, `fst-data-integrity`, `fst-session-memory`, `fst-skill-router`
- Spec Kit только для крупных фич → обязательно `converge`

## Следующий безопасный шаг

1. После вашего подтверждения этой валидации — `project-guardian` + chain brief «технолог канбан ГП»
2. Тонкий UI-срез (без деплоя, пока не попросите)
3. `product-verifier` → read-only verify на Vercel

## Затронутые модули (ожидаемые на следующем срезе)

`TechnologistPage`, `src/lib/technologist/`, `src/components/kanban/`, coach, i18n RU/KA

## Документы для синхронизации

- Этот файл после значимой сессии
- `docs/DEPLOY.md` — только после реального деплоя с проверкой бандла
- `docs/OTGRUZKA-SKILLS-GUIDE.md` — при смене agent workflow

---

_Не хранить здесь: пароли, токены, cookies, `.env`, ключи, PII, содержимое производственных записей._
