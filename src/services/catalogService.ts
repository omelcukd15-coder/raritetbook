import type {
  CatalogBookLite,
  CatalogManifest,
  CategoryId,
  CategoryMeta,
  FullBookData,
  HomeFeaturedPayload,
  SchoolCurriculumPayload,
} from '../types/library';
import { getCachedBook, listOfflineBooksLite, saveBookOffline } from './offlineDb';

const ARCHIVE_BASE = (import.meta.env.VITE_ARCHIVE_BASE_URL || '').replace(/\/$/, '');
const DEFAULT_SHARD_REPOS = [
  'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books/main',
  'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-2/main',
  'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-3/main',
];
const CF_ARCHIVE_CDN = 'https://archive.raritetbook.ru';
const SAFE_SLUG_RE = /^[a-z0-9-]+$/i;

const LS_MANIFEST_KEY = 'raritetbook_cached_manifest_v1';
const LS_HOME_KEY = 'raritetbook_cached_home_v1';
const LS_CATS_KEY = 'raritetbook_cached_cats_v1';
const LS_SCHOOL_KEY = 'raritetbook_cached_school_v1';

let cachedManifest: CatalogManifest | null = null;
let cachedHomeFeatured: HomeFeaturedPayload | null = null;
let cachedSchool: SchoolCurriculumPayload | null = null;
let cachedCatalog: CatalogBookLite[] | null = null;
let cachedCategories: CategoryMeta[] | null = null;

let firstChunkBooks: CatalogBookLite[] = [];
let fullStreamPromise: Promise<CatalogBookLite[]> | null = null;
let firstChunkPromise: Promise<CatalogBookLite[]> | null = null;

const catalogListeners = new Set<(books: CatalogBookLite[], done: boolean) => void>();

let workerInstance: Worker | null = null;
let workerReqSeq = 0;
const pendingSearch = new Map<number, (ids: string[] | null) => void>();

function saveLsJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore quota
  }
}

function readLsJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

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

function mergeUniqueBooks(primary: CatalogBookLite[], extra: CatalogBookLite[]): CatalogBookLite[] {
  if (!extra.length) return primary;
  const seen = new Set(primary.map((b) => b.slug));
  const merged = [...primary];
  for (const item of extra) {
    if (item?.slug && !seen.has(item.slug)) {
      seen.add(item.slug);
      merged.push(item);
    }
  }
  return merged;
}

export async function loadCatalogManifest(): Promise<CatalogManifest> {
  if (cachedManifest) return cachedManifest;
  try {
    const resp = await fetchWithTimeout('/archive-meta/manifest.json', 8_000);
    if (!resp.ok) throw new Error('manifest http error');
    cachedManifest = await resp.json();
    saveLsJson(LS_MANIFEST_KEY, cachedManifest);
    return cachedManifest!;
  } catch {
    const fallback = readLsJson<CatalogManifest>(LS_MANIFEST_KEY);
    if (fallback) {
      cachedManifest = fallback;
      return fallback;
    }
    throw new Error('Манифест недоступен в офлайн-режиме');
  }
}

export async function loadHomeFeatured(): Promise<HomeFeaturedPayload> {
  if (cachedHomeFeatured) return cachedHomeFeatured;
  try {
    const resp = await fetchWithTimeout('/archive-meta/home-featured.json', 8_000);
    if (!resp.ok) throw new Error('home-featured http error');
    cachedHomeFeatured = await resp.json();
    saveLsJson(LS_HOME_KEY, cachedHomeFeatured);
    return cachedHomeFeatured!;
  } catch {
    const fallback = readLsJson<HomeFeaturedPayload>(LS_HOME_KEY);
    if (fallback) {
      cachedHomeFeatured = fallback;
      return fallback;
    }
    const offBooks = await listOfflineBooksLite();
    return {
      version: 'offline',
      totalBooks: offBooks.length || 16000,
      totalWords: 85_000_000,
      maxCapacity: 100000,
      shardsCount: 2,
      flagships: offBooks,
      ossetian: offBooks.filter((b) => b.lang === 'os'),
      science: offBooks.filter((b) => b.cat === 'science' || b.cat === 'rare-editions'),
      recent: offBooks,
    };
  }
}

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
    try {
      const manifest = await loadCatalogManifest();
      if (!manifest.chunks.length) return [];
      const chunk0 = await fetchSingleChunk(manifest.chunks[0], manifest);
      const offlineExtras = await listOfflineBooksLite();
      firstChunkBooks = mergeUniqueBooks(chunk0, offlineExtras);
      const w = getWorker();
      if (w) {
        w.postMessage({ type: 'INIT', payload: { books: firstChunkBooks } });
      }
      for (const fn of catalogListeners) {
        fn(firstChunkBooks, manifest.chunks.length === 1);
      }
      return firstChunkBooks;
    } catch {
      // Полный авиарежим без кэшированного чанка: отдаём сохранённые в IndexedDB книги + локальную витрину!
      const [offlineBooks, homeFallback] = await Promise.all([
        listOfflineBooksLite(),
        loadHomeFeatured().catch(() => null),
      ]);
      const homePool = homeFallback
        ? [
            ...(homeFallback.flagships || []),
            ...(homeFallback.ossetian || []),
            ...(homeFallback.science || []),
            ...(homeFallback.recent || []),
          ]
        : [];
      const combined = mergeUniqueBooks(offlineBooks, homePool);
      firstChunkBooks = combined;
      const w = getWorker();
      if (w && combined.length > 0) {
        w.postMessage({ type: 'INIT', payload: { books: combined } });
      }
      for (const fn of catalogListeners) {
        fn(combined, true);
      }
      firstChunkPromise = null;
      return combined;
    }
  })();

  return firstChunkPromise;
}

