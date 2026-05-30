# FST — облачная версия

Веб-версия **FST** (табель + склад) с входом по email и синхронизацией через **Firebase Firestore**.

Локальная версия остаётся в корне репозитория (`npm run dev`).

## Запуск локально

1. Firebase-проект **`fbeda-5c061`** (приложение `fibercell`) — уже настроен.
2. **Authentication → Email/Password** и **Firestore** включены.
3. Для локального запуска скопируйте `.env.example` → `.env` (или используйте `.env.production`).
4. Из корня репозитория:

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

Production: https://fst-uchet.vercel.app

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

## Аккаунт

Владелец: `nikegeorgian@gmail.com`

На экране входа FST — **Войти** или **Создать аккаунт** (email + пароль от 6 символов).
Данные сохраняются в Firestore (`f