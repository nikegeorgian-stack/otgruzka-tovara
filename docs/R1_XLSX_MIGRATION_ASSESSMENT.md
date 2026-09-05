# R1 / R1.1 — `xlsx` migration status

## Status (R1.1)

`xlsx` / SheetJS **removed** from runtime dependencies and lockfile.

Replacement: `src/lib/excel/workbookAdapter.ts` on top of existing `exceljs`.

## Product contract

User spreadsheet **import/export** is **`.xlsx` only**.

`.xls` (BIFF) and `.ods` were previously listed in some `accept=` attributes; they are **explicitly rejected** (`unsupported_extension`) because exceljs cannot safely read them. UI strings updated (not silent).

Procurement **attachments** may still accept `.xls` as opaque blobs (no parse).

## Former call sites → adapter

| Former site | Role | After |
|---|---|---|
| `src/lib/lazy/xlsx.ts` | lazy SheetJS | **deleted** |
| `HrRegistryImportPanel` + `registryImport.ts` | HR registry import | `loadWorkbookFromFile` + `SheetView` |
| `warehouse/importExport.ts` | warehouse import + balance/reorder/turnover/audit export | adapter load + `writeAoAWorkbook` |
| `excelExport.ts` | timesheet/payroll/statement/brigades export | adapter write + download |
| Other `*Excel.ts` / `staffListExcel` | already exceljs | unchanged |

## Remaining audit (omit=dev)

After removal: **0 critical, 0 high**. Remaining **moderate** = `uuid` transitive via exceljs + firebase-admin (see `docs/R11_NPM_OVERRIDES_VERDICT.md`). uuid@11 override was **reverted** (outside parent ranges).
