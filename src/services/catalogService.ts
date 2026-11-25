import type { CatalogBookLite, CategoryMeta, FullBookData } from '../types/library';
import { getCachedBook, saveBookOffline } from './offlineDb';

const ARCHIVE_BASE = (import.meta.env.VITE_ARCHIVE_BASE_URL || '').replace(/\/$/, '');
const GITHUB_BOOKS_CDN = 'https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books/main';
const CF_ARCHIVE_CDN = 'https://archive.raritetbook.ru';

let cachedCatalog: CatalogBookLite[] | null = null;
let cachedCategories: CategoryMeta[] | null = null;
let catalogPromise: Promise<CatalogBookLite[]> | null = null;

let workerInstance: Worker | null = null;
let workerReqSeq = 0;
const pendingSearch = new Map<number, (ids: string[] | null) => void>();

function ensureWorker(books: CatalogBookLite[]) {
  if (workerInstance || typeof Worker === 'undefined') return;
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
    workerInstance.postMessage({ type: 'INIT', payload: { books } });
  } catch {
    workerInstance = null;
  }
}

export async function loadCatalogLite(): Promise<CatalogBookLite[]> {
  if (cachedCatalog) return cachedCatalog;
  if (catalogPromise) return catalogPromise;

  catalogPromise = fetch('/archive-meta/catalog-lite.json')
    .then((r) => {
      if (!r.ok) throw new Error('Не удалось загрузить индекс каталога');
      return r.json();
    })
    .then((data) => {
      const books: CatalogBookLite[] = data.books || [];
      cachedCatalog = books;
      ensureWorker(books);
      return books;
    });

  return catalogPromise;
}

export async function loadCategories(): Promise<CategoryMeta[]> {
  if (cachedCategories) return cachedCategories;
  const resp = await fetch('/archive-meta/categories.json');
  if (!resp.ok) return [];
  const data = await resp.json();
  cachedCategories = data;
  return data;
}

export async function searchBooksInWorker(query: string): Promise<string[] | null> {
  const clean = query.trim();
  if (!clean) return null;
  const books = await loadCatalogLite();
  ensureWorker(books);

  if (!workerInstance) {
    const norm = clean.toLowerCase().replace(/ё/g, 'е').replace(/æ/g, 'ӕ');
    return books
      .filter((b) =>
        `${b.t} ${b.a} ${b.as} ${(b.alt || []).join(' ')}`
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
    workerInstance!.postMessage({ type: 'SEARCH', requestId: reqId, payload: { query: clean } });
  });
}

export function getBookArchiveUrl(authorSlug: string, slug: string, file: 'book.json' | 'original.fb2'): string {
  if (import.meta.env.DEV && !ARCHIVE_BASE) {
    return `/archive/books/${authorSlug}/${slug}/${file}`;
  }
  if (ARCHIVE_BASE) {
    return `${ARCHIVE_BASE}/archive/books/${authorSlug}/${slug}/${file}`;
  }
  return `${GITHUB_BOOKS_CDN}/books/${authorSlug}/${slug}/${file}`;
}

export async function loadFullBook(slug: string): Promise<{ book: FullBookData; fromOfflineCache: boolean }> {
  // 1. Мгновенная проверка IndexedDB (PWA офлайн-чтение)
  const offline = await getCachedBook(slug);
  if (offline) {
    return { book: offline, fromOfflineCache: true };
  }

  const catalog = await loadCatalogLite();
  const entry = catalog.find((b) => b.slug === slug);
  if (!entry) {
    throw new Error('Произведение не найдено в каталоге библиотеки.');
  }

  // Мульти-CDN без VPN в РФ: сначала GitHub Fastly CDN (или локальный dev), при сбое — резервный зеркальный архив
  const candidateUrls = import.meta.env.DEV
    ? [
        `/archive/books/${entry.aslug}/${entry.slug}/book.json`,
        `${GITHUB_BOOKS_CDN}/books/${entry.aslug}/${entry.slug}/book.json`,
      ]
    : [
        `${GITHUB_BOOKS_CDN}/books/${entry.aslug}/${entry.slug}/book.json`,
        `${CF_ARCHIVE_CDN}/archive/books/${entry.aslug}/${entry.slug}/book.json`,
      ];

  let lastErr: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url);
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
