import MiniSearch from 'minisearch';
import type { CatalogBookLite } from '../types/library';

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/æ/g, 'ӕ')
    .trim();
}

let miniSearch: MiniSearch<CatalogBookLite> | null = null;
let booksById = new Map<string, CatalogBookLite>();

self.onmessage = (event: MessageEvent) => {
  const { type, payload, requestId } = event.data;

  if (type === 'INIT') {
    const books: CatalogBookLite[] = payload.books || [];
    booksById = new Map(books.map((b) => [b.id, b]));

    miniSearch = new MiniSearch<CatalogBookLite>({
      idField: 'id',
      fields: books.length > 2000 ? ['t', 'a', 'as', 'altJoined'] : ['t', 'a', 'as', 'altJoined', 'd'],
      storeFields: ['id'],
      processTerm: (term) => {
        const clean = normalizeTerm(term);
        return clean.length >= 1 ? clean : null;
      },
      searchOptions: {
        boost: { t: 4, as: 3, a: 2.5, altJoined: 2, d: 1 },
        prefix: true,
        fuzzy: 0.2,
      },
    });

    const docs = books.map((b) => ({
      ...b,
      altJoined: (b.alt || []).join(' '),
    }));
    miniSearch.addAll(docs as any);
    self.postMessage({ type: 'READY', total: books.length });
    return;
  }

  if (type === 'SEARCH') {
    const query = normalizeTerm(payload.query || '');
    if (!miniSearch || !query) {
      self.postMessage({ type: 'RESULTS', requestId, ids: null });
      return;
    }
    const rawHits = miniSearch.search(query);
    const idSet = new Set<string>(rawHits.map((h) => String(h.id)));
    if (query.length <= 2 || query.includes('ӕ')) {
      for (const b of booksById.values()) {
        const hay = normalizeTerm(`${b.t} ${b.a} ${b.as} ${(b.alt || []).join(' ')}`);
        if (hay.includes(query)) idSet.add(b.id);
      }
    }
    self.postMessage({ type: 'RESULTS', requestId, ids: Array.from(idSet) });
  }
};
