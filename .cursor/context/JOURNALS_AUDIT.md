# Аудит журналов действий — 2026-08-18

Источник правды UI: https://otgruzka-tovara.vercel.app → Журналы.<br>
Данные: SQL Connect. Dual-log описан в `docs/ARCHITECTURE.md`.

## Что уже есть (не ломать)

| Журнал | Пишет | Лимит | UI |
|--------|-------|-------|----|
| `store.auditLog` | `appendAudit` | 2000 | Журналы + Настройки (хвост 50) |
| `warehouse.auditLog` | `appendWarehouseAudit` | 300 | Склад · аудит, Журналы |
| `warehouse.itemHistories` | `appendItemHistory` | на позицию | карточка номенклатуры |
| `emp.hrJournal` | `appendEmployeeJournal` | 200 / человек | HR карточка · История |
| Закупки `statusHistory` | заказ | на документ | Журналы · procurement |
| Покрытие мастера | документы coverage | вечные | Журналы · timesheet |
| Финансы ведомости | документы | вечные | Журналы · finance |
| Складские документы/движения | документы | вечные | Журналы |
| Инженерный журнал | полевые заметки | свой стор | раздел engineerLog (не audit) |
| Явка | punches | attendance | не в единой ленте |

Срезы **с** `appendAudit`: timesheet, hr, access, finance, candidates, directories (контрагент/ГП), settings, nightShift, attendance (punch), meals (заказ/принятие дня).

## Дыры на момент аудита

Срезы **без** глобального audit (документы могут жить отдельно):<br>
`productionSlice`, `procurementSlice` (есть statusHistory), `warehouseSlice` (свой audit), `salesSlice`, `technologistQcSlice`, `formulationBatchSlice`, `mixTasksSlice`, `workwearSlice`, `itOfficeSlice`, `otcSlice`, `wastewaterSlice`, `engineerLogSlice`, `aiChatSlice`, `workspaceSlice`.

Конкретные мутации без записи:

| Место | Симптом |
|-------|---------|
| `upsertEmployee` | смена **ФИО** не попадала в `hrJournal` (только бригада/должность/ЗП в detail audit) |
| `renameBrigade` | переименование бригады без `appendAudit` |
| `upsertMealCatalogItem` / `publishMealWeek` / аванс кухни | нет audit |
| `upsertHrPosition` / `upsertHrStructuralUnit` | справочник оргструктуры без audit |
| `cook` / `office_manager` / `employee` | категории журналов пустые (`journals/access.ts`) |
| `ARCHITECTURE.md` | устарело: auditLog «500», факт `MAX_AUDIT_ENTRIES = 2000` |

## Политика после этого среза

Правило `fst-action-journals.mdc`: новая мутация без журнала = незакрытая задача.<br>
Не вводим третий глобальный лог. Закрываем дыры точечно.

## Закрыто в этом срезе

- `name_change` в `hrJournal` + ФИО в `employee_upsert` detail<br>
- `brigade_rename`<br>
- `meals_catalog` / `meals_week` / `meals_advance`<br>
- `directory_change` для должностей и подразделений HR<br>
