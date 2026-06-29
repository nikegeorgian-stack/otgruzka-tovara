# Доменные модули и их связи

Поток: **director/sales → planner → production → formulations(mixer) → warehouse**.

## sales / director (заказы клиентов + кокпит)
- `src/lib/sales/{types,init,calc}.ts`: `SalesOrder` (orderNumber `ЗК-YYYY-NNN`, customer, status,
  priority, lines), `SalesOrderLine` (продукт, qty, `preferredLineId`, `productionOrderIds`).
- Срез `src/store/slices/salesSlice.ts`: `upsertSalesOrder`, `removeSalesOrder`,
  `setSalesOrderStatus`, `planSalesLine` (создаёт `ProductionOrder` в planner и связывает).
- UI: `src/pages/DirectorPage.tsx` (Dashboard/Orders/Planning), `src/components/director/SalesOrderModal.tsx`.

## planner
- `ProductionOrder`, `PlannerDayPlan`; раздел `planner`. Произв. заказ — ключевая сущность,
  на него ссылаются sales (`productionOrderIds`) и mixTasks (`sourceOrderId`).

## production
- Сменные заявки/бригады, печать смен. Компоненты `src/components/production/*`.

## formulations (рецепты, замесы, задания миксеру)
- `src/lib/formulations/{types,init,mixTasks}.ts`:
  - Рецептуры, `recipeTotalBatchKg`, `formulationColorLabel`.
  - `FormulationMixTask` (taskNumber `ЗД-YYYYMMDD-NNN`, recipeId, targetVolumeL, status open/done/cancelled,
    sourceOrderId, batchRunId). `buildMixTaskSuggestions` — подсказки заданий из активных произв. заказов.
  - `batchRuns` — фактические замесы (создаются pending, подтверждаются кладовщиком).
- Срез `src/store/slices/mixTasksSlice.ts`: `createMixTask`, `updateMixTask`, `cancelMixTask`, `completeMixTask`.
- UI: технолог ставит задачи — `src/components/technologist/MixTaskTechnologistPanel.tsx`;
  миксер выполняет — `src/pages/MixerPage.tsx` + `FormulationMixerPanel.tsx`;
  этикетки — `FormulationCubeLabelModal.tsx` (QR/штрихкод).

## technologist (QC)
- Входной контроль, пропитка, климат, рецептуры: `src/components/technologist/*`, `src/lib/technologist/*`.

## warehouse
- Документы прихода/расхода, остатки, инвентаризация, импорт накладных, аналитика, аудит.
- `src/components/warehouse/*`, `src/lib/warehouse/*`. Списание сырья и приход ГП завязаны на замесы.

## procurement
- Заказы поставщикам, контейнеры, трекинг (бэкенд `server/tracking/*`), аналитика.
  `src/components/procurement/*`.

## finance / hr / directories / journals
- finance: ставки/курсы (`FinanceRatesPanel`). hr: сотрудники, посещаемость, расчёт ЗП.
- directories: справочники (контрагенты, позиции, рецептуры, бригады, упаковка…).
- journals: общий журнал событий с доступом по категориям (`src/lib/journals/access.ts`).
