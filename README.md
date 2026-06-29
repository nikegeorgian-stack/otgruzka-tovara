# FiberCell — FST (веб)

Веб-учёт табеля, склада, производства и технологии FiberCell.

**Production:** https://fst-uchet-theta.vercel.app  
**Данные:** Firebase Firestore (`fst-uchet-14c02`)  
**Архитектура:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Быстрый старт

```bash
npm install
npm start          # облачная версия локально → http://localhost:5173
```

Первичная настройка Firebase (один раз):

```bash
firebase login
npm run setup:firebase
```

Вход: `admin@fibercell.net` (пароль в Firebase Console).

## Команды

| Команда | Что делает |
|---------|------------|
| `npm start` | Разработка (Firebase, как на Vercel) |
| `npm run deploy` | Сборка + деплой на Vercel |
| `npm run release` | Сборка + правила Firestore + Vercel |
| `npm run test:firebase` | Проверка записи в Firestore |

## Деплой

```bash
npm run deploy
```

## Локальная версия (устарела)

Только если нужен SQLite на ПК завода:

```bash
npm run dev:local
```

Подробнее: [`fst-web/README.md`](fst-web/README.md), [`docs/CLOUD_INTEGRATION.md`](docs/CLOUD_INTEGRATION.md)
