# FST — табель и склад

Учётная система (табель/HR, склад, закупки, производство, технолог, финансы) на
React + TypeScript + Vite + Tailwind. Десктоп и веб используют **общий код** в `src/`.

## Структура

- `src/` — всё приложение (общий код десктопа и веба).
- `fst-web/` — обёртка веб-версии (Firebase). Алиас `@` → корневой `src/`.
- `server/` — бэкенд (auth, CEC, трекинг контейнеров).
- `docs/` — документация: `ARCHITECTURE.md`, `CLOUD_INTEGRATION.md`,
  `TECHNOLOGIST_QC.md`, **`DEPLOY.md`** (деплой + журнал недавних правок).

## Деплой

См. `docs/DEPLOY.md`. Кратко из корня:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

- Firebase Hosting: https://fst-uchet-14c02.web.app
- Vercel (прод): https://fst-uchet-theta.vercel.app

Логины Firebase (`admin@fibercell.net`) и Vercel (`admin-26691449`) сохранены локально.

## Конвенции

- Язык интерфейса: RU/KA (i18n в `src/i18n`, функции `t` / `tf`).
- Печать: стили в `src/styles/print.css`; для PDF (html2canvas) бордеры ≥ `1px`,
  избегать субпиксельных рамок и слишком мелкого текста.
- Перед коммитом: `npx tsc --noEmit` должен проходить без ошибок.
