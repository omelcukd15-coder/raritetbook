import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  List,
  Quote,
  Settings,
  X,
} from 'lucide-react';
import type { FullBookData, ReaderSettings } from '../../types/library';
import { loadFullBook } from '../../services/catalogService';
import {
  getBookProgress,
  getReaderSettings,
  saveBookProgress,
  saveReaderSettings,
} from '../../services/storageAndSync';
import { QuoteCardModal } from '../../components/QuoteCardModal/QuoteCardModal';

export const ReaderPage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  const [book, setBook] = useState<FullBookData | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings);
  const [bookmark, setBookmark] = useState<{
    chapterIndex: number;
    scrollRatio: number;
    excerpt: string;
    createdAt: number;
  } | null>(null);

  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [error, setError] = useState('');

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoringScrollRef = useRef(false);

  // Загрузка книги + восстановление позиции чтения
  useEffect(() => {
    loadFullBook(slug)
      .then(({ book: full }) => {
        setBook(full);
        document.title = `${full.title} — Чтение | RaritetBook.ru`;

        const saved = getBookProgress(slug);
        if (saved?.bookmark) {
          setBookmark(saved.bookmark);
        }

        const urlCh = searchParams.get('ch');
        if (urlCh !== null) {
          const parsed = Math.max(0, Math.min(full.chapters.length - 1, parseInt(urlCh, 10) || 0));
          setChapterIdx(parsed);
          window.scrollTo(0, 0);
        } else if (saved) {
          const validCh = Math.max(0, Math.min(full.chapters.length - 1, saved.chapterIndex));
          setChapterIdx(validCh);
          restoringScrollRef.current = true;
          setTimeout(() => {
            const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo({ top: saved.scrollRatio * maxScroll, behavior: 'auto' });
            restoringScrollRef.current = false;
          }, 80);
        } else {
          window.scrollTo(0, 0);
        }
      })
      .catch((err: any) => setError(err?.message || 'Ошибка открытия книги'));
  }, [slug, searchParams]);

  // Начисление и дебаунс сохранения прогресса (без спама при каждом пикселе скролла!)
  const persistPosition = useCallback(
    (chIndex: number, ratio: number, customBookmark = bookmark) => {
      if (!book) return;
      const totalCh = Math.max(1, book.chapters.length);
      const overall = Math.min(100, Math.max(1, Math.round(((chIndex + ratio) / totalCh) * 100)));
      saveBookProgress({
        slug: book.slug,
        chapterIndex: chIndex,
        scrollRatio: Number(ratio.toFixed(3)),
        percent: overall,
        bookmark: customBookmark,
        updatedAt: Date.now(),
      });
    },
    [book, bookmark]
  );

  useEffect(() => {
    const onScroll = () => {
      if (restoringScrollRef.current || !book) return;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      setScrollRatio(ratio);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        persistPosition(chapterIdx, ratio);
      }, 650);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [book, chapterIdx, persistPosition]);

  // Отслеживание выделенного читателем текста для создания открытки-цитаты в 1 клик
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection()?.toString().trim() || '';
      if (sel.length >= 12 && sel.length <= 600) {
        setSelectedQuote(sel);
      } else if (sel.length === 0) {
        setSelectedQuote('');
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const updateSettings = (patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveReaderSettings(next);
      return next;
    });
  };

  const goToChapter = (idx: number) => {
    if (!book) return;
    const clamped = Math.max(0, Math.min(book.chapters.length - 1, idx));
    setChapterIdx(clamped);
    setScrollRatio(0);
    setTocOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    persistPosition(clamped, 0);
  };

  const toggleBookmark = () => {
    if (!book) return;
    const isSameChapter = bookmark && bookmark.chapterIndex === chapterIdx;
    if (isSameChapter) {
      setBookmark(null);
      persistPosition(chapterIdx, scrollRatio, null);
    } else {
      const ch = book.chapters[chapterIdx];
      const sampleText = ch?.content?.[0]?.text?.slice(0, 90) || ch?.title || '';
      const nextBm = {
        chapterIndex: chapterIdx,
        scrollRatio,
        excerpt: `${ch.title}: ${sampleText}…`,
        createdAt: Date.now(),
      };
      setBookmark(nextBm);
      persistPosition(chapterIdx, scrollRatio, nextBm);
    }
  };

  const openQuoteGenerator = () => {
    if (selectedQuote) {
      setQuoteModalOpen(true);
      return;
    }
    const ch = book?.chapters[chapterIdx];
    const fallback =
      ch?.content.find((b) => b.text.length > 45)?.text.slice(0, 280) ||
      book?.description ||
      'Старинные книги. Вечные знания.';
    setSelectedQuote(fallback);
    setQuoteModalOpen(true);
  };

  if (error) {
    return (
      <div className="rb-container" style={{ padding: '48px 20px', textAlign: 'center' }}>
        <h2>Не удалось открыть произведение</h2>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        <Link to="/catalog" className="rb-btn rb-btn--gold">В каталог</Link>
      </div>
    );
  }

  if (!book) {
    return (
      <div
        className={`rb-reader-shell rb-reader-shell--${settings.theme}`}
        style={{ alignItems: 'center', justifyContent: 'center', padding: 32 }}
      >
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem' }}>
          Раскрываем том…
        </div>
      </div>
    );
  }

  const chapter = book.chapters[chapterIdx] || book.chapters[0];
  const overallPercent = Math.min(
    100,
    Math.max(1, Math.round(((chapterIdx + scrollRatio) / Math.max(1, book.chapters.length)) * 100))
  );
  const hasBookmarkHere = bookmark?.chapterIndex === chapterIdx;

  return (
    <div className={`rb-reader-shell rb-reader-shell--${settings.theme}`}>
      {/* Верхняя панель читалки */}
      <header className="rb-reader-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <Link
            to={`/book/${book.slug}`}
            className="rb-btn rb-btn--sm"
            style={{ padding: '6px 10px', flexShrink: 0 }}
            title="К карточке книги"
          >
            <ArrowLeft size={17} />
          </Link>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.08rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {book.title}
            </div>
            <div
              style={{
                fontSize: '0.73rem',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {book.authorShort} • {overallPercent}%
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            className="rb-btn rb-btn--sm"
            onClick={() => setTocOpen(true)}
            title="Оглавление"
          >
            <List size={17} />
            <span className="rb-hide-xs">Главы</span>
          </button>

          <button
            type="button"
            className="rb-btn rb-btn--sm"
            onClick={toggleBookmark}
            title="Закладка на книгу"
            style={{ borderColor: hasBookmarkHere ? 'var(--gold-bright)' : undefined }}
          >
            {hasBookmarkHere ? <BookmarkCheck size={17} color="var(--gold-bright)" /> : <Bookmark size={17} />}
          </button>

          <button
            type="button"
            className="rb-btn rb-btn--sm"
            onClick={openQuoteGenerator}
            title="Создать открытку с цитатой"
          >
            <Quote size={16} />
          </button>

          <button
            type="button"
            className="rb-btn rb-btn--sm"
            onClick={() => setSettingsOpen(true)}
            title="Настройки шрифта и темы"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* Тонкая золотая полоса общего прогресса */}
      <div style={{ position: 'sticky', top: 57, zIndex: 79, height: 3, background: 'rgba(0,0,0,0.2)' }}>
        <div
          style={{
            height: '100%',
            width: `${overallPercent}%`,
            background: 'linear-gradient(90deg, #b9955b, #dfc089)',
            transition: 'width 0.15s ease',
          }}
        />
      </div>

      {/* Плавающая кнопка создания цитаты при выделении текста */}
      {selectedQuote && !quoteModalOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 76,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 95,
          }}
        >
          <button
            type="button"
            className="rb-btn rb-btn--gold"
            onClick={() => setQuoteModalOpen(true)}
          >
            <Quote size={16} /> Создать открытку с цитатой
          </button>
        </div>
      )}

      {/* Основная текстовая колонка */}
      <article
        className={`rb-reader-content rb-reader-content--${settings.columnWidth}`}
        style={{
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
          fontFamily:
            settings.fontFamily === 'serif' ? 'var(--font-reader-serif)' : 'var(--font-ui)',
        }}
      >
        <h1 className="rb-reader-chapter-title">{chapter.title}</h1>

        {chapter.content.map((blk, i) => {
          if (blk.type === 'epigraph') {
            return (
              <blockquote key={i} className="rb-reader-epigraph">
                {blk.text}
              </blockquote>
            );
          }
          if (blk.type === 'subtitle') {
            return (
              <h2
                key={i}
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '1.35em',
                  textAlign: 'center',
                  margin: '1.3em 0 0.7em',
                }}
              >
                {blk.text}
              </h2>
            );
          }
          if (blk.type === 'poem') {
            const stanzas = blk.stanzas || [blk.text.split('\n')];
            return (
              <div key={i} className="rb-reader-poem">
                {stanzas.map((st, si) => (
                  <div key={si} className="rb-reader-stanza">
                    {st.map((v, vi) => (
                      <div key={vi} className="rb-reader-verse">
                        {v}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          }
          if (blk.html) {
            return (
              <p
                key={i}
                className="rb-reader-p"
                dangerouslySetInnerHTML={{ __html: blk.html }}
              />
            );
          }
          return (
            <p key={i} className="rb-reader-p">
              {blk.text}
            </p>
          );
        })}

        {/* Нижняя навигация между главами */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginTop: 44,
            paddingTop: 22,
            borderTop: '1px solid rgba(130, 100, 60, 0.35)',
          }}
        >
          <button
            type="button"
            className="rb-btn"
            disabled={chapterIdx <= 0}
            onClick={() => goToChapter(chapterIdx - 1)}
          >
            <ArrowLeft size={16} /> Предыдущая
          </button>

          <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
            Глава {chapterIdx + 1} из {book.chapters.length}
          </span>

          <button
            type="button"
            className="rb-btn rb-btn--gold"
            disabled={chapterIdx >= book.chapters.length - 1}
            onClick={() => goToChapter(chapterIdx + 1)}
          >
            Следующая <ArrowRight size={16} />
          </button>
        </div>
      </article>

      {/* ПАНЕЛЬ ОГЛАВЛЕНИЯ И ЗАКЛАДКИ */}
      {tocOpen && (
        <div className="rb-drawer-backdrop rb-drawer-backdrop--bottom" onClick={() => setTocOpen(false)}>
          <div className="rb-drawer rb-drawer--bottom" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.35rem' }}>
                Содержание ({book.chapters.length})
              </strong>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {bookmark && (
              <div style={{ padding: '12px 18px', background: 'rgba(185, 149, 91, 0.12)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.76rem', color: 'var(--gold-bright)', marginBottom: 4 }}>
                  Активная закладка:
                </div>
                <button
                  type="button"
                  className="rb-btn rb-btn--sm"
                  style={{ width: '100%', justifyContent: 'flex-start', overflow: 'hidden' }}
                  onClick={() => {
                    goToChapter(bookmark.chapterIndex);
                    setTimeout(() => {
                      const maxS = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
                      window.scrollTo({ top: bookmark.scrollRatio * maxS, behavior: 'smooth' });
                    }, 120);
                  }}
                >
                  <BookmarkCheck size={15} color="var(--gold-bright)" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bookmark.excerpt}</span>
                </button>
              </div>
            )}

            <div style={{ overflowY: 'auto', padding: '8px 0', flex: 1 }}>
              {book.toc.map((t, idx) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => goToChapter(idx)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 18px',
                    border: 'none',
                    borderLeft: idx === chapterIdx ? '3px solid var(--gold)' : '3px solid transparent',
                    background: idx === chapterIdx ? 'rgba(185, 149, 91, 0.16)' : 'transparent',
                    color: idx === chapterIdx ? 'var(--gold-bright)' : 'var(--text-main)',
                    fontSize: '0.92rem',
                  }}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ПАНЕЛЬ НАСТРОЕК ЧИТАЛКИ (на смартфоне открывается снизу как удобный bottom-sheet!) */}
      {settingsOpen && (
        <div className="rb-drawer-backdrop rb-drawer-backdrop--bottom" onClick={() => setSettingsOpen(false)}>
          <div className="rb-drawer rb-drawer--bottom" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.35rem' }}>
                Настройки чтения
              </strong>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
              {/* Темы */}
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>Цветовая тема</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(
                    [
                      ['parchment', 'Старинная бумага', '#E5D2B2', '#241A11'],
                      ['day', 'День', '#FAF7F2', '#1F1C18'],
                      ['night', 'Ночь', '#141210', '#E4D8C6'],
                    ] as const
                  ).map(([id, label, bg, fg]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateSettings({ theme: id })}
                      style={{
                        padding: '11px 8px',
                        borderRadius: 8,
                        background: bg,
                        color: fg,
                        border:
                          settings.theme === id ? '2px solid var(--gold-bright)' : '1px solid var(--border)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Размер шрифта 14..24 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  <span>Размер шрифта</span>
                  <strong style={{ color: 'var(--gold-bright)' }}>{settings.fontSize} px</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="rb-btn rb-btn--sm"
                    onClick={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}
                  >
                    А−
                  </button>
                  <input
                    type="range"
                    min={14}
                    max={24}
                    value={settings.fontSize}
                    onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: '#b9955b' }}
                  />
                  <button
                    type="button"
                    className="rb-btn rb-btn--sm"
                    onClick={() => updateSettings({ fontSize: Math.min(24, settings.fontSize + 1) })}
                  >
                    А+
                  </button>
                </div>
              </div>

              {/* Гарнитура */}
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>Гарнитура</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className={`rb-chip ${settings.fontFamily === 'serif' ? 'rb-chip--active' : ''}`}
                    onClick={() => updateSettings({ fontFamily: 'serif' })}
                  >
                    С засечками (Georgia)
                  </button>
                  <button
                    type="button"
                    className={`rb-chip ${settings.fontFamily === 'sans' ? 'rb-chip--active' : ''}`}
                    onClick={() => updateSettings({ fontFamily: 'sans' })}
                  >
                    Без засечек (Inter)
                  </button>
                </div>
              </div>

              {/* Межстрочный интервал */}
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>Межстрочный интервал</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(
                    [
                      [1.48, 'Плотный'],
                      [1.72, 'Комфортный'],
                      [1.95, 'Свободный'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`rb-chip ${Math.abs(settings.lineHeight - val) < 0.05 ? 'rb-chip--active' : ''}`}
                      onClick={() => updateSettings({ lineHeight: val })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ширина колонки */}
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>Ширина полосы набора</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(
                    [
                      ['narrow', 'Узкая'],
                      ['medium', 'Книжная'],
                      ['wide', 'Широкая'],
                    ] as const
                  ).map(([w, label]) => (
                    <button
                      key={w}
                      type="button"
                      className={`rb-chip ${settings.columnWidth === w ? 'rb-chip--active' : ''}`}
                      onClick={() => updateSettings({ columnWidth: w })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {quoteModalOpen && (
        <QuoteCardModal
          quote={selectedQuote}
          bookTitle={book.title}
          authorShort={book.authorShort}
          slug={book.slug}
          onClose={() => setQuoteModalOpen(false)}
        />
      )}
    </div>
  );
};
