# FST — облачная версия

Веб-версия **FST** (табель + склад) с входом по email и синхронизацией через **Firebase Firestore**.

Локальная версия остаётся в корне репозитория (`npm run dev`).

## База данных (Firestore)

| | |
|---|---|
| Проект FST | **`fst-uchet-14c02`** |
| FBeda | `fbeda-5c061` — **не используется** для FST |
| Коллекция | `fstStores` |
| Документ | `fstStores/{uid}` — весь store в поле `payload` |

Первичная настройка (создание проекта + БД + ключи в `.env`):

```bash
npm run setup:firebase
```

Если квота проектов исчерпана — создайте `fst-uchet` вручную в [Firebase Console](https://console.firebase.google.com/), затем снова запустите скрипт.

Проверка записи:

```bash
npm run test:firebase
```

## Запуск локально

1. Выполните `npm run setup:firebase` (проект **`fst-uchet-14c02`**) или `vercel env pull fst-web/.env`.
2. **Authentication → Email/Password** и **Firestore** включены в консоли `fst-uchet-14c02`.
3. Из корня репозитория:

```bash
npm install
npm run dev:fst-web
```

## Сборка

```bash
npm run build:fst-web
```

Результат: `fst-web/dist/`

## Деплой Vercel

Репозиторий: https://github.com/DMDAdmin/FST-uchet

Production: https://fst-uchet-theta.vercel.app

| | |
|---|---|
| Firebase | `fst-uchet-14c02` |
| Vercel | `fb-cell-admin-s-projects/fst-uchet` |
| GitHub | https://github.com/DMDAdmin/FST-uchet |

Корневой `vercel.json` собирает `fst-web` из монорепозитория:

```bash
vercel --prod
```

Или подключите GitHub — **Root Directory:** корень репозитория (не `fst-web`).

Переменные окружения `VITE_FIREBASE_*` задайте в Vercel Dashboard → Project → Settings → Environment Variables.

## Деплой Firebase Hosting

```bash
cd fst-web
npm run build
firebase login
firebase deploy
```

## Аккаунт администратора

| | |
|---|---|
| Email | `admin@fibercell.net` |
| Пароль | задаётся в Firebase Console → Authentication |
| Права | полный доступ (табель, зарплата, склад, настройки) |

Регистрация новых пользователей отключена — только вход администратора.