export async function loadCatalogLite(): Promise<CatalogBookLite[]> {
  if (cachedCatalog) return cachedCatalog;
  if (fullStreamPromise) return fullStreamPromise;

  fullStreamPromise = (async () => {
    const first = await loadFirstCatalogChunk();
    let manifest: CatalogManifest | null = null;
    try {
      manifest = await loadCatalogManifest();
    } catch {
      manifest = null;
    }

    if (!manifest || manifest.chunks.length <= 1) {
      for (const fn of catalogListeners) {
        fn(first, true);
      }
      if (navigator.onLine) {
        cachedCatalog = first;
      } else {
        fullStreamPromise = null;
      }
      return first;
    }

    let accumulated = [...first];
    let allSucceeded = true;
    const w = getWorker();

    for (let i = 1; i < manifest.chunks.length; i += 2) {
      const pair = manifest.chunks.slice(i, i + 2);
      const loadedChunks = await Promise.all(
        pair.map((cf) =>
          fetchSingleChunk(cf, manifest!).catch(() => {
            allSucceeded = false;
            return [] as CatalogBookLite[];
          })
        )
      );
      for (const chBooks of loadedChunks) {
        if (chBooks.length > 0) {
          accumulated = mergeUniqueBooks(accumulated, chBooks);
          if (w) {
            w.postMessage({ type: 'ADD_CHUNK', payload: { books: chBooks } });
          }
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

    firstChunkBooks = accumulated;
    if (allSucceeded) {
      cachedCatalog = accumulated;
    } else {
      // Если часть шардов была недоступна в авиарежиме — разрешаем догрузить их позже при появлении сети
      fullStreamPromise = null;
    }
    for (const fn of catalogListeners) {
      fn(accumulated, true);
    }
    return accumulated;
  })();

  return fullStreamPromise;
}

export async function loadCategories(): Promise<CategoryMeta[]> {
  if (cachedCategories) return cachedCategories;
  try {
    const resp = await fetchWithTimeout('/archive-meta/categories.json', 8_000);
    if (!resp.ok) throw new Error('categories http error');
    const data = await resp.json();
    cachedCategories = data;
    saveLsJson(LS_CATS_KEY, data);
    return data;
  } catch {
    const fallback = readLsJson<CategoryMeta[]>(LS_CATS_KEY);
    if (fallback) {
      cachedCategories = fallback;
      return fallback;
    }
    return [];
  }
}

export async function loadSchoolCurriculum(): Promise<SchoolCurriculumPayload> {
  if (cachedSchool) return cachedSchool;
  try {
    const resp = await fetchWithTimeout('/archive-meta/school-curriculum.json', 10_000);
    if (!resp.ok) throw new Error('school http error');
    const data: SchoolCurriculumPayload = await resp.json();
    cachedSchool = data;
    saveLsJson(LS_SCHOOL_KEY, data);
    return data;
  } catch {
    const fallback = readLsJson<SchoolCurriculumPayload>(LS_SCHOOL_KEY);
    if (fallback) {
      cachedSchool = fallback;
      return fallback;
    }
    return { version: 'offline', totalItems: 0, grades: [5, 6, 7, 8, 9, 10, 11], subjects: [], items: [] };
  }
}

export async function searchBooksInWorker(query: string): Promise<string[] | null> {
  const clean = query.trim().slice(0, 100);
  if (!clean) return null;

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

  // 1. Мгновенная проверка IndexedDB (PWA офлайн-чтение в авиарежиме и в горах)
  const offline = await getCachedBook(slug);
  if (offline) {
    return { book: offline, fromOfflineCache: true };
  }

  const entry = await findBookCatalogEntry(slug);
  if (!entry || !SAFE_SLUG_RE.test(entry.aslug) || !SAFE_SLUG_RE.test(entry.slug)) {
    throw new Error(
      navigator.onLine
        ? 'Произведение не найдено в каталоге библиотеки.'
        : 'Эта книга ещё не была открыта ранее и недоступна в авиарежиме. Откройте сохранённые книги или включите сеть.'
    );
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
        await saveBookOffline(fullBook);
        return { book: fullBook, fromOfflineCache: false };
      }
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw (
    lastErr ||
    new Error(
      navigator.onLine
        ? 'Не удалось загрузить том из архива. Проверьте подключение к сети.'
        : 'Включён авиарежим: эта книга ещё не сохранена в памяти телефона.'
    )
  );
}
