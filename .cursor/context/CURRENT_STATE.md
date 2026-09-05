# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-05<br>
**Канон URL:** https://otgruzka-tovara.vercel.app

## Git checkpoints (не live HEAD)

**Live HEAD** определяется при каждом `sessionStart` (`git rev-parse --short HEAD`). Этот файл **не** хранит live HEAD как постоянную истину.

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **Product baseline** | `61681f9` | Последняя подтверждённая база прикладного продукта до agent-system commit |
| **Agent-system baseline** | `90cc6f0` | Локальный проверенный commit agent-system (consolidate skills + memory) |
| **R2.6 staging smoke** | `835c0f6` | Storage signed-upload + revoked-token Preview green (ветка safety/…) |

### Remote status (на момент последней проверки)

| | |
|--|--|
| Safety branch | `safety/cloud-data-integrity-20260902` → `nika` (Preview only) |
| Production | **не трогать** — STOP before merge/Production deploy |

## Confirmed facts

| Поле | Значение | Как подтверждено |
|------|----------|------------------|
| Данные прод | SQL Connect `otgruzka-tovara-service` | `OTGRUZKA.md` |
| UI канон | Vercel `otgruzka-tovara` | `AGENTS.md` / `OTGRUZKA.md` |
| Staging Firebase | `otgruzka-tovara-stg` · Storage `EUROPE-WEST3` deny-all | R2.6 |
| Канон скилов | `.cursor/skills/` only | agent-system refactor 2026-09-02 |

## Текущая задача

R2.6 закрыт на Preview: Storage QC signed-upload + revoked-token poll зелёные; cleanup Auth/Storage/synth = 0.<br>
**STOP** — без merge и без Production deploy.

## Выполнено недавно

- R2.6: `resolveFirebaseStorageBucket`, `checkRevoked=true`, signed-upload `x-goog-if-generation-match`, smoke `scripts/r26-preview-principal-smoke.mjs`
- Preview Ready: `dpl_6uiiDX5dKLm3BijCc2cPXJsiQ1Nk` (commit `835c0f6`)

## Открытые проблемы

- Merge / Production deploy — не начаты (осознанный STOP)
- Полный UI-аудит по разделам — не завершён

## Следующий безопасный шаг

1. Review + merge decision (отдельная просьба)
2. Production UI deploy — только по слову «деплой»

## Документы для синхронизации

- Этот файл после значимой сессии (baseline/checkpoint, не live HEAD)
- `docs/DEPLOY.md` — только после реального деплоя с проверкой бандла

---

_Не хранить здесь: пароли, токены, cookies, `.env`, ключи, PII, содержимое производственных записей._
