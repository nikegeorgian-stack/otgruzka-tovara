# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-12
**Канон URL:** https://otgruzka-tovara.vercel.app

## Текущий локальный срез: табель / зарплата

- Ветка `fix/timesheet-payroll-integrity-20260912`, база `2aa68ff4800a3538832c365bfe99c633bb9cc629`.
- Реализованы frozen v2 snapshots/history, reclose, employee aggregation, tetri, единое OT allocation, overnight punches, explicit fact confirmation, durable local drafts, document void restoration, fresh signoff and close readiness.
- Проверки: 112/112 тестов, общий TypeScript, web TypeScript/build; product-verifier PASS WITH NOTES (замечания устранены), timesheet-doc-critic PASS.
- Новых ошибок scoped lint нет; 30 ошибок в трёх больших файлах подтверждены на исходном HEAD и оставлены вне задачи.
- Прод/SQL/Firebase/deployment не изменялись. Локальный браузерный E2E недоступен из Cloud Browser; нужен Preview E2E на синтетических данных перед выпуском.
- Передача: `docs/payroll/TIMESHEET-PAYROLL-2026-09-12.md`, проверка `docs/payroll/VALIDATION-2026-09-12.md`.
- Открытый расчёт сохраняет наследование плана; explicit confirmation обязателен для закрытия. F09 server roles, server per-op ACK, dated rate history/absence docs and Gross/Net policy не входят в пакет. Не объявлять весь аудит закрытым или изменения выпущенными в облако.

Ниже — исторический статус производственной цепочки из предыдущих сессий, не подтверждение текущего deployment.

## Git checkpoints (не live HEAD)

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **R2.9L WH locations fallback** | `c11e275` | empty locations picker |
| **R2.9L null-WH picker+consume** | `000886c` | G2 evidence picker + consume post |
| **R2.9L request.post atomicity** | `4bd01fd` / `5dc2f27` | G3 CAS before soft posted |
| **R2.9L pack unblock** | `1446743` / `d9d8e53` / `fe101b2` | bindings overlay, WIP realign, shiftReports |

### Remote status

| | |
|--|--|
| Active branch | `fix/r29-test-full-cycle` (nika) |
| Cycle Preview | `fe101b2` · `55elsi46o` · Ready |
| Marker | `TEST-CELLOPLEX-UI-CYCLE-20260908` |
| Auth/principal | cleanup after session |

## Предыдущая задача

**PHASE R2.9L** — request.post atomicity landed; same request recovered; packaging.confirm → FG QC pending in OTC queue.

`R29L_UI_ONLY_END_TO_END_GREEN = false` (OTC passport/protocol gate before release→sales→ship)

---

_Не хранить секреты / PII / содержимое прод-записей._
