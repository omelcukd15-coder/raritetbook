import type {
  CatalogBookLite,
  CatalogManifest,
  CategoryId,
  CategoryMeta,
  FullBookData,
  HomeFeaturedPayload,
} from '../types/library';
import { getCachedBook, saveBookOffline } from './offlineDb';

const ARCHIVE_BASE = (import.meta.env.VITE_ARCHIVE_BASE_URL || '').replace(/\/$/, '');
const DEFAULT_SHARD_REPOS = [
  'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books/main',
  'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-2/main',
];
const CF_ARCHIVE_CDN = 'https://archive.raritetbook.ru';
const SAFE_SLUG_RE = /^[a-z0-9-]+$/i;

let cachedManifest: CatalogManifest | null = null;
let cachedHomeFeatured: HomeFeaturedPayload | null = null;
let cachedCatalog: CatalogBookLite[] | null = null;
let cachedCategories: CategoryMeta[] | null = null;

let firstChunkBooks: CatalogBookLite[] = [];
let fullStreamPromise: Promise<CatalogBookLite[]> | null = null;
let firstChunkPromise: Promise<CatalogBookLite[]> | null = null;

const catalogListeners = new Set<(books: CatalogBookLite[], done: boolean) => void>();

let workerInstance: Worker | null = null;
let workerReqSeq = 0;
const pendingSearch = new Map<number, (ids: string[] | null) => void>();

async function fetchWithTimeout(url: string, timeoutMs = 9_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getWorker(): Worker | null {
  if (workerInstance) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    workerInstance = new Worker(new URL('./searchWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'RESULTS') {
        const cb = pendingSearch.get(e.data.requestId);
        if (cb) {
          pendingSearch.delete(e.data.requestId);
          cb(e.data.ids);
        }
      }
    };
    return workerInstance;
  } catch {
    workerInstance = null;
    return null;
  }
}

/**
 * Распаковка компактного 14-элементного кортежа чанка в объект CatalogBookLite
 */
function decodeTupleRow(row: any[], catMap: CategoryId[], langMap: string[]): CatalogBookLite {
  const slug = String(row[0] || '');
  return {
    id: slug,
    slug,
    t: String(row[1] || ''),
    as: String(row[2] || ''),
    a: String(row[3] || ''),
    aslug: String(row[4] || 'author'),
    cat: catMap[Number(row[5]) || 0] || 'russian-classics',
    lang: langMap[Number(row[6]) || 0] || 'ru',
    ey: String(row[7] || ''),
    wy: String(row[7] || ''),
    w: Number(row[8]) || 0,
    rm: Number(row[9]) || 5,
    rank: Number(row[10]) || 0,
    sh: Number(row[11]) || 0,
    ch: Number(row[12]) || 1,
    d: String(row[13] || ''),
    alt: [],
    ay: '',
    tr: null,
  };
}

export async function loadCatalogManifest(): Promise<CatalogManifest> {
  if (cachedManifest) return cachedManifest;
  const resp = await fetchWithTimeout('/archive-meta/manifest.json', 8_000);
  if (!resp.ok) throw new Error('Не удалось загрузить манифест архива');
  cachedManifest = await resp.json();
  return cachedManifest!;
}

/**
 * Мгновенная витрина Главной страницы (~14 КБ вместо мегабайтного каталога -> старт за 0.1с на любом телефоне!)
 */
export async function loadHomeFeatured(): Promise<HomeFeaturedPayload> {
  if (cachedHomeFeatured) return cachedHomeFeatured;
  const resp = await fetchWithTimeout('/archive-meta/home-featured.json', 8_000);
  if (!resp.ok) throw new Error('Не удалось загрузить витрину главной');
  cachedHomeFeatured = await resp.json();
  return cachedHomeFeatured!;
}

/**
 * Подписка на потоковую подгрузку чанков каталога (по 5 000 книг, до 100 000+ томов без фризов UI):
 * 1-й чанк (5 000 книг) отдаётся за ~120 мс, остальные догружаются в фоне с yield между кадрами.
 */
