/**
 * Cloudflare Pages Functions / Workers API — RaritetBook.ru
 * Обслуживает облачную авторизацию и кросс-девайс синхронизацию прогресса (D1).
 * Чтение книг и каталога идёт напрямую через GitHub Fastly CDN / Pages CDN без обращения к D1.
 */

export interface Env {
  DB: any; // D1Database
  SESSION_SECRET: string;
  ADMIN_PASSWORD?: string;
}

const MAX_PROGRESS_BYTES = 10_240; // Строгий лимит 10 КБ на пользователя
const SESSION_TTL_SEC = 60 * 60 * 24 * 90; // 90 дней сессии
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const STATIC_ALLOWED_ORIGINS = new Set([
  'https://raritetbook.ru',
  'https://www.raritetbook.ru',
  'https://api.raritetbook.ru',
  'https://omelcukd15-coder.github.io',
  'https://raritetbook-ru.pages.dev',
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.raritetbook-ru\.pages\.dev$/i.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}

// Защита от перебора паролей (Per-IP Sliding Window в памяти изолята)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, scope: 'auth' | 'sync', limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > 2500) {
    for (const [k, v] of rateBuckets) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }
  const key = `${scope}:${ip}`;
  const item = rateBuckets.get(key);
  if (!item || item.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (item.count >= limit) {
    return false;
  }
  item.count += 1;
  return true;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= ba[i] ^ bb[i];
  }
  return diff === 0;
}

async function pbkdf2Hex(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltHex),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signSession(email: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const data = `${email}|${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sig = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return btoa(`${data}|${sig}`);
}

async function verifyToken(rawToken: string, secret: string): Promise<string | null> {
  try {
    const decoded = atob(rawToken.trim());
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;
    const [email, expStr, sigHex] = parts;
    const exp = Number(expStr);
    if (!email || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    const sigBytes = hexToBytes(sigHex);
    if (!sigBytes) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${email}|${expStr}`)
    );
    return valid ? email : null;
  } catch {
    return null;
  }
}

async function extractSessionEmail(request: Request, secret: string): Promise<string | null> {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const email = await verifyToken(token, secret);
      if (email) return email;
    }
  }
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)rb_session=([^;]+)/);
    if (match) {
      return verifyToken(decodeURIComponent(match[1]), secret);
    }
  }
  return null;
}

