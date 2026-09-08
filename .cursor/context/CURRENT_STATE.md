# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-08  
**Канон URL:** https://otgruzka-tovara.vercel.app

## Git checkpoints (не live HEAD)

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **R2.9L WH locations fallback** | `c11e275` | empty locations picker (Preview hsesh3q6c Ready) |
| **R2.9L null-WH picker+consume** | `000886c` | G2 evidence picker + consume post |
| **R2.9L request.post atomicity** | *(pending commit)* | G3 CAS before soft posted |

### Remote status

| | |
|--|--|
| Active branch | `fix/r29-test-full-cycle` |
| Cycle Preview (prior) | `000886c` · `36e1wkc0q` · Ready |
| Marker | `TEST-CELLOPLEX-UI-CYCLE-20260908` |
| Auth/principal | **ACTIVE rev 35** |

## Текущая задача

**PHASE R2.9L** — `production.request.post` authoritative completion. Recover same line request after new Preview; continue UI cycle.

`R29L_UI_ONLY_END_TO_END_GREEN = false`

---

_Не хранить секреты / PII / содержимое прод-записей._
