# Staging environment proposal (R1)

**Status:** proposal only. **No cloud resources were created in R1.**

`PREVIEW_ENVIRONMENT_VERIFIED` remains **`false`** until a real staging stack exists and is verified end-to-end (Auth → Data Connect → Storage → Preview UI → same-origin `/api/fst/*`).

---

## Goals

- Safe place to exercise mutations (warehouse, QC, payroll-adjacent flows) without touching production SQL Connect data.
- Preview deployments must call **their own** API origin (same-origin canon), never production `otgruzka-tovara.vercel.app` APIs by accident.
- Seed data must be **synthetic only** — no PII, no timesheet/payroll copy from production.

---

## Option A — Separate Firebase / Data Connect staging (recommended)

Create a **dedicated Firebase project** and Data Connect service later (do not invent or reserve live IDs here). Resource **types** to provision when approved:

| Type | Purpose |
|------|---------|
| Firebase project (staging) | Isolation from production `otgruzka-tovara` |
| Cloud SQL instance (Data Connect backend) | Staging Postgres; expect ongoing **Cloud SQL** cost even when idle |
| Firebase Auth (staging) | Separate user pool; no production credentials |
| Data Connect service | Staging GraphQL/SQL schema deploy target |
| Firebase Storage bucket | QC attachments / uploads for staging only |
| Vercel Preview env (names only) | Wire Preview builds to staging — see below |

### Vercel Preview environment variable **names** (values filled when staging exists)

- `VITE_FIREBASE_*` (or project-specific Firebase web config vars already used by the app)
- `VITE_FST_PERSISTENCE` / Data Connect connector config vars used by `fst-web`
- `VITE_FST_API_ORIGIN` — **omit on `*.vercel.app`** so clients stay same-origin; Preview must not point at production API
- Server/admin secrets for staging only (Auth Admin, Data Connect admin, Storage) — never reuse production service-account keys in Preview

### Data policy

- **Synthetic seed only** (directories, demo employees, empty/minimal journals).
- **No** production PII, timesheet cells, payroll ledgers, or warehouse movement dumps.
- Prefer scripted fixtures under repo control, not “export from prod”.

### Teardown / retention

- Define a retention window for staging SQL + Storage (e.g. wipe on schedule or on demand).
- Document who may destroy the staging project; keep production wipe/migrate scripts out of default staging runbooks.
- When tearing down: delete Data Connect service, Cloud SQL, Storage objects, Auth users, then the Firebase project.

### Cost note

Cloud SQL for Data Connect is the main recurring cost; size the instance for light QA traffic and shut down or delete when unused for long periods.

---

## Option B — Production Firebase project with inactive domains

Reuse `otgruzka-tovara` with extra Auth domains / Preview URLs that are “inactive” or restricted.

**Explicit risks:**

- Shared Cloud SQL / Data Connect = one bad migration or seed wipe hits **real** operational data.
- Shared Auth / claims mistakes can elevate Preview users into production permissions.
- Env misconfiguration (`VITE_FST_API_ORIGIN` → production) turns Preview into a production API client (mitigated in code for Preview→Prod, but not a substitute for isolation).
- Harder teardown: cannot delete “staging” without risking production resources.
- Compliance/audit blur: staging writes look like production activity in the same project.

**Not recommended** for Otgruzka given SQL Connect as the sole data source of truth.

---

## R1 checklist (this change set)

| Item | State |
|------|--------|
| Same-origin API canon + Preview≠Prod client guard | Implemented in code |
| Cross-origin browser reject on G2–G6 / QC command handlers | Implemented in code |
| Staging Firebase / SQL / Auth / DC / Storage | **Not created** |
| `PREVIEW_ENVIRONMENT_VERIFIED` | **`false`** until Option A (or equivalent) is live and verified |

---

## Next step (when explicitly approved)

1. Create Option A resources (separate project + DC + Auth + Storage).
2. Wire Vercel Preview env **names** above to staging values.
3. Load synthetic seed only; run smoke + critical mutation paths.
4. Flip `PREVIEW_ENVIRONMENT_VERIFIED` to true only after documented verification.
