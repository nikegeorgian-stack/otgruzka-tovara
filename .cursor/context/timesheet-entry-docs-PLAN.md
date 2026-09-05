# План: табель как документы — Stage 1 CLOSED (CRITIC PASS)

Дата: 2026-08-21 · финал после 2 циклов критика

## Scope

**В scope (готово):** `source: 'edit_batch'` из confirm «Готово» → post → Журналы → карточка ВТ → void (полный).
**Out of scope:** rollcall / cycle / brigade fill как документы (Stage 2).

## Инварианты (критик)

- Правда ЗП = `months`; документ = пакетная история ввода.
- Post: applied vs changes; skip при conflict/ACL; `ok` + не чистить черновик при fail/partial.
- Void: только если все ячейки откатываются; иначе status остаётся posted.
- workshop_master: в журнале только свои / overlap бригад.
- Merge: whole-doc LWW (`mergeTimesheetEntryDocuments`).

## Verify

- `vitest run tests/timesheetEntries.test.ts` — 8/8
- `tsc --noEmit` — ok
- Деплой — только по явной просьбе
