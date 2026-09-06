# R2.9 — TEST-FULL-CYCLE bug fix report

**Branch:** `fix/r29-test-full-cycle`  
**Base:** `nika/main` @ `179b923`  
**Date:** 2026-09-06  
**Scope:** Preview / local only — **no Production merge, push to main, DC migrate, or UI deploy**

## Commits

| Hash | Summary |
|------|---------|
| `68bef45` | sync: stop false domain_conflict; `formulations.mixTasks` stable path |
| `168668b` | warehouse: authoritative PO receipt; localized forbidden |
| `05f818a` | planner: unique ZP numbers, exact day plans, recipe approve UI |
| *(pending)* | GP SKU required; ship lot i18n; master picker drafts excluded |

## Issue flags A–Q

| ID | Issue | Flag | Root cause / notes |
|----|-------|------|--------------------|
| A | Own writes → domain_conflict | **FIXED** | `conservativeMerge` treated stable-id array diffs as whole-domain conflict; mixTasks missing from stable paths |
| B | Warehouse `forbidden` | **PARTIAL** | G2 principal missing; sysadmin auto-provision + localized keys. WH role principal still needs Preview verify |
| C | PO receipt false success | **FIXED** | Legacy local receive under G1; now authoritative post + ack before toast |
| D | Duplicate `ЗП-2026-001` | **FIXED** | `normalizeProductionOrder` invented `…-001`; allocate on upsert/activate; merge uses `Math.max` for seq; 20-create unit test |
| E | Dates replaced by month | **FIXED** | New order defaults to 7-day window; form dates independent of month filter; even plans sum exactly to qty |
| F | No recipe approve UI | **FIXED** | Submit/approve wired in Technologist recipes panel + `submitFormulationRecipeVersion` |
| G | Mixer task disappears | **FIXED** | `formulations.mixTasks` in `STABLE_ID_COLLECTION_PATHS` (commit 1); reload smoke still needed in Preview |
| H | Water calc dry/total | **FIXED** | Dry excludes water components; water/total from component masses |
| I | ZK → ZP path | **FIXED** (existing) | `planSalesLine` / G5 MRP already create ZP from ZK; direct ZP remains intentional for planner |
| J | Master identical ZP options | **FIXED** | Drafts excluded from workshop picker; labels include number·product·qty·date·status·customer |
| K | GP without warehouse SKU | **FIXED** | Save blocked without `warehouseItemId`; create-and-link remains on loading tab |
| L | FG lot + QC | **FIXED** (existing) | Lot on packaging confirm; OTC release/reject path present |
| M | Shipment no lot silent | **PARTIAL→FIXED** | Gate already returned error; added `production.ship.errLotRequired` i18n so UI is localized |
| N | Dirty after own save | **PARTIAL** | Covered by A for composite self-conflict; full dirty-ack still Preview-verify |
| O | i18n `procurement.overdue` / `common.continue` | **FIXED** | Keys added RU/KA/EN |
| P | Desired vs confirmed delivery date | **NOT_REPRODUCED** / defer | Needs UI copy clarification; no code change this phase |
| Q | Catalogue typo cleanup | **NOT_REPRODUCED** | Data-only; out of code scope |

## Schema

**0 CREATE / 0 ALTER / 0 DROP** in R2.9 (UI/store only).

## Tests run

```text
npx vitest run tests/r29SyncSelfConflict.test.ts   → pass
npx vitest run tests/r29PlannerRecipeFixes.test.ts → 4 pass
npx tsc --noEmit                                   → exit 0
```

## Preview smoke (required before merge)

Tag `TEST-FULL-CYCLE-R29` on Preview only:

1. Approve 100 kg recipe (TEC/DIR) → link GP SKU  
2. ZK 100 m → unique ZP with Sep dates summing to 100  
3. Procurement 18+1 → one receipt → stocks  
4. Persistent mixer task → batch → packaging lot → QC release → shipment  

Record IDs / before-after stock in Preview notes. **Do not** use production employees/timesheets.

## Remaining blockers

1. Preview acceptance smoke not executed in this session  
2. WH non-sysadmin principal provisioning — verify on Preview  
3. Issue P (delivery date labels) deferred  

## Rollback

Revert branch commits or delete branch `fix/r29-test-full-cycle`. Production UI/DC untouched.

## STOP

No merge to main, no Production deploy, no data migration.
