# FST / FiberCell Constitution

## Core Principles

### I. Single Source of Truth (Document Chain)
Every business event MUST trace to a document or journal entry: receipt, issue, transfer,
production request, purchase order, timesheet fact, payout. UI actions that change stock,
payroll, or master data MUST leave an auditable trail with actor, timestamp, and entity ref.

### II. Domain Logic in `lib/`, Orchestration in Slices
Pure functions live in `src/lib/<domain>/`. Slices only patch `AppStore` and call `appendAudit`.
No business rules duplicated in React components.

### III. Cross-Module Links Are Explicit
Integrations (procurement→warehouse, production→warehouse, sales→loading, finance→timesheet)
MUST use named lib functions (`receivePurchaseOrderInStore`, `postProductionRequestToWarehouse`, …).
New links require journal collector coverage and navigation from JournalsPage.

### IV. i18n Dual Language (NON-NEGOTIABLE)
All user-facing strings in `src/i18n/ru.ts` AND `src/i18n/ka.ts`. New roles/views register in
all 8 places per `fst-architecture` skill.

### V. Performance by Design
Lists >100 rows MUST use virtualization or incremental render. Journal/audit collectors MUST
NOT depend on entire `store` reference when a slice suffices. Heavy pages lazy-loaded.

### VI. Minimal Diff, Existing Conventions
Extend slices and lib modules; avoid parallel patterns. Prefer enhancing Journals + unified
audit over new siloed logs.

## ERP Coherence Standards

- **Audit**: global `auditLog` for HR, finance, access, directories; warehouse keeps
  `warehouse.auditLog` for stock ops; Journals MUST categorize correctly (not finance→timesheet).
- **Roles**: `roleViews` + journal category scoping; destructive ops gated (e.g. unpost=sysadmin).
- **Master data**: employee, counterparty, nomenclature changes audited before ERP v2 complete.
- **Closed periods**: month close blocks timesheet/finance; warehouse month close respected.

## Quality Gates

- `npx tsc --noEmit` green before merge.
- Touch finance/warehouse/timesheet: verify journal entry appears.
- No secrets in git (.env, credentials).

## Governance

Constitution overrides ad-hoc feature requests. Amend via `/speckit-constitution`.
Implementation follows spec → plan → tasks → implement → converge.

**Version**: 1.0.0 | **Ratified**: 2026-07-01 | **Project**: FST tabel
