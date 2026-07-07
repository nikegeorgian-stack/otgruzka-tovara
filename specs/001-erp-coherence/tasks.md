# Tasks: ERP Coherence & Full Audit

**Input**: `specs/001-erp-coherence/spec.md` + `plan.md`

## Phase A — Audit & Journals (P1)

- [x] A1 Add journal categories: `finance`, `hr`, `access`, `sales`, `directories` in `types.ts` + i18n
- [x] A2 Create `lib/journals/classifyAudit.ts` — map `AuditEntry.action` → category
- [x] A3 Refactor `collect.ts` timesheet loop to use classifier (finance no longer under timesheet)
- [x] A4 Update `lib/journals/access.ts` — finance role sees `finance`; HR sees `hr` + timesheet
- [x] A5 `appendAudit` in `hrSlice.upsertEmployee` / remove with detail (name, brigade delta)
- [x] A6 `appendAudit` in `accessSlice.upsertAppUser`, `setRoleViews`, remove user
- [x] A7 `appendAudit` on counterparty + finishedProduct upsert (directoriesSlice)
- [x] A8 Sales: journal entries on order status change + link in `navigate.ts`
- [x] A9 JournalsPage: filter chips for new categories; fix counts

## Phase B — Fixes & Document Chain (P1)

- [x] B1 Fix `roleAllowsNegativeStock()` — read `access.roleAllowNegativeStock[roleId]`
- [x] B2 Stop `normalizeV6Store` from clearing `roleAllowNegativeStock`
- [x] B3 Procurement collect: link journal entry → warehouse document id when receive creates receipt
- [x] B4 Production collect: include post-to-warehouse events from warehouse audit
- [x] B5 Update `docs/ARCHITECTURE.md` (slices list, production→warehouse, audit dual-log)

## Phase C — Performance (P2)

- [x] C1 Add `@tanstack/react-virtual` dependency
- [x] C2 Virtualize `PlanFactTable` visible rows (preserve sticky headers + brigade groups)
- [x] C3 JournalsPage: memo on `[auditLog, warehouse, production, …]` not full store
- [x] C4 Profile MonthPage edit path; fix obvious re-render leaks if found

## Phase D — Dashboard & Cleanup (P3)

- [x] D1 Executive KPI strip on Director or Summary (open POs, fact hours, stock deficits)
- [x] D2 Redirect deprecated views `employees`, `codes`, `pay` → directories/finance/month
- [x] D3 Settings: show audit log fill level (500 cap warning)
- [x] D4 IT Office journal category (optional)

## Phase E — Convergence (after implement)

- [x] E1 Run `/speckit-converge` against spec acceptance scenarios (code + prod assets verified 2026-07-01)
- [x] E2 Manual test: master roll-call + warehouse post + finance advance → journals filter correctly (`npm run test:e2`, 14/14 passed 2026-07-02)
