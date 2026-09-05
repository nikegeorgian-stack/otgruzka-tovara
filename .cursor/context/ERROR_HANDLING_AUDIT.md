# Аудит: игнор ошибок / пропуски (2026-08-13)

Скрипт: `node scripts/audit-silent-errors.mjs` → `.cursor/context/SILENT_ERRORS_AUDIT.md`<br>
Прод данные: SQL Connect (`OTGRUZKA.md`).

## Вердикт

Критичный путь **save** в SQL Connect в целом защищён (refuse wipe, missing store, UI `setError`).<br>
Главные дыры были в **pull** (ошибка только в console) и в **отсутствии тестов** на анти-wipe. Частично закрыто в этой сессии.

## Тесты

| Набор | Результат |
|-------|-----------|
| `vitest run tests` | **69 passed** (было 62; +7 `refuseStoreWipe`) |
| `scripts/e2-cloud-conflict.mjs` | **PASSED** (13 checks) |
| `tsc --noEmit` | OK |

## P0 — данные / sync (было / стало)

| Находка | Риск | Статус |
|---------|------|--------|
| `FstSqlConnectSync.pullRemote` — `catch` только `console.warn`, UI не видит сбой | Пользователь думает, что «синк ок», а SQL не подтянулся | **Исправлено**: при `force` → `setError` (+ missing row) |
| `FstCloudSync.pullRemote` — то же | Fallback Firestore-путь | **Исправлено** аналогично |
| Wipe-логика дублировалась в `firestoreSync` vs `refuseStoreWipe` | Дрейф порогов | **Исправлено**: один `assertNoMassStoreWipe` |
| Нет unit-тестов на refuse wipe | Регресс незаметен | **Добавлено** `tests/refuseStoreWipe.test.ts` |

## P1 — оставшиеся пробелы (не чинили)

| Находка | Почему важно |
|---------|----------------|
| Анти-wipe **не** считает journals — только employees, users, timesheet, audit, warehouse, finance, sales, procurement, hrContracts, access views | Журналы документов всё ещё без отдельного порога (частично лечит `cloudMerge` heal) |
| Meta subscribe error → только `console.warn` | Долгий silent desync до idle poll |
| `sqlCreateFstStore` всё ещё экспортирован | Сейчас не вызывается из app — ок, но API соблазн |
| `LocalDbSync` `.catch(() => {})` на poll/health | Только `dev:local`, не Otgruzka prod |
| Idle pull failures по-прежнему silent | Намеренно (не спамить UI каждые 10с) |

## P2 — ожидаемый ignore (не баг)

localStorage quota, BroadcastChannel, clipboard, video.play, auth reload transient, safeStorage — ~40 мест. Норма для браузерных API.

## MED (домен)

- `ProcurementTrackingSync` — `catch { /* skip */ }` по заказу: трекинг молча пропускает сбой carrier API.
- Export 1C — `.catch` → alert empty (не полный игнор).

## Что сделано в коде

1. `FstSqlConnectSync.tsx` — surface forced pull errors<br>
2. `FstCloudSync.tsx` — то же<br>
3. `firestoreSync.ts` → `assertNoMassStoreWipe`<br>
4. `tests/refuseStoreWipe.test.ts`<br>
5. `scripts/audit-silent-errors.mjs` (повторный аудит)

## Не сделано

Деплой, clear/import облака, правка всех LOW ignore.