export function subscribeShardedCatalog(
  onUpdate: (books: CatalogBookLite[], done: boolean, totalExpected: number) => void
): () => void {
  if (cachedCatalog) {
    onUpdate(cachedCatalog, true, cachedManifest?.totalBooks || cachedCatalog.length);
    return () => {};
  }

  const listener = (books: CatalogBookLite[], done: boolean) => {
    onUpdate(books, done, cachedManifest?.totalBooks || books.length);
  };
  catalogListeners.add(listener);

  if (firstChunkBooks.length > 0) {
    onUpdate(firstChunkBooks, false, cachedManifest?.totalBooks || firstChunkBooks.length);
  }

  void loadCatalogLite();
  return () => {
    catalogListeners.delete(listener);
  };
}

async function fetchSingleChunk(chunkFile: string, manifest: CatalogManifest): Promise<CatalogBookLite[]> {
  const resp = await fetchWithTimeout(`/archive-meta/shards/${chunkFile}`, 12_000);
  if (!resp.ok) throw new Error(`Ошибка загрузки чанка ${chunkFile}`);
  const data = await resp.json();
  const rows: any[][] = data.r || [];
  return rows.map((r) => decodeTupleRow(r, manifest.catMap, manifest.langMap));
}

export async function loadFirstCatalogChunk(): Promise<CatalogBookLite[]> {
  if (cachedCatalog) return cachedCatalog;
  if (firstChunkBooks.length > 0) return firstChunkBooks;
  if (firstChunkPromise) return firstChunkPromise;

  firstChunkPromise = (async () => {
    const manifest = await loadCatalogManifest();
    if (!manifest.chunks.length) return [];
    const chunk0 = await fetchSingleChunk(manifest.chunks[0], manifest);
    firstChunkBooks = chunk0;
    const w = getWorker();
    if (w) {
      w.postMessage({ type: 'INIT', payload: { books: chunk0 } });
    }
    for (const fn of catalogListeners) {
      fn(chunk0, manifest.chunks.length === 1);
    }
    return chunk0;
  })().catch((err) => {
    firstChunkPromise = null;
    throw err;
  });

  return firstChunkPromise;
}

export async function loadCatalogLite(): Promise<CatalogBookLite[]> {
  if (cachedCatalog) return cachedCatalog;
  if (fullStreamPromise) return fullStreamPromise;

  fullStreamPromise = (async () => {
    const manifest = await loadCatalogManifest();
    const first = await loadFirstCatalogChunk();
    let accumulated = [...first];

    if (manifest.chunks.length > 1) {
      const w = getWorker();
      // Потоковая подгрузка остальных чанков по 2 параллельно с уступкой главному потоку (yield 12мс) для 60 FPS на старых смартфонах
      for (let i = 1; i < manifest.chunks.length; i += 2) {
        const pair = manifest.chunks.slice(i, i + 2);
        const loadedChunks = await Promise.all(pair.map((cf) => fetchSingleChunk(cf, manifest)));
        for (const chBooks of loadedChunks) {
          accumulated = accumulated.concat(chBooks);
          if (w) {
            w.postMessage({ type: 'ADD_CHUNK', payload: { books: chBooks } });
          }
        }
        const isLast = i + 2 >= manifest.chunks.length;
        for (const fn of catalogListeners) {
          fn(accumulated, isLast);
        }
        if (!isLast) {
          await new Promise((r) => setTimeout(r, 12));
        }
      }
    }

    cachedCatalog = accumulated;
    firstChunkBooks = accumulated;
    for (const fn of catalogListeners) {
      fn(accumulated, true);
    }
    return accumulated;
  })().catch((err) => {
    fullStreamPromise = null;
    throw err;
  });

  return fullStreamPromise;
}

export async function loadCategories(): Promise<CategoryMeta[]> {
  if (cachedCategories) return cachedCategories;
  const resp = await fetchWithTimeout('/archive-meta/categories.json', 8_000);
  if (!resp.ok) return [];
  const data = await resp.json();
  cachedCategories = data;
  return data;
}

