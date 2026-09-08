# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-08  
**Канон URL:** https://otgruzka-tovara.vercel.app

## Git checkpoints (не live HEAD)

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **Product baseline** | `61681f9` | Подтверждённая база продукта |
| **R2.9I atomic batchMix** | `69b9022` | G2 batchMix.confirm |
| **R2.9J G2 test debt** | `c3ce62e` | G2 lifecycle snapshots fixtures |
| **R2.9K UI authority** | *(after commit)* | web fail-closed + G3/G4 activate UI |

### Remote status

| | |
|--|--|
| Active branch | `fix/r29-test-full-cycle` |
| Production UI | **не трогать** |
| Staging cycle marker | `TEST-CELLOPLEX-UI-CYCLE-20260908` |

## Текущая задача

**PHASE R2.9K** — authoritative UI for QC / packaging / FG / shipment on staging.

### Сделано (код)
- Web fail-closed: soft packaging / QC release / shift / shipment / sales confirm refuse when G3/G4/G5 inactive
- UI panel G3→G4 activate on Planner → MRP
- Tests: `r29kUiAuthoritativeFailClosed`, G4 R29K extras

### Следующий шаг
Staging Preview smoke UI-only after domain activate; cleanup Auth.

---

_Не хранить секреты / PII / содержимое прод-записей._
