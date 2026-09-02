# Миграция FST → Firebase SQL Connect (PostgreSQL)

Полный переход с Firestore JSON на **Firebase SQL Connect** (`otgruzka-tovara-service`).

## ⚠️ Безопасность

Если вы показывали **private key** service account в Cloud Shell — **немедленно удалите ключ** в
[Google Cloud IAM](https://console.cloud.google.com/iam-admin/serviceaccounts?project=otgruzka-tovara)
и создайте новый. Ключ из скриншота считается скомпрометированным.

## Что меняется

| Было | Станет |
|------|--------|
| Firestore `fstStores` + шарды | PostgreSQL таблица `fst_store` |
| 3-way merge (`cloudMerge.ts`) | Revision + realtime `@refresh` |
| Лимит 1 MB | Нет (JSONB в PostgreSQL) |
| `FstCloudSync` | `FstSqlConnectSync` при `VITE_FST_PERSISTENCE=sqlconnect` |

Приложение **не переписывается** — тот же `AppStore v6` в JSON, но хранится в SQL и синхронизируется через SQL Connect.

## Шаг 1 — Firebase login (ваш аккаунт)

```powershell
firebase login
firebase use otgruzka-tovara
```

У аккаунта `nikegeorgian@gmail.com` нужны роли:
- Firebase Admin / Editor
- Cloud SQL Client
- Service Usage Consumer

## Шаг 2 — Деплой schema + connector

Из корня репозитория:

```powershell
cd fst-web
firebase deploy --only dataconnect --project otgruzka-tovara
firebase dataconnect:sdk:generate --project otgruzka-tovara
```

Проверьте в `fst-web/dataconnect/dataconnect.yaml`, что `instanceId` и `database` совпадают с консолью
(SQL Connect → otgruzka-tovara-service).

## Шаг 3 — Экспорт данных из Firestore

```powershell
# Сохраните service account JSON как fst-web/service-account.source.json (НЕ коммитить!)
npm run export:cloud-backup:admin
```

## Шаг 4 — Импорт в PostgreSQL

Подключение к Cloud SQL (один из вариантов):

**A) Cloud Shell** (проще всего):

```bash
# В Cloud Shell проекта otgruzka-tovara
gcloud sql connect otgruzka-tovara-service --user=postgres --database=otgruzka-tovara-service
```

**B) Connection string** (локально через Auth Proxy):

```powershell
$env:DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5432/otgruzka-tovara-service"
npm run migrate:sql-connect -- --backup=fst-web/cloud-backup/fst-backup-fibercell-main.json
```

Dry-run:

```powershell
npm run migrate:sql-connect -- --dry-run --backup=fst-web/cloud-backup/fst-backup-fibercell-main.json
```

## Шаг 5 — Переключить приложение

В Vercel (Environment Variables):

```
VITE_FST_PERSISTENCE=sqlconnect
```

Оставьте `VITE_FIREBASE_*` — Auth и Storage по-прежнему Firebase.

Деплой:

```powershell
cd fst-web; npx vite build
Copy-Item -Recurse -Force dist ..\dist
node "$env:APPDATA\npm\node_modules\vercel\dist\vc.js" --prod --yes
```

## Шаг 6 — Проверка

1. Ctrl+F5 на https://otgruzka-tovara.vercel.app
2. Войти → данные должны загрузиться из PostgreSQL
3. Изменение → «Облако · сохранено»
4. Второй браузер → изменения подтягиваются через SQL Connect realtime

## Откат

```
VITE_FST_PERSISTENCE=firestore
```

(или удалить переменную) — снова `FstCloudSync`. Firestore данные не удаляются автоматически.

## Файлы

- `fst-web/dataconnect/` — schema, queries, mutations
- `src/components/web/FstSqlConnectSync.tsx` — синхронизация
- `src/lib/sqlconnect/` — клиент
- `fst-web/scripts/migrate-firestore-to-sqlconnect.mjs` — импорт

## Следующий этап (опционально)

Нормализация таблиц (employees, movements, months…) — отдельная спека, когда SQL Connect стабилен в проде.
