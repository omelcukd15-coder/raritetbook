import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import type { CatalogBookLite, CategoryMeta } from '../../types/library';
import { loadCatalogLite, loadCategories, searchBooksInWorker } from '../../services/catalogService';
import { getAllProgress } from '../../services/storageAndSync';
import { listOfflineBookSlugs } from '../../services/offlineDb';
import { BookCard } from '../../components/BookCard/BookCard';

const PAGE_SIZE = 24;

export const CatalogPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const initialCat = searchParams.get('cat') || 'all';
  const initialSort = searchParams.get('sort') || 'featured';

  const [books, setBooks] = useState<CatalogBookLite[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [query, setQuery] = useState(initialQ);
  const [selectedCat, setSelectedCat] = useState(initialCat);
  const [selectedLang, setSelectedLang] = useState<'all' | 'ru' | 'os'>('all');
  const [onlyOffline, setOnlyOffline] = useState(false);
  const [sortBy, setSortBy] = useState(initialSort);
  const [page, setPage] = useState(1);

  const [matchedIds, setMatchedIds] = useState<string[] | null>(null);
  const [offlineSlugs, setOfflineSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [progressMap, setProgressMap] = useState(getAllProgress);

  useEffect(() => {
    const onProg = () => setProgressMap(getAllProgress());
    window.addEventListener('raritetbook:progress-updated', onProg);
    return () => window.removeEventListener('raritetbook:progress-updated', onProg);
  }, []);

  useEffect(() => {
    document.title = 'Каталог произведений (10 000 книг) — RaritetBook.ru';
    Promise.all([loadCatalogLite(), loadCategories(), listOfflineBookSlugs()])
      .then(([b, c, off]) => {
        setBooks(b);
        setCategories(c);
        setOfflineSlugs(new Set(off));
      })
      .finally(() => setLoading(false));
  }, []);

  // Синхронизация URL-параметров при переходе из шапки или карточек категорий
  useEffect(() => {
    const urlQ = searchParams.get('q') || '';
    const urlCat = searchParams.get('cat') || 'all';
    setQuery(urlQ);
    setSelectedCat(urlCat);
    setPage(1);
  }, [searchParams]);

  // Мгновенный поиск через Web Worker (MiniSearch + ӕ/ё)
  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setMatchedIds(null);
      return;
    }
    void searchBooksInWorker(query).then((ids) => {
      if (!cancelled) {
        setMatchedIds(ids);
        setPage(1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const filteredBooks = useMemo(() => {
    let result = books;

    if (matchedIds !== null) {
      const rankOrder = new Map(matchedIds.map((id, idx) => [id, idx]));
      result = result
        .filter((b) => rankOrder.has(b.id))
        .sort((a, b) => (rankOrder.get(a.id) ?? 0) - (rankOrder.get(b.id) ?? 0));
    }

    if (selectedCat !== 'all') {
      result = result.filter((b) => b.cat === selectedCat);
    }

    if (selectedLang !== 'all') {
      result = result.filter((b) => b.lang === selectedLang);
    }

    if (onlyOffline) {
      result = result.filter((b) => offlineSlugs.has(b.slug));
    }

    if (matchedIds === null) {
      result = [...result];
      if (sortBy === 'alpha') {
        result.sort((a, b) => a.t.localeCompare(b.t, 'ru'));
      } else if (sortBy === 'author') {
        result.sort((a, b) => a.as.localeCompare(b.as, 'ru'));
      } else if (sortBy === 'words-desc') {
        result.sort((a, b) => b.w - a.w);
      } else if (sortBy === 'year-asc') {
        const y = (s: string) => parseInt(s.match(/\d{4}/)?.[0] || '9999', 10);
        result.sort((a, b) => y(a.ey) - y(b.ey));
      } else {
        result.sort((a, b) => b.rank - a.rank || a.t.localeCompare(b.t, 'ru'));
      }
    }

    return result;
  }, [books, matchedIds, selectedCat, selectedLang, onlyOffline, offlineSlugs, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const currentSlice = filteredBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const updateCategory = (catId: string) => {
    setSelectedCat(catId);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (catId === 'all') next.delete('cat');
    else next.set('cat', catId);
    setSearchParams(next, { replace: true });
  };

  const insertAe = () => {
    setQuery((q) => (q.length < 100 ? q + 'ӕ' : q));
    inputRef.current?.focus();
  };

  return (
    <div>
      <section className="rb-catalog-hero">
        <div className="rb-container">
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 3.5vw, 2.8rem)', margin: '0 0 8px' }}>
            Каталог цифровой библиотеки
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 18px', fontSize: '0.95rem' }}>
            Полные проверенные издания в общественном достоянии: найдено{' '}
            <strong style={{ color: 'var(--gold-bright)' }}>
              {filteredBooks.length.toLocaleString('ru-RU')}
            </strong>{' '}
            из {books.length.toLocaleString('ru-RU')} книг
          </p>

          {/* Поисковая строка каталога с кнопкой ӕ */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="rb-search-box" style={{ maxWidth: 520, flex: '1 1 280px' }}>
              <input
                ref={inputRef}
                type="search"
                maxLength={100}
                className="rb-search-box__input"
                style={{ padding: '11px 14px', fontSize: '0.95rem' }}
                placeholder="Название книги, автор или тема (например: Ломоносов, Кавказ, Дракула)..."
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 100))}
              />
              <button
                type="button"
                className="rb-search-box__ae"
                style={{ height: 42, minWidth: 44 }}
                onClick={insertAe}
                title="Вставить осетинский символ ӕ"
              >
                ӕ
              </button>
            </div>

            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className="rb-btn"
              style={{ background: '#171411' }}
              aria-label="Сортировка каталога"
            >
              <option value="featured">Сначала избранные памятники</option>
              <option value="alpha">По названию (А–Я)</option>
              <option value="author">По автору (А–Я)</option>
              <option value="year-asc">Сначала самые старинные</option>
              <option value="words-desc">По объёму тома</option>
            </select>

            <select
              value={selectedLang}
              onChange={(e) => {
                setSelectedLang(e.target.value as any);
                setPage(1);
              }}
              className="rb-btn"
              style={{ background: '#171411' }}
              aria-label="Фильтр языка"
            >
              <option value="all">Все языки</option>
              <option value="ru">Русский язык</option>
              <option value="os">Осетинский (ӕ)</option>
            </select>

            {offlineSlugs.size > 0 && (
              <button
                type="button"
                className={`rb-chip ${onlyOffline ? 'rb-chip--active' : ''}`}
                onClick={() => {
                  setOnlyOffline((v) => !v);
                  setPage(1);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <WifiOff size={14} /> Сохранённые офлайн ({offlineSlugs.size})
              </button>
            )}
          </div>

          {/* Фильтры рубрик */}
          <div className="rb-filters-bar">
            <button
              type="button"
              className={`rb-chip ${selectedCat === 'all' ? 'rb-chip--active' : ''}`}
              onClick={() => updateCategory('all')}
            >
              Все разделы ({books.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rb-chip ${selectedCat === c.id ? 'rb-chip--active' : ''}`}
                onClick={() => updateCategory(c.id)}
              >
                {c.title} ({c.booksCount})
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="rb-container" style={{ paddingTop: 26, paddingBottom: 36 }}>
        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            Загрузка каталога архива…
          </div>
        ) : currentSlice.length === 0 ? (
          <div className="rb-panel" style={{ textAlign: 'center', padding: '42px 20px' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>Произведения не найдены</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Попробуйте изменить поисковый запрос или сбросить выбранные фильтры.
            </p>
            <button
              type="button"
              className="rb-btn rb-btn--gold"
              onClick={() => {
                setQuery('');
                updateCategory('all');
                setSelectedLang('all');
                setOnlyOffline(false);
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <>
            <div className="rb-books-grid">
              {currentSlice.map((book) => (
                <BookCard
                  key={book.slug}
                  book={book}
                  progressPercent={progressMap[book.slug]?.percent}
                />
              ))}
            </div>

            {/* Пагинация */}
            {totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 34,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="rb-btn rb-btn--sm"
                  disabled={safePage <= 1}
                  onClick={() => {
                    setPage(Math.max(1, safePage - 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  ← Назад
                </button>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', padding: '0 8px' }}>
                  Страница <strong style={{ color: 'var(--text-main)' }}>{safePage}</strong> из {totalPages}
                </span>
                <button
                  type="button"
                  className="rb-btn rb-btn--sm"
                  disabled={safePage >= totalPages}
                  onClick={() => {
                    setPage(Math.min(totalPages, safePage + 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Далее →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
