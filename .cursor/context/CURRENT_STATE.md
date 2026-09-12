# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-12
**Канон URL:** https://otgruzka-tovara.vercel.app

## Текущий локальный срез: табель / зарплата (review)

- Worktree: `tabel-cloud-safe-review-timesheet-payroll-20260912`
- Ветка `review/timesheet-payroll-20260912`
- **Итог сессии:** void-merge fix (same postedAt → void wins) + rounding 167.27 (rows/export/snapshot) + brigades wipe (missing≠[]) + LocalDbSync setup race + `dev:db` via Node22.
- Локальный стенд: `npm run dev:local` → SQLite через `scripts/dev-db-node22.ps1` (fnm Node 22); Node 24 без VS C++ не грузит better-sqlite3.
- Browser UI: S1 PASS; S2–S4 ещё нестабильны (плитки бригад / reload); S5–S7 частично; S8 BLOCKED (нет snapshot после close). SQLite path: `data/tabel-iso-s1s8.db`. Cloud SQL не доказан.
- Preview в этом этапе **не** публиковали.
- Staging/prod / SMOKE-бригаду не трогали.

_Не хранить секреты / PII / содержимое прод-записей._
