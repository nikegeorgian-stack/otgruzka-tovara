# Implementation Plan: ERP Coherence & Full Audit

**Branch**: `001-erp-coherence` | **Date**: 2026-07-01

## Tech Stack

- React 18 + TypeScript + Vite (existing)
- AppStore v6 monolith + slice pattern (keep Phase 1)
- `@tanstack/react-virtual` for table virtualization (add dependency)
- Existing: `appendAudit`, `appendWarehouseAudit`, `lib/journals/collect.ts`

## Architecture Decisions

### AD-1: Extend AuditEntry, don't replace
Add optional `module?: AuditModule` on write paths; map legacy `action` strings in collector for backfill.

### AD-2: Journal category split in collector only (Phase 1)
Avoid migrating historical `auditLog` entries; classify at collect-time by `action` enum.

### AD-3: Virtualization scope
Phase 1: `PlanFactTable` tbody only. Phase 2: warehouse nomenclature, journals list.

### AD-4: Store subscriptions (Phase 2)
Defer Zustand split; Phase 1 use narrowed `useMemo` + `useSyncExternalStore` pattern on JournalsPage only if needed.

## Phase Breakdown

### Phase A — Audit & Journals (P1, ~3–5 days)

| Task | Files |
|------|-------|
| Extend `JournalCategory` + i18n | `lib/journals/types.ts`, `ru.ts`, `ka.ts` |
| Classify auditLog by action | `lib/journals/collect.ts`, new `lib/journals/classifyAudit.ts` |
| Update `access.ts` role filters | `lib/journals/access.ts` |
| HR audit on upsert/remove | `store/slices/hrSlice.ts`, `lib/audit.ts` action types |
| Access audit | `store/slices/accessSlice.ts` |
| Directories audit (counterparty, product) | `store/slices/directoriesSlice.ts` |
| Sales journal entries | `store/slices/salesSlice.ts`, collect |
| JournalsPage filters for new categories | `JournalsPage.tsx` |

### Phase B — Fixes & Doc Chain (P1, ~2 days)

| Task | Files |
|------|-------|
| Fix negative stock permission | `permissions.ts`, `storage.ts` normalize |
| Procurement journal links to receipt doc | `collect.ts`, `navigate.ts` |
| Production post journal enrichment | `collect.ts`, existing post events |
| Update ARCHITECTURE.md | `docs/ARCHITECTURE.md` |

### Phase C — Performance (P2, ~3–4 days)

| Task | Files |
|------|-------|
| Add `@tanstack/react-virtual` | `package.json` |
| Virtualize PlanFactTable rows | `PlanFactTable.tsx`, `DayCell.tsx` |
| Narrow JournalsPage memo deps | `JournalsPage.tsx` |
| Warehouse nomenclature windowing (optional) | `WarehousePage.tsx` tab |

### Phase D — Dashboard & Cleanup (P3, ~3 days)

| Task | Files |
|------|-------|
| Director KPI panel | `DirectorPage.tsx` or new `ErpDashboardPanel.tsx` |
| Remove deprecated pages | `lazyPages.tsx`, `App.tsx` routes |
| Audit retention warning in Settings | `SettingsPage.tsx` |

## Document Chain Map (target)

```
Sales Order ──► Planner Order ──► Production Request ──► Warehouse Issue/Receipt
      │                                              │
      └──────────► Loading Shipment ─────────────────┘

Purchase Order ──► Receive ──► Warehouse Receipt ──► Movements

Timesheet Fact ──► Finance Calc ──► Payout / Advance (audit: finance)

Employee (HR) ──► Timesheet Row (syncPlanRow)
```

## Risks

| Risk | Mitigation |
|------|------------|
| Firestore 1MB limit | Monitor doc size; Phase 2 split collections |
| Virtualization breaks cell focus/keyboard | Keep existing DayCell API; test roll-call path |
| Audit volume | Raise cap + settings warning; future export |

## Out of Scope (Phase 2+)

- Per-domain Firestore collections
- Multi-user CRDT sync
- Full IT Office ↔ warehouse integration
- Automated ERP posting rules engine
