# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-06  
**Канон URL:** https://otgruzka-tovara.vercel.app

## Git checkpoints (не live HEAD)

| Checkpoint | Hash | Смысл |
|------------|------|--------|
| **Product baseline** | `61681f9` | Подтверждённая база продукта |
| **R2.8B DC prep** | `d4ede84` | Additive Production Data Connect |
| **nika/main (merge)** | `179b923` | Merge safety → main (base for R2.9) |
| **R2.9 code** | `05f818a`+ | fix/r29-test-full-cycle — sync, receipt, ZP/dates/recipe (Preview only) |

### Remote status

| | |
|--|--|
| Active branch | `fix/r29-test-full-cycle` (ahead of nika/main) |
| Production UI | **не трогать** |
| Production Data Connect | R2.8B deployed; R2.9 **не** деплоит DC/UI в Production |

## Текущая задача

**PHASE R2.9** — TEST-FULL-CYCLE bug fix, Preview/local only — **код готов к review; STOP before merge**.

### Сделано
- P0 A–G (A,C,D,E,F,G FIXED; B PARTIAL — Preview verify WH principal)
- P1 H,J,K,M FIXED; I/L existing FIXED; P deferred
- P2 O FIXED; N PARTIAL (depends on A)
- Report: `docs/R29_TEST_FULL_CYCLE_FIX_REPORT.md`
- Tests: `r29SyncSelfConflict`, `r29PlannerRecipeFixes`; tsc clean

### Осталось
- Preview smoke `TEST-FULL-CYCLE-R29`
- Review → merge только после явного OK пользователя

## Следующий шаг

Preview smoke + product-verifier; **не** merge / Production deploy без просьбы.

---

_Не хранить секреты / PII / содержимое прод-записей._
