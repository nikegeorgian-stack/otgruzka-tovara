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

## Срезы на дату и время (as-of)

Для отчётов «на момент» используйте единый паттерн:

- **Хук:** `useAsOfSnapshot()` — состояние `enabled`, `date`, `time`, `scope`, `asOfIso`.
- **UI:** `AsOfSnapshotBar` из `@/components/asOf/AsOfSnapshotBar` (ключи i18n `asOf.*`).
- **Утилиты:** `@/lib/asOf/snapshot` (`buildAsOfIso`, `recordsBeforeAsOf`, `warehouseStoreAsOf`).
- **Склад:** `computeAllBalancesAsOf` / `movementsBeforeAsOf`.
- **Производство:** `summarizeProductionDay(..., asOfIso?)`, фильтр заявок по `postedAt`.
- **Финансы:** `monthStatement(store, month, asOfDate?)`, `employeeLedger(..., asOfDate?)`.
- **Журналы:** `filterJournalEntries(..., { asOfIso })`.

В новых экранах с остатками, движениями или KPI добавляйте `AsOfSnapshotBar` и передавайте `asOfIso`/`asOfDate` в расчётные функции, а не дублируйте логику фильтрации в компонентах.

## Spec Kit (Spec-Driven Development)

Установлен [GitHub Spec Kit](https://github.com/github/spec-kit) v0.12.2 для Cursor (`cursor-agent`).

- **Skills:** `.cursor/skills/speckit-*` — вызываются в чате Cursor как `/speckit-specify`, `/speckit-plan`, …
- **Инфраструктура:** `.specify/` (шаблоны, скрипты PowerShell, constitution)
- **Типичный цикл:** `/speckit-constitution` → `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`
- **CLI (глобально):** `specify version`, обновление: `specify self upgrade`
- Существующие skills (`fst-architecture`, `ui-ux-pro-max`) работают параллельно со speckit.
