import MiniSearch from 'minisearch';
import type { CatalogBookLite } from '../types/library';

interface CompactDoc {
  id: string;
  t: string;
  a: string;
  as: string;
}

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/æ/g, 'ӕ')
    .trim();
}

let miniSearch: MiniSearch<CompactDoc> | null = null;
const indexedIds = new Set<string>();
// Компактный буфер для мгновенного поиска коротких (1–2 символа) и осетинских (ӕ) подстрок без хранения полных объектов
const compactHaystack: { id: string; hay: string }[] = [];

function ensureIndex() {
  if (miniSearch) return;
  miniSearch = new MiniSearch<CompactDoc>({
    idField: 'id',
    fields: ['t', 'as', 'a'],
    storeFields: ['id'],
    processTerm: (term) => {
      const clean = normalizeTerm(term);
      return clean.length >= 1 ? clean : null;
    },
    searchOptions: {
      boost: { t: 4, as: 3, a: 2.2 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
}

function ingestChunk(books: CatalogBookLite[]) {
  ensureIndex();
  const batch: CompactDoc[] = [];
  for (const b of books) {
    if (!b?.id || indexedIds.has(b.id)) continue;
    indexedIds.add(b.id);
    batch.push({ id: b.id, t: b.t, a: b.a, as: b.as });
    compactHaystack.push({
      id: b.id,
      hay: normalizeTerm(`${b.t} ${b.as} ${b.a}`),
    });
  }
  if (batch.length > 0) {
    miniSearch!.addAll(batch);
  }
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload, requestId } = event.data;

  if (type === 'INIT') {
    miniSearch = null;
    indexedIds.clear();
    compactHaystack.length = 0;
    ingestChunk(payload.books || []);
    self.postMessage({ type: 'READY', total: indexedIds.size });
    return;
  }

  // Потоковое добавление чанка по 5 000 книг (масштабирование до 100 000 книг без пиков памяти на смартфоне!)
  if (type === 'ADD_CHUNK') {
    ingestChunk(payload.books || []);
    self.postMessage({ type: 'CHUNK_INDEXED', total: indexedIds.size });
    return;
  }

  if (type === 'SEARCH') {
    const rawQuery = String(payload.query || '').slice(0, 100);
    const query = normalizeTerm(rawQuery)
      .split(/\s+/)
      .slice(0, 8)
      .join(' ');
    if (!miniSearch || !query) {
      self.postMessage({ type: 'RESULTS', requestId, ids: null });
      return;
    }
    const rawHits = miniSearch.search(query);
    const idSet = new Set<string>(rawHits.map((h) => String(h.id)));
    if (query.length <= 2 || query.includes('ӕ')) {
      for (let i = 0; i < compactHaystack.length; i++) {
        if (compactHaystack[i].hay.includes(query)) {
          idSet.add(compactHaystack[i].id);
        }
      }
    }
    self.postMessage({ type: 'RESULTS', requestId, ids: Array.from(idSet) });
  }
};