function sanitizeProgressPayload(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, any>;
  const safeBooks: Record<string, any> = {};

  if (obj.books && typeof obj.books === 'object' && !Array.isArray(obj.books)) {
    const entries = Object.entries(obj.books).slice(0, 60);
    for (const [slug, val] of entries) {
      if (
        !slug ||
        slug.length > 96 ||
        slug === '__proto__' ||
        slug === 'constructor' ||
        slug === 'prototype' ||
        !/^[a-z0-9-]+$/i.test(slug) ||
        !val ||
        typeof val !== 'object'
      ) {
        continue;
      }
      const v = val as Record<string, any>;
      let safeBm = null;
      if (v.bookmark && typeof v.bookmark === 'object') {
        safeBm = {
          chapterIndex: Math.max(0, Math.min(5000, Math.floor(Number(v.bookmark.chapterIndex) || 0))),
          scrollRatio: Math.max(0, Math.min(1, Number(v.bookmark.scrollRatio) || 0)),
          excerpt: String(v.bookmark.excerpt || '').slice(0, 180),
          createdAt: Math.max(0, Math.floor(Number(v.bookmark.createdAt) || Date.now())),
        };
      }
      safeBooks[slug] = {
        slug,
        chapterIndex: Math.max(0, Math.min(5000, Math.floor(Number(v.chapterIndex) || 0))),
        scrollRatio: Math.max(0, Math.min(1, Number(v.scrollRatio) || 0)),
        percent: Math.max(0, Math.min(100, Math.round(Number(v.percent) || 0))),
        bookmark: safeBm,
        updatedAt: Math.max(0, Math.floor(Number(v.updatedAt) || Date.now())),
      };
    }
  }

  let safeSettings: Record<string, any> | undefined;
  if (obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings)) {
    const s = obj.settings as Record<string, any>;
    safeSettings = {
      theme: ['parchment', 'day', 'night'].includes(s.theme) ? s.theme : 'parchment',
      fontSize: Math.max(14, Math.min(24, Math.round(Number(s.fontSize) || 18))),
      lineHeight: Math.max(1.4, Math.min(2.1, Number(s.lineHeight) || 1.72)),
      fontFamily: s.fontFamily === 'sans' ? 'sans' : 'serif',
      columnWidth: ['narrow', 'medium', 'wide'].includes(s.columnWidth) ? s.columnWidth : 'medium',
    };
  }

  const serialized = JSON.stringify({ books: safeBooks, ...(safeSettings ? { settings: safeSettings } : {}) });
  if (serialized.length > MAX_PROGRESS_BYTES) return null;
  return serialized;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin) && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function jsonResp(
  body: unknown,
  status = 200,
  origin: string | null = null,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      ...buildCorsHeaders(origin),
      ...extraHeaders,
    },
  });
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = request.headers.get('Origin');
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (request.method === 'OPTIONS') {
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(null, { status: 403, headers: buildCorsHeaders(null) });
    }
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  }

  // Строгая проверка доверенного Origin для всех мутирующих запросов
  if (request.method === 'POST' && origin && !isAllowedOrigin(origin) && origin !== url.origin) {
    return jsonResp({ error: 'CSRF check failed' }, 403, origin);
  }

  if (path === '/api/health' && request.method === 'GET') {
    return jsonResp({ ok: true, service: 'raritetbook-cloud-sync', dbReady: Boolean(env.DB) }, 200, origin);
  }

  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResp({ error: 'Сервис облачной базы временно недоступен' }, 503, origin);
  }

  if (path === '/api/admin/verify' && request.method === 'POST') {
    if (!checkRateLimit(clientIp, 'auth', 6, 60_000)) {
      return jsonResp({ error: 'Слишком много попыток. Подождите минуту.' }, 429, origin);
    }
    const body: any = await request.json().catch(() => ({}));
    const keyCandidate = String(body.key || '');
    const expected = env.ADMIN_PASSWORD || `${env.SESSION_SECRET.slice(0, 16)}#RaritetAdmin`;
    if (!keyCandidate || !timingSafeEqualStr(keyCandidate, expected)) {
      return jsonResp({ error: 'Неверный ключ администратора' }, 401, origin);
    }
    return jsonResp({ ok: true }, 200, origin);
  }

  if (path === '/api/admin/stats' && request.method === 'POST') {
    if (!checkRateLimit(clientIp, 'auth', 20, 60_000)) {
      return jsonResp({ error: 'Слишком много запросов. Подождите минуту.' }, 429, origin);
    }
    const body: any = await request.json().catch(() => ({}));
    const keyCandidate = String(body.key || '');
    const expected = env.ADMIN_PASSWORD || `${env.SESSION_SECRET.slice(0, 16)}#RaritetAdmin`;
    if (!keyCandidate || !timingSafeEqualStr(keyCandidate, expected)) {
      return jsonResp({ error: 'Неверный ключ администратора' }, 401, origin);
    }

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const summary = await env.DB.prepare(
      `SELECT
        COUNT(*) as totalUsers,
        SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) as newUsers24h,
        SUM(CASE WHEN updated_at >= ?1 THEN 1 ELSE 0 END) as activeUsers24h,
        SUM(CASE WHEN updated_at >= ?2 THEN 1 ELSE 0 END) as activeUsers7d
      FROM users`
    )
      .bind(dayAgo, weekAgo)
      .first();

    const rowsRes = await env.DB.prepare(
      'SELECT email, progress, created_at, updated_at FROM users ORDER BY updated_at DESC LIMIT 200'
    ).all();
    const rows: any[] = rowsRes?.results || [];

    let totalReadingRecords = 0;
    let totalBookmarks = 0;
    const bookAgg = new Map<string, { readers: number; sumPct: number }>();

    const recentUsers = rows.slice(0, 25).map((r) => {
      let booksCount = 0;
      let bookmarksCount = 0;
      try {
        const p = JSON.parse(r.progress || '{}');
        const booksObj = p.books && typeof p.books === 'object' ? p.books : {};
        const entries = Object.values(booksObj) as any[];
        booksCount = entries.length;
        bookmarksCount = entries.filter((x) => x && x.bookmark).length;
      } catch {
        // ignore
      }
      return {
        email: String(r.email || ''),
        createdAt: Number(r.created_at) || 0,
        updatedAt: Number(r.updated_at) || 0,
        booksCount,
        bookmarksCount,
      };
    });

    for (const r of rows) {
      try {
        const p = JSON.parse(r.progress || '{}');
        const booksObj = p.books && typeof p.books === 'object' ? p.books : {};
        for (const [slug, val] of Object.entries(booksObj) as [string, any][]) {
          totalReadingRecords += 1;
          if (val?.bookmark) totalBookmarks += 1;
          const prev = bookAgg.get(slug) || { readers: 0, sumPct: 0 };
          prev.readers += 1;
          prev.sumPct += Number(val?.percent) || 0;
          bookAgg.set(slug, prev);
        }
      } catch {
        // ignore
      }
    }

    const topBooks = Array.from(bookAgg.entries())
      .map(([slug, v]) => ({
        slug,
        readers: v.readers,
        avgPercent: Math.round(v.sumPct / Math.max(1, v.readers)),
      }))
      .sort((a, b) => b.readers - a.readers || b.avgPercent - a.avgPercent)
      .slice(0, 10);

    return jsonResp(
      {
        ok: true,
        stats: {
          totalUsers: Number(summary?.totalUsers) || 0,
          newUsers24h: Number(summary?.newUsers24h) || 0,
          activeUsers24h: Number(summary?.activeUsers24h) || 0,
          activeUsers7d: Number(summary?.activeUsers7d) || 0,
          totalReadingRecords,
          totalBookmarks,
          recentUsers,
          topBooks,
          serverTime: now,
        },
      },
      200,
      origin
    );
  }

  if (path === '/api/auth/register' && request.method === 'POST') {
    if (!checkRateLimit(clientIp, 'auth', 12, 60_000)) {
      return jsonResp({ error: 'Слишком много попыток регистрации. Подождите 1 минуту.' }, 429, origin);
    }

    const body: any = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (email.length < 5 || email.length > 120 || !EMAIL_RE.test(email)) {
      return jsonResp({ error: 'Укажите корректный адрес электронной почты.' }, 400, origin);
    }
    if (password.length < 6 || password.length > 128) {
      return jsonResp({ error: 'Пароль должен содержать от 6 до 128 символов.' }, 400, origin);
    }

    const existing = await env.DB.prepare('SELECT email FROM users WHERE email = ?1').bind(email).first();
    if (existing) {
      return jsonResp({ error: 'Этот e-mail уже зарегистрирован. Откройте вкладку «Вход».' }, 409, origin);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const passHash = await pbkdf2Hex(password, salt);
    const now = Date.now();
    const progressStr = sanitizeProgressPayload(body.progress || {}) || '{"books":{}}';

    try {
      await env.DB.prepare(
        'INSERT INTO users (email, pass_hash, salt, progress, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
      )
        .bind(email, passHash, salt, progressStr, now, now)
        .run();
    } catch {
      return jsonResp({ error: 'Этот e-mail уже зарегистрирован. Откройте вкладку «Вход».' }, 409, origin);
    }

    const token = await signSession(email, env.SESSION_SECRET);
    return jsonResp(
      { ok: true, email, token, progress: JSON.parse(progressStr) },
      201,
      origin,
      {
        'Set-Cookie': `rb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`,
      }
    );
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!checkRateLimit(clientIp, 'auth', 12, 60_000)) {
      return jsonResp({ error: 'Слишком много попыток входа. Подождите 1 минуту.' }, 429, origin);
    }

    const body: any = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || email.length > 120 || password.length < 1 || password.length > 128) {
      return jsonResp({ error: 'Неверный e-mail или пароль.' }, 401, origin);
    }

    const row = await env.DB.prepare('SELECT email, pass_hash, salt, progress FROM users WHERE email = ?1')
      .bind(email)
      .first();

    if (!row) {
      return jsonResp(
        { error: 'Аккаунт с таким e-mail не найден в облаке. Зарегистрируйтесь во вкладке «Регистрация».' },
        404,
        origin
      );
    }

    const hash = await pbkdf2Hex(password, row.salt);
    if (!timingSafeEqualStr(hash, String(row.pass_hash))) {
      return jsonResp({ error: 'Неверный пароль.' }, 401, origin);
    }

    const token = await signSession(email, env.SESSION_SECRET);
    let progress = { books: {} };
    try {
      progress = JSON.parse(row.progress || '{"books":{}}');
    } catch {
      progress = { books: {} };
    }

    return jsonResp(
      { ok: true, email, token, progress },
      200,
      origin,
      {
        'Set-Cookie': `rb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`,
      }
    );
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return jsonResp(
      { ok: true },
      200,
      origin,
      { 'Set-Cookie': 'rb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }
    );
  }

  if (path === '/api/progress/pull' && request.method === 'GET') {
    if (!checkRateLimit(clientIp, 'sync', 60, 60_000)) {
      return jsonResp({ error: 'Rate limit exceeded' }, 429, origin);
    }
    const email = await extractSessionEmail(request, env.SESSION_SECRET);
    if (!email) return jsonResp({ error: 'Unauthorized' }, 401, origin);

    const row = await env.DB.prepare('SELECT progress, updated_at FROM users WHERE email = ?1')
      .bind(email)
      .first();
    if (!row) return jsonResp({ error: 'Account not found' }, 401, origin);

    let progress = { books: {} };
    try {
      progress = JSON.parse(row.progress || '{"books":{}}');
    } catch {
      progress = { books: {} };
    }
    return jsonResp({ ok: true, email, progress, updatedAt: row.updated_at }, 200, origin);
  }

  if (path === '/api/progress/sync' && request.method === 'POST') {
    if (!checkRateLimit(clientIp, 'sync', 60, 60_000)) {
      return jsonResp({ error: 'Rate limit exceeded' }, 429, origin);
    }

    const rawText = await request.text();
    if (rawText.length > MAX_PROGRESS_BYTES * 2) {
      return jsonResp({ error: 'Progress payload exceeds limit' }, 413, origin);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResp({ error: 'Invalid JSON' }, 400, origin);
    }

    let email = await extractSessionEmail(request, env.SESSION_SECRET);
    if (!email && parsed && typeof parsed._token === 'string') {
      email = await verifyToken(parsed._token, env.SESSION_SECRET);
    }
    if (!email) return jsonResp({ error: 'Unauthorized' }, 401, origin);

    const sanitized = sanitizeProgressPayload(parsed);
    if (!sanitized) {
      return jsonResp({ error: 'Invalid progress format or exceeds 10KB limit' }, 400, origin);
    }

    const now = Date.now();
    const res = await env.DB.prepare('UPDATE users SET progress = ?1, updated_at = ?2 WHERE email = ?3')
      .bind(sanitized, now, email)
      .run();

    if (!res?.meta?.changes && res?.changes === 0) {
      return jsonResp({ error: 'Account not found' }, 401, origin);
    }

    return jsonResp({ ok: true, updatedAt: now }, 200, origin);
  }

  return jsonResp({ error: 'Not found' }, 404, origin);
};
