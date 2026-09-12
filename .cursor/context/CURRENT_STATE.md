# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-12
**Канон URL:** https://otgruzka-tovara.vercel.app

## Текущий локальный срез: табель / зарплата (review)

- Worktree: `tabel-cloud-safe-review-timesheet-payroll-20260912`
- Ветка `review/timesheet-payroll-20260912`
- **Итог:** S1–S8 UI на локальном SQLite (Node 22 + `data/tabel-iso-s1s8.db`) PASS; void/draft/confirm reload; S8 snapshot history; brigades wipe = missing/`[]` без аудита refuse, удаление через `directory_change` «Бригада удалена».
- **App fix:** сверка бригады в kanban (ContextBar при раскрытой плитке) — без этого S5/S8 close были невозможны в доске.
- Стенд: `npm run dev:local` (= `dev:db` Node22 + vite) или `scripts/start-iso-stand.ps1`; прогон: `node tmp-preview-smoke/browser-s1s8-ui.mjs`
- **SHA:** `325eaa9489c596d6c3ac3f70259926166202e543` (ветка запушена на `nika`)
- Preview Ready: https://otgruzka-tovara-28t43kv16-nikegeorgian-8562s-projects.vercel.app (alias git-review-t-58519c; SSO Vercel Login)
- Cloud SQL / staging / SMOKE-бригаду не трогали.

_Не хранить секреты / PII / содержимое прод-записей._
