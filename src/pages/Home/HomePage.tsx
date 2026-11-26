import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Cloud,
  Moon,
  Palette,
  Settings,
  Type,
  Zap,
} from 'lucide-react';
import type { BookChapter, CatalogBookLite, CategoryMeta, HomeFeaturedPayload, UserSession } from '../../types/library';
import { loadCatalogLite, loadCategories, loadHomeFeatured } from '../../services/catalogService';
import { getAllProgress, registerAccount } from '../../services/storageAndSync';
import { BookCard } from '../../components/BookCard/BookCard';

interface HeroPreviewData {
  slug: string;
  title: string;
  authorShort: string;
  toc: { id: string; title: string }[];
  chapters: BookChapter[];
}

interface HomePageProps {
  user: UserSession | null;
}

export const HomePage: React.FC<HomePageProps> = ({ user }) => {
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [featured, setFeatured] = useState<HomeFeaturedPayload | null>(null);
  const [extraBooks, setExtraBooks] = useState<CatalogBookLite[]>([]);
  const [preview, setPreview] = useState<HeroPreviewData | null>(null);
  const [previewChIdx, setPreviewChIdx] = useState(0); // Глава 1 поэмы «Мцыри»
  const [heroScene, setHeroScene] = useState<'caucasus' | 'library'>('caucasus');
  const [progressMap, setProgressMap] = useState(getAllProgress());

  // Форма быстрой регистрации из нижней карточки референса
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regMsg, setRegMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'RaritetBook.ru — Старинные книги. Вечные знания | Открытая цифровая библиотека';
    void loadCategories().then(setCategories);
    void loadHomeFeatured().then(setFeatured);
    // Полный шардированный каталог догружаем только если у читателя есть начатые книги для полки «Продолжить чтение»
    if (Object.keys(getAllProgress()).length > 0) {
      void loadCatalogLite().then(setExtraBooks);
    }
    fetch('/archive-meta/hero-preview.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setPreview(d);
          setPreviewChIdx(0);
        }
      })
      .catch(() => null);

    const onProg = () => {
      const nextProg = getAllProgress();
      setProgressMap(nextProg);
      if (Object.keys(nextProg).length > 0) {
        void loadCatalogLite().then(setExtraBooks);
      }
    };
    window.addEventListener('raritetbook:progress-updated', onProg);
    return () => window.removeEventListener('raritetbook:progress-updated', onProg);
  }, []);

  const knownPool = extraBooks.length > 0
    ? extraBooks
    : [...(featured?.flagships || []), ...(featured?.science || []), ...(featured?.recent || [])];

  const continueBooks = Object.values(progressMap)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => {
      const b = knownPool.find((x) => x.slug === p.slug);
      return b ? { book: b, percent: p.percent } : null;
    })
    .filter(Boolean) as { book: CatalogBookLite; percent: number }[];

  const flagshipBooks = (featured?.flagships || []).slice(0, 12);
  const ossetianShowcase = (featured?.ossetian || []).slice(0, 6);
  const ossetianTotal = featured?.ossetianBooks || 1050;
  const scienceAndTextbooks = (featured?.science || []).slice(0, 6);
  const recentAdditions = (featured?.recent || []).slice(0, 6);
  const totalBooksCount = featured?.totalBooks || categories.reduce((s, c) => s + c.booksCount, 0) || 15000;

  const activeChapter = preview?.chapters?.[previewChIdx];

  const handleQuickRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegMsg(null);
    try {
      await registerAccount(regEmail, regPass);
      setRegEmail('');
      setRegPass('');
      setRegMsg({ text: 'Аккаунт создан! Облачная синхронизация активна.', ok: true });
    } catch (err: any) {
      setRegMsg({ text: err?.message || 'Ошибка регистрации', ok: false });
    }
  };

  return (
    <main className="rb-container">
      {/* ВЕРХНИЙ SHOWCASE: HERO СЛЕВА + ИНТЕРАКТИВНАЯ ЧИТАЛКА «МЦЫРИ» СПРАВА */}
      <section className="rb-showcase-top">
        <div
          className="rb-hero-banner"
          style={{
            backgroundImage: `url('/assets/images/${
              heroScene === 'caucasus' ? 'caucasus-hero.webp' : 'library-hero.webp'
            }')`,
          }}
        >
          <div className="rb-hero-banner__content">
            <h1 className="rb-hero-banner__title">
              Старинные книги.
              <br />
              Вечные знания.
            </h1>
            <p className="rb-hero-banner__sub">
              Открытая цифровая библиотека классики, истории, науки и редких изданий России и мира. Бесплатно, без рекламы и регистрации.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Link to="/catalog" className="rb-btn rb-btn--gold">
                <BookOpen size={18} /> Перейти к каталогу →
              </Link>
              <Link to="/catalog?lang=os" className="rb-btn rb-btn--sm" style={{ borderColor: 'var(--gold)' }}>
                ӕ Ирон чингуытӕ ({ossetianTotal.toLocaleString('ru-RU')})
              </Link>
              <button
                type="button"
                className="rb-btn rb-btn--sm"
                onClick={() => setHeroScene((s) => (s === 'caucasus' ? 'library' : 'caucasus'))}
                title="Переключить атмосферу фона"
              >
                {heroScene === 'caucasus' ? 'Зал библиотеки' : 'Крепость Кавказа'}
              </button>
            </div>
          </div>

          <div className="rb-hero-banner__quote">
            «Книга — это дверь в прошлое, настоящее и будущее.»
          </div>
        </div>

        {/* Мини-читалка с живым текстом «Мцыри» на старинной бумаге */}
        <aside className="rb-mini-reader" aria-label="Предпросмотр онлайн-читалки">
          <div className="rb-mini-reader__top">
            <button
              type="button"
              onClick={() => navigate('/book/lermontov-mtsyri')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: 2 }}
              title="Карточка произведения"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="rb-mini-reader__book-title">
              {preview ? `${preview.title} — ${preview.authorShort}` : 'Мцыри — М. Ю. Лермонтов'}
            </span>
            <div style={{ display: 'flex', gap: 10, color: 'var(--text-muted)' }}>
              <Link to="/read/lermontov-mtsyri" title="Открыть полную читалку">
                <Bookmark size={15} />
              </Link>
              <Link to="/read/lermontov-mtsyri" title="Темы читалки">
                <Moon size={15} />
              </Link>
              <Link to="/read/lermontov-mtsyri" title="Настройки шрифта">
                <Settings size={15} />
              </Link>
            </div>
          </div>

          <div className="rb-mini-reader__body">
            <div className="rb-mini-reader__toc">
              <div className="rb-mini-reader__toc-head">Оглавление</div>
              {(preview?.chapters || []).map((ch, idx) => (
                <button
                  key={ch.id}
                  type="button"
                  className={`rb-mini-reader__toc-btn ${
                    idx === previewChIdx ? 'rb-mini-reader__toc-btn--active' : ''
                  }`}
                  onClick={() => setPreviewChIdx(idx)}
                >
                  {ch.title.length > 14 ? `Глава ${idx || 'I'}` : ch.title}
                </button>
              ))}
            </div>

            <div className="rb-mini-reader__page">
              <h2 className="rb-mini-reader__ch-heading">
                {activeChapter?.title || 'Глава I'}
              </h2>
              {activeChapter ? (
                activeChapter.content.slice(0, 3).map((blk, i) => (
                  <div key={i} style={{ marginBottom: 10, whiteSpace: 'pre-line' }}>
                    {blk.text.slice(0, 520)}
                  </div>
                ))
              ) : (
                <p>Загрузка архивного свитка…</p>
              )}
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <Link
                  to="/read/lermontov-mtsyri"
                  style={{
                    color: '#5c3d18',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    textDecoration: 'underline',
                  }}
                >
                  Открыть во весь экран →
                </Link>
              </div>
            </div>
          </div>

          <div className="rb-mini-reader__foot">
            <span>{Math.round(((previewChIdx + 1) / Math.max(1, preview?.chapters.length || 8)) * 100)}%</span>
            <div className="rb-progress-track">
              <div
                className="rb-progress-fill"
                style={{
                  width: `${Math.round(((previewChIdx + 1) / Math.max(1, preview?.chapters.length || 8)) * 100)}%`,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
                onClick={() => setPreviewChIdx((i) => Math.max(0, i - 1))}
                aria-label="Предыдущая глава"
              >
                <ArrowLeft size={15} />
              </button>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
                onClick={() =>
                  setPreviewChIdx((i) => Math.min((preview?.chapters.length || 1) - 1, i + 1))
                }
                aria-label="Следующая глава"
              >
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </aside>
      </section>

      {/* ШЕСТЬ ИЛЛЮСТРИРОВАННЫХ КАТЕГОРИЙ С РЕАЛЬНЫМ ЧИСЛОМ КНИГ */}
      <section aria-labelledby="categories-heading">
        <div className="rb-section-divider">
          <h2 id="categories-heading" className="rb-section-divider__title">
            Категории
          </h2>
        </div>

        <div className="rb-categories-grid">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/catalog?cat=${encodeURIComponent(cat.id)}`}
              className="rb-cat-card"
            >
              <div className="rb-cat-card__img-wrap">
                <img
                  src={cat.image}
                  alt={cat.title}
                  className="rb-cat-card__img"
                  loading="lazy"
                />
              </div>
              <div className="rb-cat-card__body">
                <h3 className="rb-cat-card__title">{cat.title}</h3>
                <span className="rb-cat-card__count">
                  {cat.booksCount.toLocaleString('ru-RU')} книг ›
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ПОЛКА 1: ПРОДОЛЖИТЬ ЧТЕНИЕ (появляется, если читатель уже открывал книги) */}
      {continueBooks.length > 0 && (
        <section className="rb-shelf">
          <div className="rb-shelf__head">
            <h2 className="rb-shelf__title">Продолжить чтение</h2>
            <Link to="/catalog" className="rb-shelf__more">Все книги →</Link>
          </div>
          <div className="rb-books-grid">
            {continueBooks.slice(0, 6).map(({ book, percent }) => (
              <BookCard key={book.slug} book={book} progressPercent={percent} />
            ))}
          </div>
        </section>
      )}

      {/* СПЕЦИАЛЬНАЯ ПОЛКА: ИРОН ЛИТЕРАТУРӔ — КНИГИ НА ОСЕТИНСКОМ ЯЗЫКЕ (Ӕ) */}
      {ossetianShowcase.length > 0 && (
        <section className="rb-shelf">
          <div className="rb-shelf__head">
            <h2 className="rb-shelf__title">Ирон чингуытӕ — На осетинском языке (ӕ)</h2>
            <Link to="/catalog?lang=os" className="rb-shelf__more">
              Весь осетинский фонд ({ossetianTotal.toLocaleString('ru-RU')} изд.) →
            </Link>
          </div>
          <div className="rb-books-grid">
            {ossetianShowcase.map((book) => (
              <BookCard
                key={book.slug}
                book={book}
                progressPercent={progressMap[book.slug]?.percent}
              />
            ))}
          </div>
        </section>
      )}

      {/* ПОЛКА 2: РЕКОМЕНДУЕМЫЕ ШЕДЕВРЫ ФОНДА */}
      <section className="rb-shelf">
        <div className="rb-shelf__head">
          <h2 className="rb-shelf__title">Избранные памятники и классика</h2>
          <Link to="/catalog" className="rb-shelf__more">
            Весь фонд ({totalBooksCount.toLocaleString('ru-RU')} книг) →
          </Link>
        </div>
        <div className="rb-books-grid">
          {flagshipBooks.slice(0, 6).map((book) => (
            <BookCard
              key={book.slug}
              book={book}
              progressPercent={progressMap[book.slug]?.percent}
            />
          ))}
        </div>
      </section>

      {/* ПОЛКА 3: РУССКИЕ СТАРИННЫЕ УЧЕБНИКИ И НАУКА */}
      {scienceAndTextbooks.length > 0 && (
        <section className="rb-shelf">
          <div className="rb-shelf__head">
            <h2 className="rb-shelf__title">Старинные учебники, логика и наука</h2>
            <Link to="/catalog?cat=rare-editions" className="rb-shelf__more">
              Открыть раздел →
            </Link>
          </div>
          <div className="rb-books-grid">
            {scienceAndTextbooks.map((book) => (
              <BookCard
                key={book.slug}
                book={book}
                progressPercent={progressMap[book.slug]?.percent}
              />
            ))}
          </div>
        </section>
      )}

      {/* ПОЛКА 4: НОВЫЕ ПОСТУПЛЕНИЯ АРХИВА */}
      {recentAdditions.length > 0 && (
        <section className="rb-shelf">
          <div className="rb-shelf__head">
            <h2 className="rb-shelf__title">Новые поступления архива</h2>
            <Link to="/catalog?sort=alpha" className="rb-shelf__more">Смотреть каталог →</Link>
          </div>
          <div className="rb-books-grid">
            {recentAdditions.map((book) => (
              <BookCard
                key={book.slug}
                book={book}
                progressPercent={progressMap[book.slug]?.percent}
              />
            ))}
          </div>
        </section>
      )}

      {/* НИЖНИЙ ТРЁХКОЛОНОЧНЫЙ БЛОК С РЕФЕРЕНСА: О ПРОЕКТЕ / РЕГИСТРАЦИЯ / ПРЕИМУЩЕСТВА */}
      <section className="rb-bento-row">
        {/* 1. О проекте с пером и старинными томами */}
        <div className="rb-panel rb-about-panel">
          <img
            src="/assets/images/about-quill.webp"
            alt="Старинные книги и чернильница с пером"
            className="rb-about-panel__art"
            loading="lazy"
          />
          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.65rem', margin: '0 0 10px' }}>
              О проекте
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
              <strong style={{ color: 'var(--text-main)' }}>RaritetBook.ru</strong> — открытая цифровая библиотека старинных, научных и классических изданий для всех, кто ценит историю, культуру и первоисточники.
            </p>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 16px' }}>
              В архиве уже собрано <strong>{totalBooksCount.toLocaleString('ru-RU')}</strong> полных проверенных книг без рекламы и платных подписок.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/about" className="rb-btn rb-btn--sm">Узнать больше →</Link>
              <Link to="/author" className="rb-btn rb-btn--sm">Об авторе</Link>
            </div>
          </div>
        </div>

        {/* 2. Карточка регистрации с предупреждением о сохранении пароля */}
        <div className="rb-panel">
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.65rem', margin: '0 0 12px', textAlign: 'center' }}>
            {user ? 'Синхронизация активна' : 'Регистрация'}
          </h2>
          {user ? (
            <div style={{ textAlign: 'center', padding: '18px 0' }}>
              <p style={{ color: 'var(--text-muted)' }}>
                Вы авторизованы как <strong style={{ color: 'var(--gold-bright)' }}>{user.email}</strong>.
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Все ваши закладки, настройки шрифта и прогресс чтения сохраняются автоматически.
              </p>
              <Link to="/catalog" className="rb-btn rb-btn--gold" style={{ marginTop: 10 }}>
                Перейти к чтению
              </Link>
            </div>
          ) : (
            <form onSubmit={handleQuickRegister}>
              <input
                type="email"
                required
                maxLength={120}
                autoComplete="email"
                className="rb-field"
                placeholder="E-mail"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
                className="rb-field"
                placeholder="Пароль"
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
              />
              <div className="rb-warning-box">
                <AlertCircle size={18} style={{ flexShrink: 0, color: 'var(--gold-bright)', marginTop: 2 }} />
                <span>
                  Внимание: восстановление пароля по почте не предусмотрено. Обязательно сохраните логин и пароль в браузере или заметках.
                </span>
              </div>
              {regMsg && (
                <div
                  style={{
                    fontSize: '0.82rem',
                    marginBottom: 10,
                    color: regMsg.ok ? 'var(--gold-bright)' : '#f28b6d',
                  }}
                >
                  {regMsg.text}
                </div>
              )}
              <button type="submit" className="rb-btn rb-btn--gold" style={{ width: '100%' }}>
                Создать аккаунт
              </button>
            </form>
          )}
        </div>

        {/* 3. Преимущества платформы */}
        <div className="rb-panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div className="rb-features-list">
            <div className="rb-feature-item">
              <div className="rb-feature-item__icon"><Zap size={20} /></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Мгновенный доступ</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Чтение и скачивание FB2 без регистрации</div>
              </div>
            </div>

            <div className="rb-feature-item">
              <div className="rb-feature-item__icon"><Cloud size={20} /></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Офлайн-режим и облако</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Кэширование книги в телефоне (PWA) для чтения без сети</div>
              </div>
            </div>

            <div className="rb-feature-item">
              <div className="rb-feature-item__icon"><Palette size={20} /></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Три темы оформления</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Старинная бумага, дневной свет и ночной архив</div>
              </div>
            </div>

            <div className="rb-feature-item">
              <div className="rb-feature-item__icon"><Type size={20} /></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Типографика и открытки цитат</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Гибкая настройка шрифта и генерация цитат в 1 клик</div>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
              textAlign: 'center',
              fontFamily: 'var(--font-heading)',
              fontStyle: 'italic',
              fontSize: '1.25rem',
              color: 'var(--gold-bright)',
            }}
          >
            Читай. Узнавай. Сохраняй.
          </div>
        </div>
      </section>
    </main>
  );
};
