import type { BookReadingProgress, ReaderSettings, UserSession } from '../types/library';

const PROGRESS_KEY = 'raritetbook_progress_v1';
const SETTINGS_KEY = 'raritetbook_reader_settings_v1';
const SESSION_KEY = 'raritetbook_user_session_v1';
const LEGACY_LOCAL_VAULT_KEY = 'raritetbook_local_accounts_v1';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'https://api.raritetbook.ru'
).replace(/\/$/, '');

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'parchment',
  fontSize: 18,
  lineHeight: 1.72,
  fontFamily: 'serif',
  columnWidth: 'medium',
};

let dirtySync = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastPullAt = 0;

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 12_000, retries = 1): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: ctrl.signal,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export function getAllProgress(): Record<string, BookReadingProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getBookProgress(slug: string): BookReadingProgress | null {
  const all = getAllProgress();
  return all[slug] || null;
}

/**
 * Умное слияние прогресса между ПК и телефоном по метке времени updatedAt на каждую книгу
 * с сохранением самой свежей закладки.
 */
function mergeProgressMaps(
  cloudBooks: Record<string, BookReadingProgress> | undefined,
  localBooks: Record<string, BookReadingProgress>
): { merged: Record<string, BookReadingProgress>; localHadNewer: boolean } {
  const out: Record<string, BookReadingProgress> = {};
  let localHadNewer = false;

  const slugs = new Set<string>([
    ...Object.keys(cloudBooks || {}),
    ...Object.keys(localBooks || {}),
  ]);

  for (const slug of slugs) {
    if (!slug || slug === '__proto__' || slug === 'constructor') continue;
    const c = cloudBooks?.[slug];
    const l = localBooks?.[slug];
    if (c && l) {
      const cTime = Number(c.updatedAt) || 0;
      const lTime = Number(l.updatedAt) || 0;
      const winner = lTime > cTime ? l : c;
      if (lTime > cTime) localHadNewer = true;

      // Сохраняем более свежую закладку, если она есть на одном из устройств
      let bookmark = winner.bookmark ?? null;
      if (!bookmark && (c.bookmark || l.bookmark)) {
        bookmark = (l.bookmark?.createdAt || 0) >= (c.bookmark?.createdAt || 0)
          ? (l.bookmark ?? c.bookmark ?? null)
          : (c.bookmark ?? l.bookmark ?? null);
      }
      out[slug] = { ...winner, bookmark };
    } else if (l) {
      out[slug] = l;
      localHadNewer = true;
    } else if (c) {
      out[slug] = c;
    }
  }

  // Лимит 60 последних активных книг (гарантия <= 10 КБ в D1)
  const sorted = Object.values(out)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 60);
  const trimmed: Record<string, BookReadingProgress> = {};
  for (const item of sorted) {
    trimmed[item.slug] = item;
  }
  return { merged: trimmed, localHadNewer };
}

export function saveBookProgress(entry: BookReadingProgress, immediate = false): void {
  const all = getAllProgress();
  all[entry.slug] = { ...entry, updatedAt: Date.now() };

  const sorted = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  const trimmed: Record<string, BookReadingProgress> = {};
  for (const item of sorted) {
    trimmed[item.slug] = item;
  }

  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('raritetbook:progress-updated'));
  } catch {
    // ignore storage quota errors
  }

  if (immediate) {
    dirtySync = true;
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    void flushCloudSync();
  } else {
    scheduleCloudSync();
  }
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
    window.dispatchEvent(new CustomEvent('raritetbook:settings-updated'));
  } catch {
    // ignore
  }
  dirtySync = true;
  void flushCloudSync();
}

export function getCurrentUser(): UserSession | null {
  try {
    // Очистка устаревшего браузерного локального хранилища аккаунтов, которое не синхронизировалось между устройствами
    if (localStorage.getItem(LEGACY_LOCAL_VAULT_KEY)) {
      localStorage.removeItem(LEGACY_LOCAL_VAULT_KEY);
    }
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.mode !== 'cloud' || !parsed.token || !parsed.email) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed as UserSession;
  } catch {
    return null;
  }
}

