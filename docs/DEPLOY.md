# Деплой FST

Веб-версия и десктоп используют **один общий код** в `src/`. В `fst-web` алиас `@`
указывает на корневой `src/`, поэтому любые правки попадают в веб-версию без копирования.

## Быстрый деплой

Из корня репозитория:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

Скрипт спросит цель (Firebase / Vercel / обе), проверит логин, соберёт и задеплоит.

Без меню:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target firebase
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target vercel
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target all
```

## Цели деплоя

| Цель | URL | Команды вручную |
|---|---|---|
| Firebase Hosting | https://fst-uchet-14c02.web.app | `cd fst-web && npm run build && firebase deploy --only hosting --project fst-uchet-14c02` |
| Vercel (прод) | https://fst-uchet-theta.vercel.app | `vercel --prod` (из корня) |
| Правила Firestore | — | `cd fst-web && npm run deploy:firestore-rules` |

## Обслуживание данных

| Задача | Команда (из корня `tabel`) |
|---|---|
| Очистить персонал в облаке | `powershell -ExecutionPolicy Bypass -File scripts\clear-hr-cloud.ps1` |
| То же через npm | `$env:FST_ADMIN_PASSWORD="..."; npm run clear:hr-cloud` |
| Локальный сброс SQLite | `npm run reset-local` |
| Патч схемы Firestore | `$env:FST_ADMIN_PASSWORD="..."; npm run migrate:cloud-store` |

Скрипты `clear:hr-cloud` и `reset-local` работают **из корня и из `fst-web`**.

## Авторизация (постоянная)

Логины хранятся локально на машине и обновляются сами — повторно входить не нужно:

- **Firebase**: `firebase login` (текущий аккаунт: `admin@fibercell.net`). Проверка: `firebase login:list`.
- **Vercel**: `vercel login` (текущий аккаунт: `admin-26691449`). Проверка: `vercel whoami`.

Если деплой вдруг попросит вход — выполните соответствующий `*login` один раз.

## Что делали последним (журнал явки на работу)

Печать «Журнала учёта явки» переведена на детерминированную раскладку, чтобы
**превью совпадало с печатью и PDF**:

- Лист — точный A4-альбом (`@page attendance-log { margin: 0 }`, поля как внутренний
  `padding`), фиксированная высота строк `8.5мм` (без растяжения flex).
- Разбивка по листам учитывает разную вместимость: 1-й лист — полная шапка (17 строк),
  2-й и далее — компактная (19 строк); остаток распределяется ровно (нет пустого хвоста).
- Каждый день = 3 колонки: **вх. / вых. / подп.** (ежедневная подпись).
- Под PDF (html2canvas): бордеры таблицы `1px` (субпиксельные он не рисует),
  под-заголовки крупнее (`6.5pt`), захват `scale: 3` с точной шириной листа.

Ключевые файлы:
- `src/lib/hr/attendanceLog.ts` — разбивка по листам (`chunkAttendancePages`).
- `src/components/hr/AttendanceLogPrintSheet.tsx` — разметка листа.
- `src/styles/print.css` — стили печати (блок «Журнал явки»).
- `src/lib/pdfExport.ts` — экспорт PDF (html2canvas + jsPDF).
