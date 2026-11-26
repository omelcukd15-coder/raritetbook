import type { CatalogBookLite, FullBookData } from '../types/library';

const DB_NAME = 'raritetbook-offline-v2';
const STORE_BOOKS = 'books';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'slug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedBook(slug: string): Promise<FullBookData | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOKS, 'readonly');
      const req = tx.objectStore(STORE_BOOKS).get(slug);
      req.onsuccess = () => resolve(req.result ? (req.result.data as FullBookData) : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveBookOffline(book: FullBookData): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_BOOKS, 'readwrite');
      tx.objectStore(STORE_BOOKS).put({
        slug: book.slug,
        title: book.title,
        authorShort: book.authorShort,
        savedAt: Date.now(),
        data: book,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Игнорируем переполнение квоты на старых устройствах
  }
}

export async function listOfflineBookSlugs(): Promise<string[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOKS, 'readonly');
      const req = tx.objectStore(STORE_BOOKS).getAllKeys();
      req.onsuccess = () => resolve((req.result || []).map(String));
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Возвращает карточки всех сохранённых в телефоне книг из IndexedDB,
 * чтобы каталог и главная идеально работали в авиарежиме даже без загруженных сетевых шардов!
 */
export async function listOfflineBooksLite(): Promise<CatalogBookLite[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_BOOKS, 'readonly');
      const req = tx.objectStore(STORE_BOOKS).getAll();
      req.onsuccess = () => {
        const records: any[] = req.result || [];
        const out: CatalogBookLite[] = [];
        for (const rec of records) {
          const b: FullBookData | undefined = rec?.data;
          if (!b?.slug) continue;
          out.push({
            id: b.slug,
            slug: b.slug,
            t: b.title,
            alt: b.altTitles || [],
            a: b.author,
            as: b.authorShort,
            aslug: b.authorSlug,
            ay: b.authorYears || '',
            tr: b.translator || null,
            lang: b.language || 'ru',
            cat: b.category,
            wy: b.writtenYear || '',
            ey: b.editionYear || '',
            d: (b.description || '').slice(0, 65),
            ch: b.stats?.chaptersCount || b.chapters?.length || 1,
            w: b.stats?.wordsCount || 0,
            rm: b.stats?.readingMinutes || 5,
            rank: 50,
            sh: b.shard || 0,
          });
        }
        resolve(out);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
