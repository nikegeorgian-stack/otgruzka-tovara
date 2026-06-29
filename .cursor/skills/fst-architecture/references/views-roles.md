# Разделы (views) и роли/доступ

## Регистрация нового раздела (ViewId) — 8 мест

1. `src/lib/types.ts` — добавить литерал в union `ViewId`.
2. `src/lib/access/types.ts` — добавить в `MANAGED_VIEWS`.
3. `src/lib/access/init.ts` — добавить в локальный `MANAGED` set.
4. `src/lib/access/roles.ts` — добавить в `DEFAULT_ROLE_VIEWS` нужным ролям
   (sysadmin получает все view автоматически через `viewsForRole`).
5. `src/components/auth/AccessAdminPanel.tsx` — добавить в `VIEW_LABEL_KEYS` (полный `Record<ViewId,string>`).
6. `src/app/lazyPages.tsx` — `lazy(() => import('@/pages/XxxPage')...)`.
7. `src/App.tsx` — импорт + блок `{app.view === 'xxx' && <XxxPage … />}`.
8. `src/components/layout/AppShell.tsx` — пункт в нужной группе `NAV_GROUPS`
   + иконка `case 'xxx'` в `src/components/layout/webMobileNavIcons.tsx`
   + i18n ключи `nav.xxx` / `nav.xxxHint` в `ru.ts` и `ka.ts`.

## Роли (`AccessRoleId`)
Определены в `src/lib/access/types.ts` (+ `VALID_ROLES` в `init.ts`), метки/описания в
`src/lib/access/roles.ts` (`ACCESS_ROLES`). Текущие: sysadmin, warehouse_keeper, hr,
operations_director, workshop_master, procurement_manager, chief_engineer, technologist, mixer, finance.

### Новая роль — где трогать
- `src/lib/access/types.ts` (`AccessRoleId`), `src/lib/access/init.ts` (`VALID_ROLES`),
  `src/lib/access/roles.ts` (`ACCESS_ROLES` + `DEFAULT_ROLE_VIEWS`).
- Полные `Record<AccessRoleId, …>`: `src/lib/journals/access.ts` (`ROLE_CATEGORIES`) — добавить ключ.
- Облачные кабинеты (необязательно): `src/lib/cloud/fstWebUsers.ts` (`FST_WEB_ROLE_VIEWS`, Partial).

## Доступ
- `viewsForRole` / `viewsForUser` / `canAccessView` — `src/lib/access/permissions.ts`.
- `roleViews` редактируется админом, сидируется из `DEFAULT_ROLE_VIEWS`.
- Спец-флаги по ролям: `roleAllowsNegativeStock` (`NEGATIVE_STOCK_ROLES`),
  `roleAllowsDocumentCancel` (`DOCUMENT_CANCEL_ROLES`).
- Веб-кабинеты (cosmetic nav) — массивы `web*Mode` в `AppShell.tsx`.