export async function registerAccount(email: string, password: string): Promise<UserSession> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length < 5 || cleanEmail.length > 120 || !EMAIL_RE.test(cleanEmail)) {
    throw new Error('Укажите корректный адрес e-mail.');
  }
  if (password.length < 6 || password.length > 128) {
    throw new Error('Пароль должен содержать от 6 до 128 символов.');
  }

  let resp: Response;
  try {
    resp = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        email: cleanEmail,
        password,
        progress: { books: getAllProgress(), settings: getReaderSettings() },
      }),
    });
  } catch {
    throw new Error('Не удалось связаться с облаком синхронизации. Проверьте интернет или отключите блокировщик для api.raritetbook.ru.');
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    throw new Error(data.error || 'Не удалось создать облачный аккаунт.');
  }

  const session: UserSession = {
    email: data.email || cleanEmail,
    token: data.token,
    createdAt: Date.now(),
    mode: 'cloud',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
  return session;
}

export async function loginAccount(email: string, password: string): Promise<UserSession> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    throw new Error('Укажите корректный адрес e-mail.');
  }
  if (password.length < 6 || password.length > 128) {
    throw new Error('Введите пароль (минимум 6 символов).');
  }

  let resp: Response;
  try {
    resp = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ email: cleanEmail, password }),
    });
  } catch {
    throw new Error('Не удалось связаться с облаком синхронизации. Проверьте интернет или отключите блокировщик для api.raritetbook.ru.');
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    throw new Error(data.error || 'Неверный e-mail или пароль.');
  }

  const { merged, localHadNewer } = mergeProgressMaps(data.progress?.books, getAllProgress());
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
    if (data.progress?.settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_READER_SETTINGS, ...data.progress.settings }));
      window.dispatchEvent(new CustomEvent('raritetbook:settings-updated'));
    }
    window.dispatchEvent(new CustomEvent('raritetbook:progress-updated'));
  } catch {
    // ignore
  }

  const session: UserSession = {
    email: data.email || cleanEmail,
    token: data.token,
    createdAt: Date.now(),
    mode: 'cloud',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));

  // Если до входа на этом устройстве читатель уже читал книги — сразу отправляем объединённый прогресс в облако
  if (localHadNewer) {
    dirtySync = true;
    void flushCloudSync();
  }

  return session;
}

export async function pullCloudProgress(force = false): Promise<void> {
  const user = getCurrentUser();
  if (!user?.token) return;

  const now = Date.now();
  if (!force && now - lastPullAt < 15_000) return;
  lastPullAt = now;

  try {
    const resp = await apiFetch('/api/progress/pull', {
      method: 'GET',
      headers: { Authorization: `Bearer ${user.token}` },
    });
    if (resp.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
      return;
    }
    if (!resp.ok) return;

    const data = await resp.json();
    const { merged, localHadNewer } = mergeProgressMaps(data.progress?.books, getAllProgress());
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
    if (data.progress?.settings) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...DEFAULT_READER_SETTINGS, ...data.progress.settings })
      );
      window.dispatchEvent(new CustomEvent('raritetbook:settings-updated'));
    }
    window.dispatchEvent(new CustomEvent('raritetbook:progress-updated'));

    if (localHadNewer) {
      dirtySync = true;
      void flushCloudSync();
    }
  } catch {
    // Тихо работаем в офлайне до появления сети
  }
}

export async function logoutAccount(): Promise<void> {
  await flushCloudSync();
  const user = getCurrentUser();
  try {
    await apiFetch(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {},
      },
      4_000
    );
  } catch {
    // ignore offline
  }
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
}

/**
 * Быстрая облачная синхронизация прогресса (3.5 сек debounce при чтении)
 * + мгновенная отправка при сворачивании вкладки или смене главы.
 */
export function scheduleCloudSync(): void {
  const user = getCurrentUser();
  if (!user?.token) return;
  dirtySync = true;
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushCloudSync();
  }, 3_500);
}

export async function flushCloudSync(): Promise<void> {
  if (!dirtySync) return;
  const user = getCurrentUser();
  if (!user?.token) {
    dirtySync = false;
    return;
  }

  const payloadObj = { books: getAllProgress(), settings: getReaderSettings(), _token: user.token };
  const serialized = JSON.stringify(payloadObj);
  if (serialized.length > 10_240) return;

  dirtySync = false;

  try {
    const resp = await fetch(`${API_BASE_URL}/api/progress/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      keepalive: true,
      body: serialized,
    });
    if (resp.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new CustomEvent('raritetbook:auth-changed'));
      return;
    }
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
    } else if (document.visibilityState === 'visible') {
      void pullCloudProgress();
    }
  });
  window.addEventListener('pagehide', () => {
    void flushCloudSync();
  });
}
