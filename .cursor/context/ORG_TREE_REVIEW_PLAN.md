# Review Plan: только «Оргструктура» (`#/org_tree`)

## Уточнение

Прошлый план ошибочно ссылался на табель (`CellContextMenu` из month) как на образец.<br>
**Табель, HR-модуль, ЗП и протоколы не изменяем.**<br>
Контекстное меню — своё в `src/components/orgChart/`.

Разрешено только **читать** `employees` / `hrStructuralUnits` / `hrPositions` с экрана схемы для отображения и ручной привязки на узле. Не править файлы этих модулей и не автосинхронизировать справочники.

---

## CHAIN BRIEF

```
topic: оргструктура UX (меню / ветки / сотрудник на ячейке / журнал)
nodes: OrgTreePage, OrgChartCanvas, orgChartSlice, lib/orgChart/*
path: Canvas/List → OrgTreePage → orgChartSlice → AppStore.orgChart → SQL merge
store/sync: только orgChart (+ auditLog через appendAudit)
risks: не править month/hr/finance/protocols; collapse только UI
touch: orgChart lib/components, OrgTreePage, orgChartSlice, types+classifyAudit (audit), App wiring, i18n, tests/orgChart*
verify: vitest orgChart* + tsc + build:fst-web; без деплоя
→ proceed after approval
```

---

## Что сохраняем как есть

- `store.orgChart`, nodes, parentId, layout, displayMode, layoutVersion
- FiberCell seed, цвета веток, 3 режима названий
- drag, Shift+drop, авто-раскладка всей схемы
- печать A4/A3 + fitPrintPages
- права: просмотр `org_tree`; правка sysadmin | hr | secretary
- merge + anti-wipe
- подчинение на странице = parentId + стрелки

---

## Scope

### Мышь и меню
- ЛКМ: выбор; dblclick → редактор (canEdit); drag; Shift+drop
- ПКМ: своё меню (не браузерное), clamp, Escape / вне / после действия
- Также: список, Menu, Shift+F10, long-press
- Компонент: `OrgChartContextMenu.tsx` (без импортов из month/)

**Просмотр:** сведения; на схеме; только ветка; свернуть/развернуть; копировать; печать ветки<br>
**Правка (canEdit):** edit; +child; +sibling; reparent dialog; assign/replace/unassign employeeId; HR link на узле; layout ветки; удалить

### Удаление
- без детей → confirm
- с детьми → default reparent к бывшему parent; или subtree с доп. confirm
- корень с детьми: «только ячейка» запрещён
- не удалять сущности вне orgChart

### Панель / поиск / список / zoom / collapse
- блоки: должность, сотрудник, подчинение, действия
- поиск + фильтры display-only
- список с колонками, ПКМ, «Показать на схеме»
- collapse/zoom в sessionStorage на userId — не в AppStore, не в журнал

### Журнал
- только appendAudit, additive actions
- просмотр/поиск/collapse/zoom не журналировать

### Валидация
- в slice перед записью: имена, parent, антицикл, один корень, finite coords

---

## Out of scope

- `src/components/month/**`, timesheet*
- правки hrSlice / HrPage / HrEmployeeModal
- finance / payroll
- protocols*
- deploy / clear / import / migrate
- массовый sync с hrStructuralUnits

---

## Срезы

1. Domain: subtree, validate, ops, search, uiPrefs<br>
2. Slice + audit + App props<br>
3. Context menu + canvas (mouse/zoom/collapse)<br>
4. Side panel + search/list + print subtree + help<br>
5. i18n + tests + tsc + build:fst-web → отчёт без деплоя

---

## Готовность

ПКМ с правами; child/sibling; reparent без циклов; employee на ячейке; HR-ссылки без sync; ветки; печать ветки; безопасное удаление; журнал мутаций; старые данные целы; другие модули не изменены; build ок.
