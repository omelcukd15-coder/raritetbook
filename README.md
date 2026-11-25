# RaritetBook.ru — Открытая цифровая библиотека

**«Старинные книги. Вечные знания»**  
Автор и основатель: **Денис Омельчук** ([omelchukdenis.ru](https://omelchukdenis.ru), Telegram: [@omelden_site](https://t.me/omelden_site))

## Стек и архитектура
- **Frontend:** React 18 + Vite 6 + TypeScript + React Router 6 + модульная дизайн-система.
- **Поиск (10 000–50 000 книг):** `MiniSearch` внутри **Web Worker** (`src/services/searchWorker.ts`) с поддержкой русской (`е/ё`) и осетинской (`ӕ/æ`) орфографии.
- **Офлайн-режим (PWA):** автоматическое сохранение открытых томов в `IndexedDB` (`src/services/offlineDb.ts`) + Service Worker (`public/sw.js`).
- **Книжный архив:** **1 020 полных книг** (~22,9 млн слов, валидные `original.fb2` + оптимизированные `book.json`) в `archive/books/`.
- **Backend / Sync:** Cloudflare Pages Functions (`functions/api/[[path]].ts`) + Cloudflare D1 (`migrations/0001_init.sql`) + Cloudflare R2 (`wrangler.jsonc`).

## Локальный запуск
```powershell
npm.cmd install
npm.cmd run dev
```
Откройте `http://localhost:5173`. Локальный плагин Vite раздаёт книги напрямую из `./archive` без копирования гигабайт данных в сборку.

## Продакшн-сборка и деплой на Cloudflare
```powershell
npm.cmd run build
```
1. Создайте бакет R2 `raritetbook-archive` и загрузите содержимое `./archive` (например, через `rclone` или `wrangler r2 object put`).
2. Укажите публичный CDN-домен R2 в переменной окружения `VITE_ARCHIVE_BASE_URL` в Cloudflare Pages.
3. Создайте базу D1 `raritetbook-users`, примените схему `migrations/0001_init.sql` и задайте секрет `SESSION_SECRET`.
