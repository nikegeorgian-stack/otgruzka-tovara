# Feature Specification: ERP Coherence & Full Audit

**Feature Branch**: `001-erp-coherence`

**Created**: 2026-07-01

**Status**: Approved for planning

**Input**: Transform FST into a coherent ERP with full audit trail, clear cross-module links,
and fast UI on factory-scale data.

## Current State Summary

FST is a mature monolithic-state factory ERP (React/TS, AppStore v6). Strong cores: **timesheet**,
**warehouse**, **production**, **procurement receive→warehouse**, **finance payroll**. Gaps:
mislabeled journals, unaudited master-data/access changes, no virtualization, single Firestore doc limit.

## User Scenarios & Testing

### User Story 1 - Unified Audit Trail (Priority: P1)

As **director / sysadmin**, I open **Журналы** and see every significant action (finance, HR edit,
warehouse, procurement, production post, access change) with correct category, actor, date, link to source.

**Why P1**: Without trustworthy audit, ERP cannot be "шикарный" for compliance and dispute resolution.

**Independent Test**: Change employee brigade, post warehouse receipt, give advance — each appears in
journal with correct category and open link.

**Acceptance Scenarios**:

1. **Given** finance advance recorded, **When** user filters journal by Finance, **Then** entry shows
   category `finance`, not `timesheet`.
2. **Given** HR edits employee, **When** saved, **Then** global audit + journal entry with employee link.
3. **Given** access role changed, **When** admin saves user, **Then** audit entry with user id and diff summary.

---

### User Story 2 - Document Chain Visibility (Priority: P1)

As **warehouse keeper / procurement**, I follow **PO → receipt → stock movement** and **production request
→ issue/receipt** in one place (journals + document links).

**Why P1**: Core ERP value is traceability across modules.

**Acceptance Scenarios**:

1. **Given** procurement order received, **When** opening journal entry, **Then** navigate to warehouse
   receipt document and PO.
2. **Given** production request posted, **When** opening journal, **Then** see linked warehouse documents.

---

### User Story 3 - Fast Timesheet & Warehouse Grids (Priority: P2)

As **master / HR**, I scroll 200+ employees × 31 days without UI freeze (<100ms interaction feedback).

**Why P2**: Factory scale; current PlanFactTable renders all DOM cells.

**Acceptance Scenarios**:

1. **Given** month with 250 rows, **When** scrolling plan/fact table, **Then** smooth scroll, no >500ms block.
2. **Given** warehouse 2000 SKUs, **When** filtering nomenclature, **Then** results in <300ms.

---

### User Story 4 - Executive Dashboard (Priority: P3)

As **director**, I see KPI strip: plan/fact hours, open POs, stock alerts, production backlog, finance remaining.

**Why P3**: Summary page is timesheet-only today.

---

### Edge Cases

- Month closed: audit still readable; mutations blocked with clear message.
- Audit cap overflow: oldest archived or count shown, not silent drop without warning.
- Offline SQLite vs Firestore: audit shape identical.

## Requirements

### Functional Requirements

- **FR-001**: Add `finance`, `hr`, `access`, `sales`, `directories` journal categories.
- **FR-002**: Split `collect.ts` timesheet bucket — map `auditLog` entries by `action` to correct category.
- **FR-003**: `appendAudit` on `upsertEmployee`, access user/role changes, counterparty/product upserts.
- **FR-004**: Sales order status changes appear in journals with link to Director/sales order.
- **FR-005**: Fix `roleAllowsNegativeStock` to read `access.roleAllowNegativeStock`; stop clearing on normalize.
- **FR-006**: Virtualize `PlanFactTable` body (react-window or @tanstack/react-virtual).
- **FR-007**: JournalsPage `useMemo` deps narrowed to relevant store slices.
- **FR-008**: IT Office handover/consumable events optional journal category (P3).
- **FR-009**: Deprecated views (`employees`, `codes`, `pay`) hard-redirect or remove.
- **FR-010**: Update `docs/ARCHITECTURE.md` to match production→warehouse posting.

### Key Entities

- **AuditEntry**: id, at, action, module, entityType, entityId, detail, actorId, actorName.
- **JournalEntry**: unified view over audit + domain events with `JournalLink` navigation.
- **DocumentChain**: procurementOrderId ↔ warehouseDocumentId ↔ movements.

## Success Criteria

- **SC-001**: 100% of finance audit actions appear under Finance filter in journals.
- **SC-002**: HR employee save generates audit entry within same save transaction.
- **SC-003**: PlanFactTable 200 rows: scroll FPS usable on mid-range laptop (subjective: no multi-second freezes).
- **SC-004**: Journal recompute does not run on unrelated store changes (verified by React profiler sample).
- **SC-005**: Director can open any journal entry linked to warehouse document in ≤2 clicks.

## Assumptions

- Single-tenant per Firestore doc remains for Phase 1; split persistence is Phase 2 strategic.
- No multi-user conflict resolution in Phase 1.
- Georgian + Russian i18n for all new journal labels.
