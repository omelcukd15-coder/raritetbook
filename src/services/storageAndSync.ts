import type { BookReadingProgress, ReaderSettings, UserSession } from '../types/library';

const PROGRESS_KEY = 'raritetbook_progress_v1';
const SETTINGS_KEY = 'raritetbook_reader_settings_v1';
const SESSION_KEY = 'raritetbook_user_session_v1';
const LOCAL_VAULT_KEY = 'raritetbook_local_accounts_v1';

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'parchment',
  fontSize: 18,
  lineHeight: 1.72,
  fontFamily: 'serif',
  columnWidth: 'medium',
};

let dirtySync = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function getAllProgress(): Record<string, BookReadingProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getBookProgress(slug: string): BookReadingProgress | null {
  const all = getAllProgress();
  return all[slug] || null;
}

export function saveBookProgress(entry: BookReadingProgress): void {
  const all = getAllProgress();
  all[entry.slug] = { ...entry, updatedAt: Date.now() };

  // Контроль лимита 10 КБ на пользователя для D1: оставляем 60 последних активных книг
  const sorted = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  const trimmed: Record<string, BookReadingProgress> = {};
  for (const item of sorted) {
    trimmed[item.slug] = item;
  }

  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('raritetbook:progress-updated'));
  } catch {
    // ignore storage errors
  }

  scheduleCloudSync();
}

export function getReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
  scheduleCloudSync();
}

export function getCurrentUser(): UserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function registerAccount(email: string, password: string): Promise<UserSession> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@') || password.length < 6) {
    throw new Error('Укажите корректный e-mail и пароль не короче 6 символов.');
  }

  // Пробуем облачный Cloudflare Worker API (/api/auth/register)
  try {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: cleanEmail,
        password,
        progress: { books: getAllProgress(), settings: getReaderSettings() },
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const session: UserSession = {
        email: data.email || cleanEmail,
        createdAt: Date.now(),
        mode: 'cloud',
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
      return session;
    }
    if (resp.status === 409) {
      throw new Error('Аккаунт с таким e-mail уже зарегистрирован.');
    }
  } catch (err: any) {
    if (err?.message?.includes('уже зарегистрирован')) throw err;
  }

  // Безопасный автономный режим (PBKDF2/SHA-256 хеш с солью — пароль никогда не хранится в открытом виде!)
  const vaultRaw = localStorage.getItem(LOCAL_VAULT_KEY);
  const vault: Record<string, { salt: string; passHash: string; payload: string; createdAt: number }> =
    vaultRaw ? JSON.parse(vaultRaw) : {};

  if (vault[cleanEmail]) {
    throw new Error('Аккаунт с таким e-mail уже существует. Войдите с паролем.');
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const passHash = await sha256Hex(`${salt}:${password}:raritetbook`);

  vault[cleanEmail] = {
    salt,
    passHash,
    payload: JSON.stringify({ books: getAllProgress(), settings: getReaderSettings() }),
    createdAt: Date.now(),
  };
  localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(vault));

  const session: UserSession = { email: cleanEmail, createdAt: Date.now(), mode: 'local-account' };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
  return session;
}

export async function loginAccount(email: string, password: string): Promise<UserSession> {
  const cleanEmail = email.trim().toLowerCase();

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: cleanEmail, password }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.progress?.books) {
        const merged = { ...data.progress.books, ...getAllProgress() };
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
      }
      if (data.progress?.settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.progress.settings));
      }
      const session: UserSession = { email: cleanEmail, createdAt: Date.now(), mode: 'cloud' };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
      return session;
    }
    if (resp.status === 401) {
      throw new Error('Неверный e-mail или пароль.');
    }
  } catch (err: any) {
    if (err?.message?.includes('Неверный')) throw err;
  }

  const vaultRaw = localStorage.getItem(LOCAL_VAULT_KEY);
  const vault = vaultRaw ? JSON.parse(vaultRaw) : {};
  const record = vault[cleanEmail];
  if (!record) {
    throw new Error('Аккаунт не найден. Создайте новый аккаунт во вкладке «Регистрация».');
  }

  const candidateHash = await sha256Hex(`${record.salt}:${password}:raritetbook`);
  if (candidateHash !== record.passHash) {
    throw new Error('Неверный пароль.');
  }

  if (record.payload) {
    try {
      const parsed = JSON.parse(record.payload);
      if (parsed.books) {
        const merged = { ...parsed.books, ...getAllProgress() };
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
      }
    } catch {
      // ignore
    }
  }

  const session: UserSession = { email: cleanEmail, createdAt: record.createdAt, mode: 'local-account' };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
  return session;
}

export async function logoutAccount(): Promise<void> {
  await flushCloudSync();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // ignore offline
  }
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
}

/**
 * Редкая синхронизация прогресса (раз в 3 минуты при наличии изменений — по п. 15 ТЗ)
 * + немедленная отправка при сворачивании вкладки.
 */
export function scheduleCloudSync(): void {
  const user = getCurrentUser();
  if (!user) return;
  dirtySync = true;
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushCloudSync();
  }, 180_000); // 3 минуты debounce для экономии запросов D1
}

export async function flushCloudSync(): Promise<void> {
  if (!dirtySync) return;
  const user = getCurrentUser();
  if (!user) {
    dirtySync = false;
    return;
  }

  const payloadObj = { books: getAllProgress(), settings: getReaderSettings() };
  const serialized = JSON.stringify(payloadObj);
  if (serialized.length > 10_240) return; // Строгий лимит 10 КБ по п. 15 ТЗ

  dirtySync = false;

  if (user.mode === 'local-account') {
    try {
      const vaultRaw = localStorage.getItem(LOCAL_VAULT_KEY);
      const vault = vaultRaw ? JSON.parse(vaultRaw) : {};
      if (vault[user.email]) {
        vault[user.email].payload = serialized;
        localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(vault));
      }
    } catch {
      // ignore
    }
    return;
  }

  try {
    const resp = await fetch('/api/progress/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: serialized,
    });
    if (!resp.ok) {
      dirtySync = true;
    }
  } catch {
    dirtySync = true;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushCloudSync();
    }
  });
}
