/**
 * Cloudflare Pages Functions / Workers API — RaritetBook.ru
 * Обслуживает только авторизацию и редкую синхронизацию прогресса (D1).
 * Чтение книг и каталога идёт напрямую через R2 / CDN без обращения к D1!
 */

export interface Env {
  DB: any; // D1Database
  SESSION_SECRET: string;
}

const MAX_PROGRESS_BYTES = 10_240; // Строгий лимит 10 КБ на пользователя

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
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
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

async function verifySession(cookieHeader: string | null, secret: string): Promise<string | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)rb_session=([^;]+)/);
  if (!match) return null;
  try {
    const decoded = atob(decodeURIComponent(match[1]));
    const [email, expStr, sig] = decoded.split('|');
    if (!email || !expStr || !sig || Number(expStr) < Math.floor(Date.now() / 1000)) return null;
    const expectedFull = atob(await signSession(email, secret));
    const expectedSig = expectedFull.split('|')[2];
    return sig === expectedSig ? email : null;
  } catch {
    return null;
  }
}

function jsonResp(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      ...extraHeaders,
    },
  });
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Защита от CSRF по Origin для мутирующих запросов
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== url.host) {
      return jsonResp({ error: 'CSRF check failed' }, 403);
    }
  }

  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResp({ error: 'D1 not bound yet' }, 503);
  }

  if (path === '/api/auth/register' && request.method === 'POST') {
    const body: any = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email.includes('@') || password.length < 6) {
      return jsonResp({ error: 'Invalid credentials' }, 400);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const passHash = await pbkdf2Hex(password, salt);
    const now = Date.now();
    const progressStr = JSON.stringify(body.progress || {}).slice(0, MAX_PROGRESS_BYTES);

    try {
      await env.DB.prepare(
        'INSERT INTO users (email, pass_hash, salt, progress, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
      )
        .bind(email, passHash, salt, progressStr, now, now)
        .run();
    } catch {
      return jsonResp({ error: 'Email already exists' }, 409);
    }

    const token = await signSession(email, env.SESSION_SECRET);
    return jsonResp(
      { ok: true, email },
      201,
      {
        'Set-Cookie': `rb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      }
    );
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    const body: any = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const row = await env.DB.prepare('SELECT email, pass_hash, salt, progress FROM users WHERE email = ?1')
      .bind(email)
      .first();
    if (!row) return jsonResp({ error: 'Unauthorized' }, 401);

    const hash = await pbkdf2Hex(password, row.salt);
    if (hash !== row.pass_hash) return jsonResp({ error: 'Unauthorized' }, 401);

    const token = await signSession(email, env.SESSION_SECRET);
    let progress = {};
    try {
      progress = JSON.parse(row.progress || '{}');
    } catch {
      progress = {};
    }

    return jsonResp(
      { ok: true, email, progress },
      200,
      {
        'Set-Cookie': `rb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      }
    );
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return jsonResp(
      { ok: true },
      200,
      { 'Set-Cookie': 'rb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }
    );
  }

  if (path === '/api/progress/sync' && request.method === 'POST') {
    const email = await verifySession(request.headers.get('Cookie'), env.SESSION_SECRET);
    if (!email) return jsonResp({ error: 'Unauthorized' }, 401);

    const rawText = await request.text();
    if (rawText.length > MAX_PROGRESS_BYTES) {
      return jsonResp({ error: 'Progress payload exceeds 10KB limit' }, 413);
    }

    await env.DB.prepare('UPDATE users SET progress = ?1, updated_at = ?2 WHERE email = ?3')
      .bind(rawText, Date.now(), email)
      .run();

    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Not found' }, 404);
};
