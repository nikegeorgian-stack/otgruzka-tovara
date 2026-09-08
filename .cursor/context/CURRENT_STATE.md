# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-08  
**Канон URL:** https://otgruzka-tovara.vercel.app

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

## Текущая задача

**PHASE R2.9L** — request.post atomicity landed; same request recovered; packaging.confirm → FG QC pending in OTC queue.

`R29L_UI_ONLY_END_TO_END_GREEN = false` (OTC passport/protocol gate before release→sales→ship)

---

_Не хранить секреты / PII / содержимое прод-записей._