export async function searchBooksInWorker(query: string): Promise<string[] | null> {
  const clean = query.trim().slice(0, 100);
  if (!clean) return null;

  // Не блокируем поиск ожиданием всех 100к книг: начинаем искать уже по первому чанку и запускаем фоновый стрим!
  await loadFirstCatalogChunk();
  void loadCatalogLite();

  const w = getWorker();
  if (!w) {
    const pool = cachedCatalog || firstChunkBooks;
    const norm = clean.toLowerCase().replace(/ё/g, 'е').replace(/æ/g, 'ӕ');
    return pool
      .filter((b) =>
        `${b.t} ${b.a} ${b.as}`
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/æ/g, 'ӕ')
          .includes(norm)
      )
      .map((b) => b.id);
  }

  return new Promise((resolve) => {
    const reqId = ++workerReqSeq;
    pendingSearch.set(reqId, resolve);
    w.postMessage({ type: 'SEARCH', requestId: reqId, payload: { query: clean } });
  });
}

function getShardRepoBase(shardIndex = 0): string {
  const repos = cachedManifest?.shardRepos || DEFAULT_SHARD_REPOS;
  if (repos[shardIndex]) return repos[shardIndex];
  if (shardIndex === 0) return DEFAULT_SHARD_REPOS[0];
  return `https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-${shardIndex + 1}/main`;
}

export function getBookArchiveUrl(
  authorSlug: string,
  slug: string,
  file: 'book.json' | 'original.fb2',
  shard = 0
): string {
  if (!SAFE_SLUG_RE.test(authorSlug) || !SAFE_SLUG_RE.test(slug)) {
    throw new Error('Некорректный идентификатор книги.');
  }
  if (import.meta.env.DEV && !ARCHIVE_BASE) {
    return `/archive/books/${authorSlug}/${slug}/${file}`;
  }
  if (ARCHIVE_BASE) {
    return `${ARCHIVE_BASE}/archive/books/${authorSlug}/${slug}/${file}`;
  }
  return `${getShardRepoBase(shard)}/books/${authorSlug}/${slug}/${file}`;
}

async function findBookCatalogEntry(slug: string): Promise<CatalogBookLite | undefined> {
  await loadFirstCatalogChunk();
  const inFirst = firstChunkBooks.find((b) => b.slug === slug);
  if (inFirst) return inFirst;
  const full = await loadCatalogLite();
  return full.find((b) => b.slug === slug);
}

export async function loadFullBook(slug: string): Promise<{ book: FullBookData; fromOfflineCache: boolean }> {
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new Error('Некорректный адрес произведения.');
  }

  // 1. Мгновенная проверка IndexedDB (PWA офлайн-чтение)
  const offline = await getCachedBook(slug);
  if (offline) {
    return { book: offline, fromOfflineCache: true };
  }

  const entry = await findBookCatalogEntry(slug);
  if (!entry || !SAFE_SLUG_RE.test(entry.aslug) || !SAFE_SLUG_RE.test(entry.slug)) {
    throw new Error('Произведение не найдено в каталоге библиотеки.');
  }

  const shardRepo = getShardRepoBase(entry.sh || 0);
  const candidateUrls = import.meta.env.DEV
    ? [
        `/archive/books/${entry.aslug}/${entry.slug}/book.json`,
        `${shardRepo}/books/${entry.aslug}/${entry.slug}/book.json`,
      ]
    : [
        `${shardRepo}/books/${entry.aslug}/${entry.slug}/book.json`,
        `${CF_ARCHIVE_CDN}/archive/books/${entry.aslug}/${entry.slug}/book.json`,
      ];

  let lastErr: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const resp = await fetchWithTimeout(url, 9_000);
      if (resp.ok) {
        const fullBook: FullBookData = await resp.json();
        void saveBookOffline(fullBook);
        return { book: fullBook, fromOfflineCache: false };
      }
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('Не удалось загрузить том из архива. Проверьте подключение к сети.');
}
