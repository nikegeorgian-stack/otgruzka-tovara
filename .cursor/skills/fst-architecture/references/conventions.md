# Конвенции, i18n, печать, сборка, деплой

## i18n (RU + KA)
- Словари — `src/i18n/ru.ts` и `src/i18n/ka.ts`. Функции `t(key)` / `tf(key, vars)`.
- Любой новый ключ добавляется **в оба файла синхронно** (KA не должен отставать).
- Группировать по префиксам раздела: `nav.*`, `mixer.*`, `director.*`, `sales.*`, `common.*` и т.п.

## UI-компоненты
- Общие примитивы — `src/components/ui/*` (`Button`, `Card`, `Input`, `FormField`, `KpiCard`,
  `TabBar`, `PageHeader`, `AppDialog`, пикеры). Переиспользуй их, не плоди дубликаты.
- Подтверждения — хук `useConfirm`. ID новых сущностей — `crypto.randomUUID()`.

## Печать / PDF
- Стили — `src/styles/print.css`. Для html2canvas/PDF: бордеры ≥ `1px`,
  избегать субпиксельных рамок и слишком мелкого текста.
- Печатные листы — отдельные `*PrintSheet.tsx` / `*PrintModal.tsx`.

## Качество перед готовностью
- `npx tsc --noEmit` — без ошибок (обязательно перед коммитом).
- `npm run build` — успешная сборка. Частые поломки сборки: пропущенный ключ в полном
  `Record<ViewId|AccessRoleId, …>`, неиспользуемые импорты/пропсы (strict).
- Проверять линт затронутых файлов.

## Сборка и деплой
- Скрипты — `package.json` (`build`, `build:fst-web`, `deploy`, `deploy:cloud`),
  оркестрация — `scripts/deploy.ps1`. Подробности и журнал правок — `docs/DEPLOY.md`.
- Из корня: `powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1`.
- Vercel (прод): `vercel --prod` → https://fst-uchet-theta.vercel.app
- Firebase Hosting: https://fst-uchet-14c02.web.app — токен протухает,
  нужен интерактивный `firebase login --reauth` (нельзя из неинтерактивного шелла).

## Прочее
- Десктоп и веб — общий код `src/`; веб-обёртка `fst-web/` (Firebase), алиас `@` → корневой `src/`.
- Бэкенд — `server/` (auth, CEC, трекинг контейнеров), хранилище `server/db.mjs` (SQLite).
