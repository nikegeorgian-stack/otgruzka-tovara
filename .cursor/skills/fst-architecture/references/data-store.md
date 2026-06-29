# Стор, срезы и персистентность

## AppStore
- Тип `AppStore` — `src/lib/types.ts` (поля: months, codes, employees, warehouse, procurement,
  production, planner, sales, finishedProducts, packaging, formulations, technologist, wastewater,
  counterparties, finance, access, settings, …).
- Сборка дефолта + нормализация + миграции — `src/lib/storage.ts`:
  - `createDefaultStore()` — пустой стор (вызывает `createDefault*()` каждого домена).
  - `normalizeV6Store(...)` — приводит загруженный JSON к актуальной форме (backward-compat).
  - `migrateToV6(...)` — апгрейд старых версий. `STORE_VERSION = 6`.
- Хранение: единый JSON-блоб. localStorage (десктоп/браузер), SQLite (`server/db.mjs`),
  Firestore (облако, `src/lib/cloud/*`). Любое новое поле должно иметь дефолт и нормализацию,
  иначе старые сторы упадут/потеряют данные.

## Срезы (slices)
- Файлы — `src/store/slices/<name>Slice.ts`, экспорт фабрик через `src/store/index.ts`.
- Подключение — `src/hooks/useAppStore.ts`: фабрика вызывается в `useMemo`
  (добавь зависимость на свежий кусок стора!), экшены реэкспортируются наружу.
- Проброс в UI — пропсами из `src/App.tsx` на страницы.

### Добавить новый домен с действиями
1. `src/lib/<domain>/types.ts` — типы сущностей и `<Domain>Store`.
2. `src/lib/<domain>/init.ts` — `createDefault<Domain>()`, `normalize<Domain>Store()`,
   генерация номеров/ID (`crypto.randomUUID()`), нормализация записей.
3. `src/lib/types.ts` — добавить поле в `AppStore`.
4. `src/lib/storage.ts` — `createDefaultStore`, `normalizeV6Store`, `migrateToV6`.
5. `src/store/slices/<domain>Slice.ts` — экшены (setStore-патчеры) + экспорт в `src/store/index.ts`.
6. `src/hooks/useAppStore.ts` — подключить срез, выставить экшены.
7. (если нужен раздел) — см. `views-roles.md`.

## Расчёты
- Чистые функции — `src/lib/<domain>/calc.ts` (без побочных эффектов, тестируемы).
  Примеры: `salesOrderMetrics`, `buildLineLoad`, `salesDashboardKpis`,
  `recipeTotalBatchKg`, `buildMixTaskSuggestions`, `totalFactMpForOrder`.
