# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-02<br>
**Канон URL:** https://otgruzka-tovara.vercel.app

## Git checkpoints (не live HEAD)

**Live HEAD** определяется при каждом `sessionStart` (`git rev-parse --short HEAD`). Этот файл **не** хранит live HEAD как постоянную истину.

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **Product baseline** | `61681f9` | Последняя подтверждённая база прикладного продукта до agent-system commit |
| **Agent-system baseline** | `90cc6f0` | Локальный проверенный commit agent-system (consolidate skills + memory) |

### Remote status (на момент последней проверки)

| | |
|--|--|
| Локальная ветка | `master`, commit `90cc6f0` **не отправлен** |
| `nika/main` | `61681f9` |
| Push | Ждёт осознанного product deployment **или** отдельной настройки подавления Vercel Git deployment |

## Confirmed facts

| Поле | Значение | Как подтверждено |
|------|----------|------------------|
| Данные прод | SQL Connect `otgruzka-tovara-service` | `OTGRUZKA.md` |
| UI канон | Vercel `otgruzka-tovara` | `AGENTS.md` / `OTGRUZKA.md` |
| Канон скилов | `.cursor/skills/` only | agent-system refactor 2026-09-02 |

## Last-known (не перепроверялось в этой сессии)

| Поле | Значение | Статус |
|------|----------|--------|
| UI bundle | `index-C1fKaFGo.js` | last-known из прошлой сессии (technologist slice 1); **не** re-verified сейчас |

## Текущая задача

Доводка agent-system: baseline-память без drift live HEAD, sessionStart с live Git, локальная уборка мусора.<br>
Продуктовый срез **канбан технолога / состав ГП** — не начат.

## Выполнено недавно

- Agent-system commit `90cc6f0` локально: skills, archive, guardian, hooks, validate tooling
- Technologist slice 1: `technicalName`, склад для технолога, журналы (код + деплой в прошлой сессии)

## Открытые проблемы

- Push `90cc6f0` → возможен Vercel production deploy без отдельной настройки
- Полный UI-аудит по разделам — не завершён
- Kanban технолога / состав ГП — только в плане

## Принятые решения

- SQL Connect = данные; Vercel = UI truth
- Always-on: `fst-core-policy`, `fst-data-integrity`, `fst-session-memory`, `fst-skill-router`
- Spec Kit только для крупных фич → обязательно `converge`
- CURRENT_STATE хранит **именованные baseline**, не live HEAD

## Следующий безопасный шаг

1. Staging/commit доводки памяти + sessionStart (без push)
2. При необходимости push — сначала Vercel git deploy policy, затем `nika/main`
3. `project-guardian` + chain brief «технолог канбан ГП» перед продуктовым срезом

## Затронутые модули (ожидаемые на следующем срезе)

`TechnologistPage`, `src/lib/technologist/`, `src/components/kanban/`, coach, i18n RU/KA

## Документы для синхронизации

- Этот файл после значимой сессии (baseline/checkpoint, не live HEAD)
- `docs/DEPLOY.md` — только после реального деплоя с проверкой бандла
- `docs/OTGRUZKA-SKILLS-GUIDE.md` — при смене agent workflow

---

_Не хранить здесь: пароли, токены, cookies, `.env`, ключи, PII, содержимое производственных записей._
