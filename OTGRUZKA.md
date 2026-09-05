# Otgruzka — источник данных (зафиксировано)

**Прод UI:** https://otgruzka-tovara.vercel.app<br>
**Hosting (зеркало UI):** https://otgruzka-tovara.web.app<br>
**Firebase project:** `otgruzka-tovara`

## Единая база = SQL Connect

| | |
|--|--|
| **Стор приложения** (табель, журналы, HR, склад, ЗП, финансы…) | **только Firebase SQL Connect** |
| Сервис | `otgruzka-tovara-service` (`europe-west3`) |
| Sync в коде | `FstSqlConnectSync` |
| Сборка веба | `VITE_FST_WEB=true` + **`VITE_FST_PERSISTENCE=sqlconnect`** (зашито в `fst-web/vite.config.ts`) |

Firestore blob (`FstCloudSync` / `fstStores`) на вебе Otgruzka **не** источник правды и **не** должен принимать seed из браузера.

## Что запрещено

- Создавать / перезаписывать общую SQL-базу из `createDefaultStore()` / seed в браузере
- «Синхронизировать» прод заливкой локального JSON / localStorage
- `clear:*`, `import:cloud*`, `clean:cloud-store:apply` без явной просьбы
- Считать, что деплой UI меняет или чистит SQL/Firestore данные

## Анти-wipe при сохранении в SQL

Перед записью (`assertNoMassStoreWipe`): если относительно SQL пропало ≥15% при достаточно большом remote — отказ:

| Срез | Мин. remote | Код ошибки |
|------|-------------|------------|
| Сотрудники | 8 | `cloud_refuse_employee_wipe` |
| Учётки | 3 | `cloud_refuse_user_wipe` |
| Ячейки табеля | 30 | `cloud_refuse_timesheet_wipe` |
| Журнал действий (`auditLog`) | 40 | `cloud_refuse_audit_wipe` |
| Склад (items+movements+documents) | 25 | `cloud_refuse_warehouse_wipe` |
| Финансы (авансы/выплаты/снимки) | 8 | `cloud_refuse_finance_wipe` |
| Заказы продаж | 5 | `cloud_refuse_sales_wipe` |
| Заказы закупки | 5 | `cloud_refuse_procurement_wipe` |
| Трудовые договоры (`hrContracts`) | 8 | `cloud_refuse_hr_contracts_wipe` |
| Разделы ролей (`roleViews` + `webViews`) | 10 | `cloud_refuse_access_views_wipe` |

## Деплой = только UI

```powershell
npm run deploy:otgruzka:quick
```

Меняет бандл на Vercel (+ Hosting). **Данные SQL / Firestore скриптами не трогать.**<br>
После деплоя: Ctrl+F5 на канон-URL Vercel.

## Почему раньше «откатывалось»

После обновления страницы в памяти поднимался seed; из‑за гонки он успевал сохраниться в SQL раньше живого pull.<br>
Защита в коде: sync `storeRef` при load, refuse wipe сотрудников/табеля, запрет create из seed (`src/components/web/FstSqlConnectSync.tsx`, `src/lib/cloud/refuseStoreWipe.ts`).

## Подробнее

- Платформы: `docs/PLATFORMS.md`
- Миграция SQL: `docs/SQL_CONNECT_MIGRATION.md`
- Журнал деплоев: `docs/DEPLOY.md`
- Агент: `AGENTS.md`, правило `.cursor/rules/fst-deploy-otgruzka.mdc`
