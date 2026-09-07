# Otgruzka — текущее состояние (обновлять после значимых сессий)

**Обновлено:** 2026-09-07  
**Канон URL:** https://otgruzka-tovara.vercel.app

## Checkpoints

| | Hash |
|--|------|
| Fix commit (R2.9G overlay) | `65a0c70` |
| Branch | `fix/r29-test-full-cycle` |

## Текущая задача

**R2.9H** — receipt catalogue corruption fix + restore 6 CELLO cards + continue production (staging only).

### Done (code)
- Root cause: G1 PO receipt omitted snapshots → `ensureItemCatalog` stubs `name=itemId` → union preferred critical stubs over SQL cards
- Fix: fail-closed ensureItemCatalog; receipt snapshots; identity-aware union; safe sort
- Backup: `tmp/r29h-backup` fst rev90 / critical rev5

### Next
- Commit/push Preview → guarded identity repair → verify stocks → continue cycle + R29H video → cleanup

Production / main untouched.
