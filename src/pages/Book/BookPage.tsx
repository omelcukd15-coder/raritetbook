import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckCircle2, Download, ExternalLink, Scale } from 'lucide-react';
import type { CatalogBookLite, FullBookData } from '../../types/library';
import { getBookArchiveUrl, loadFirstCatalogChunk, loadFullBook } from '../../services/catalogService';
import { getBookProgress } from '../../services/storageAndSync';
import { BookCover } from '../../components/BookCover/BookCover';
import { BookCard } from '../../components/BookCard/BookCard';

const CATEGORY_LABELS: Record<string, string> = {
  history: 'История России',
  'russian-classics': 'Русская классика',
  caucasus: 'Кавказ и народы России',
  'foreign-classics': 'Зарубежная классика',
  science: 'Наука и философия',
  'rare-editions': 'Редкие издания и учебники',
};

export const BookPage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const [book, setBook] = useState<FullBookData | null>(null);
  const [related, setRelated] = useState<CatalogBookLite[]>([]);
  const [offlineReady, setOfflineReady] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const progress = getBookProgress(slug);

  useEffect(() => {
    setLoading(true);
    setError('');
    window.scrollTo(0, 0);

    loadFullBook(slug)
      .then(({ book: full, fromOfflineCache }) => {
        setBook(full);
        setOfflineReady(true || fromOfflineCache);
        setLoading(false);
        document.title = `${full.title} — ${full.authorShort} | Читать бесплатно на RaritetBook.ru`;

        void loadFirstCatalogChunk().then((chunk) => {
          const sameAuthorOrCat = chunk
            .filter((b) => b.slug !== slug && (b.aslug === full.authorSlug || b.cat === full.category))
            .slice(0, 6);
          setRelated(sameAuthorOrCat);
        });
      })
      .catch((err: any) => {
        setError(err?.message || 'Ошибка загрузки книги');
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <main className="rb-container" style={{ padding: '64px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Открываем архивную карточку произведения…
      </main>
    );
  }

  if (error || !book) {
    return (
      <main className="rb-container" style={{ padding: '48px 20px' }}>
        <div className="rb-panel" style={{ textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-heading)' }}>Книга не найдена</h1>
          <p style={{ color: 'var(--text-muted)' }}>{error}</p>
          <Link to="/catalog" className="rb-btn rb-btn--gold">Вернуться в каталог</Link>
        </div>
      </main>
    );
  }

  const fb2DownloadHref = getBookArchiveUrl(book.authorSlug, book.slug, 'original.fb2', book.shard || 0);

  const handleDownloadFb2 = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const esc = (s: string) =>
      String(s || '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const parts = book.author.split(/\s+/).filter(Boolean);
    const fn = parts[0] || book.author;
    const ln = parts.length > 1 ? parts[parts.length - 1] : '';
    const mn = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    const sections = book.chapters
      .map((ch) => {
        const body = ch.content
          .map((b) => {
            if (b.type === 'poem' && b.stanzas) {
              return `<poem>${b.stanzas
                .map((st) => `<stanza>${st.map((v) => `<v>${esc(v)}</v>`).join('')}</stanza>`)
                .join('')}</poem>`;
            }
            if (b.type === 'epigraph') return `<epigraph><p>${esc(b.text)}</p></epigraph>`;
            if (b.type === 'subtitle') return `<subtitle>${esc(b.text)}</subtitle>`;
            return `<p>${esc(b.text)}</p>`;
          })
          .join('\n');
        return `<section id="${esc(ch.id)}"><title><p>${esc(ch.title)}</p></title>\n${body}\n</section>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <genre>antique</genre>
      <author><first-name>${esc(fn)}</first-name><middle-name>${esc(mn)}</middle-name><last-name>${esc(ln)}</last-name></author>
      <book-title>${esc(book.title)}</book-title>
      <annotation><p>${esc(book.description)}</p><p>${esc(book.legalStatus)}</p></annotation>
      <date>${esc(book.writtenYear)}</date>
      <lang>${esc(book.language)}</lang>
    </title-info>
    <publish-info>
      <book-name>${esc(book.title)}</book-name>
      <publisher>RaritetBook.ru</publisher>
      <year>${esc(book.editionYear)}</year>
    </publish-info>
  </description>
  <body>
${sections}
  </body>
</FictionBook>`;
    const blob = new Blob([xml], { type: 'application/x-fictionbook+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${book.slug}.fb2`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const schemaOrgJson = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: { '@type': 'Person', name: book.author },
    inLanguage: book.language,
    datePublished: book.editionYear,
    description: book.description,
    publisher: { '@type': 'Organization', name: 'RaritetBook.ru' },
    isAccessibleForFree: true,
  };

  const safeJsonLd = JSON.stringify(schemaOrgJson).replace(/</g, '\\u003c');
  const isSafeSourceUrl = Boolean(book.sourceUrl && /^https?:\/\//i.test(book.sourceUrl));

  return (
    <main className="rb-container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd }}
      />

      <div style={{ paddingTop: 18 }}>
        <Link to="/catalog" className="rb-nav__link" style={{ fontSize: '0.86rem' }}>
          <ArrowLeft size={15} /> Назад в каталог
        </Link>
      </div>

      <article className="rb-book-detail">
        <div className="rb-book-detail__cover-col">
          <BookCover
            title={book.title}
            authorShort={book.authorShort}
            year={book.editionYear}
            category={book.category}
            slug={book.slug}
            size="lg"
          />
          {offlineReady && (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: '0.78rem',
                color: 'var(--gold-bright)',
              }}
            >
              <CheckCircle2 size={14} /> Сохранено для чтения без интернета
            </div>
          )}
        </div>

        <div>
          <Link
            to={`/catalog?cat=${book.category}`}
            style={{ color: 'var(--gold-bright)', fontSize: '0.84rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            {CATEGORY_LABELS[book.category] || book.category}
          </Link>

          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 3.8vw, 3rem)',
              lineHeight: 1.1,
              margin: '6px 0 10px',
            }}
          >
            {book.title}
          </h1>

          <div style={{ fontSize: '1.08rem', color: 'var(--text-muted)' }}>
            Автор: <strong style={{ color: 'var(--text-main)' }}>{book.author}</strong>{' '}
            {book.authorYears && <span>({book.authorYears})</span>}
          </div>

          {book.translator && (
            <div style={{ fontSize: '0.92rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Перевод: {book.translator}
            </div>
          )}

          <div className="rb-meta-badges">
            {book.writtenYear && <span className="rb-badge">Создание: {book.writtenYear}</span>}
            {book.editionYear && <span className="rb-badge">Издание: {book.editionYear}</span>}
            <span className="rb-badge">Язык: {book.language === 'os' ? 'Осетинский (ӕ)' : 'Русский'}</span>
            <span className="rb-badge">Глав: {book.stats.chaptersCount}</span>
            <span className="rb-badge">{book.stats.wordsCount.toLocaleString('ru-RU')} слов (~{book.stats.readingMinutes} мин)</span>
          </div>

          {/* Кнопки чтения и скачивания */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '22px 0 26px' }}>
            <Link to={`/read/${book.slug}`} className="rb-btn rb-btn--gold" style={{ minWidth: 210 }}>
              <BookOpen size={18} />
              {progress && progress.percent > 0
                ? `Продолжить чтение (${progress.percent}%)`
                : 'Читать онлайн бесплатно'}
            </Link>

            {book.downloadAllowed && (
              <a href={fb2DownloadHref} onClick={handleDownloadFb2} download={`${book.slug}.fb2`} className="rb-btn">
                <Download size={17} /> Скачать FB2
              </a>
            )}
          </div>

          <div className="rb-panel" style={{ marginBottom: 18 }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', margin: '0 0 8px' }}>
              Описание произведения
            </h2>
            <p style={{ margin: 0, color: '#ddd0bd', lineHeight: 1.65 }}>{book.description}</p>
          </div>

          <div className="rb-panel" style={{ marginBottom: 18 }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', margin: '0 0 8px' }}>
              Историческая и библиографическая справка
            </h2>
            <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {book.historicalNote}
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 14,
                alignItems: 'center',
                paddingTop: 12,
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Scale size={15} color="var(--gold)" /> {book.legalStatus}
              </span>
              {isSafeSourceUrl && (
                <a
                  href={book.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--gold-bright)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  Источник архива <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>

          {/* Оглавление тома */}
          {book.toc.length > 1 && (
            <div className="rb-panel">
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', margin: '0 0 12px' }}>
                Оглавление ({book.toc.length})
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap: 8,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {book.toc.map((ch, idx) => (
                  <Link
                    key={ch.id}
                    to={`/read/${book.slug}?ch=${idx}`}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: 'rgba(20, 17, 14, 0.55)',
                      border: '1px solid rgba(185, 149, 91, 0.14)',
                      fontSize: '0.84rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {ch.title}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="rb-shelf">
          <div className="rb-shelf__head">
            <h2 className="rb-shelf__title">Похожие издания из фонда</h2>
            <Link to={`/catalog?cat=${book.category}`} className="rb-shelf__more">Все в разделе →</Link>
          </div>
          <div className="rb-books-grid">
            {related.map((b) => (
              <BookCard key={b.slug} book={b} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
};
