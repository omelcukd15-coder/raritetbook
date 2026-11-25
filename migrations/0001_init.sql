-- RaritetBook.ru — Cloudflare D1 Schema (п. 15 и 17 ТЗ)
-- Один пользователь — одна строка прогресса (JSON до 10 КБ). Тексты книг в D1 НЕ хранятся.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
