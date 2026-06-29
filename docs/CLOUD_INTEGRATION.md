# Облако: GitHub + Vercel + Firebase

Учётная запись: **admin@fibercell.net**

## Текущий статус

| Сервис | Значение |
|--------|----------|
| **Production** | https://fst-uchet-theta.vercel.app |
| **Vercel** | `fb-cell-admin-s-projects/fst-uchet` |
| **GitHub** | https://github.com/DMDAdmin/FST-uchet |
| **Firebase** | проект `fst-uchet-14c02` |
| **Админ** | `admin@fibercell.net` (`src/lib/cloud/fstAdmin.ts`) |

## Локальная настройка (один раз)

### 1. Vercel

```powershell
vercel login
vercel link --yes --project fst-uchet --scope fb-cell-admin-s-projects
vercel env pull fst-web/.env --environment=production --yes
```

### 2. Firebase

```powershell
firebase login
firebase use fst-uchet-14c02
```

В [Firebase Console](https://console.firebase.google.com/project/fst-uchet-14c02):
- Authentication → Email/Password → Enable
- Пользователь: `admin@fibercell.net`

Правила Firestore деплоятся из `fst-web/firestore.rules`:

```powershell
cd fst-web
firebase deploy --only firestore:rules
```

### 3. GitHub → Vercel (автодеплой)

```powershell
gh auth login
vercel git connect
```

Если `git connect` не сработал — в [Vercel Dashboard](https://vercel.com/fb-cell-admin-s-projects/fst-uchet/settings/git) подключите репозиторий `DMDAdmin/FST-uchet` вручную.

### 4. Проверка

```powershell
npm run dev:fst-web          # локально с Firebase
npm run test:firebase        # тест записи в Firestore
node scripts/build.mjs       # сборка как на Vercel
```

## Деплой вручную

```powershell
npm run deploy:cloud
# или
vercel --prod
```

## Локальная vs облачная версия

| | Локально `npm run dev` | Облако |
|--|------------------------|--------|
| Вход | `admin` / пароль из справочника | `admin@fibercell.net` / Firebase Auth |
| Данные | SQLite / localStorage | Firestore `fstStores/{uid}` |
