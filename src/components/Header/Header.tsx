import React, { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Feather, Home, Library, Menu, Search, User, X } from 'lucide-react';
import type { UserSession } from '../../types/library';
import { getAllProgress } from '../../services/storageAndSync';

interface HeaderProps {
  user: UserSession | null;
  onOpenAuth: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, onOpenAuth }) => {
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Скрываем глобальную шапку внутри полноэкранной читалки
  if (location.pathname.startsWith('/read/')) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog');
    setDrawerOpen(false);
  };

  const insertOssetianAe = (isMobile = false) => {
    setQuery((prev) => prev + 'ӕ');
    const target = isMobile ? mobileInputRef.current : inputRef.current;
    target?.focus();
  };

  const latestSlug = (() => {
    const all = Object.values(getAllProgress()).sort((a, b) => b.updatedAt - a.updatedAt);
    return all[0]?.slug || 'lermontov-mtsyri';
  })();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
      <header className="rb-header">
        <div className="rb-container rb-header__inner">
          <Link to="/" className="rb-brand" aria-label="RaritetBook.ru — На главную">
            <img src="/assets/icons/logo.svg" alt="" className="rb-brand__logo" />
            <div>
              <div className="rb-brand__title">RaritetBook.ru</div>
              <div className="rb-brand__sub">Цифровая библиотека старинных и редких изданий</div>
            </div>
          </Link>

          <nav className="rb-nav" aria-label="Основная навигация">
            <Link
              to="/catalog"
              className={`rb-nav__link ${isActive('/catalog') ? 'rb-nav__link--active' : ''}`}
            >
              <Library size={16} /> Каталог
            </Link>
            <Link
              to="/about"
              className={`rb-nav__link ${isActive('/about') ? 'rb-nav__link--active' : ''}`}
            >
              <BookOpen size={16} /> О проекте
            </Link>
            <Link
              to="/author"
              className={`rb-nav__link ${isActive('/author') ? 'rb-nav__link--active' : ''}`}
            >
              <Feather size={16} /> Об авторе
            </Link>
          </nav>

          <div className="rb-header__actions">
            <form className="rb-search-box" onSubmit={handleSubmit} role="search">
              <input
                ref={inputRef}
                type="search"
                className="rb-search-box__input"
                placeholder="Поиск по книгам..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск книг по названию или автору"
              />
              <button
                type="button"
                className="rb-search-box__ae"
                onClick={() => insertOssetianAe(false)}
                title="Вставить осетинскую букву ӕ"
              >
                ӕ
              </button>
            </form>

            <button type="button" className="rb-btn rb-btn--sm" onClick={onOpenAuth}>
              <User size={15} />
              <span>{user ? user.email.split('@')[0] : 'Войти'}</span>
            </button>

            <button
              type="button"
              className="rb-mobile-toggle"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label="Открыть меню"
            >
              {drawerOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Мобильная строка поиска с кнопкой ӕ (как на референсе смартфона!) */}
        <div className="rb-mobile-search-strip">
          <form className="rb-search-box" onSubmit={handleSubmit} role="search">
            <input
              ref={mobileInputRef}
              type="search"
              className="rb-search-box__input"
              placeholder="Поиск по 10 000 книгам..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="rb-search-box__ae"
              onClick={() => insertOssetianAe(true)}
              title="Вставить ӕ"
            >
              ӕ
            </button>
          </form>
        </div>

        {drawerOpen && (
          <div
            style={{
              background: '#1c1713',
              borderTop: '1px solid var(--border)',
              padding: '14px 18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <Link to="/" onClick={() => setDrawerOpen(false)} className="rb-nav__link">
              Главная страница
            </Link>
            <Link to="/catalog" onClick={() => setDrawerOpen(false)} className="rb-nav__link">
              Каталог библиотеки (10 000 томов)
            </Link>
            <Link to="/about" onClick={() => setDrawerOpen(false)} className="rb-nav__link">
              О проекте и правовой статус
            </Link>
            <Link to="/author" onClick={() => setDrawerOpen(false)} className="rb-nav__link">
              Об авторе — Денис Омельчук
            </Link>
            <Link to="/admin" onClick={() => setDrawerOpen(false)} className="rb-nav__link">
              Инструмент импорта FB2
            </Link>
          </div>
        )}
      </header>

      {/* Нижняя мобильная панель быстрого доступа */}
      <nav className="rb-bottom-nav" aria-label="Мобильная навигация">
        <Link
          to="/"
          className={`rb-bottom-nav__item ${isActive('/') ? 'rb-bottom-nav__item--active' : ''}`}
        >
          <Home size={19} />
          <span>Главная</span>
        </Link>
        <Link
          to="/catalog"
          className={`rb-bottom-nav__item ${isActive('/catalog') ? 'rb-bottom-nav__item--active' : ''}`}
        >
          <Library size={19} />
          <span>Каталог</span>
        </Link>
        <Link
          to={`/read/${latestSlug}`}
          className={`rb-bottom-nav__item ${isActive('/read') ? 'rb-bottom-nav__item--active' : ''}`}
        >
          <BookOpen size={19} />
          <span>Читать</span>
        </Link>
        <Link
          to="/author"
          className={`rb-bottom-nav__item ${isActive('/author') ? 'rb-bottom-nav__item--active' : ''}`}
        >
          <Feather size={19} />
          <span>Об авторе</span>
        </Link>
        <button type="button" className="rb-bottom-nav__item" onClick={onOpenAuth}>
          <User size={19} />
          <span>{user ? 'Профиль' : 'Войти'}</span>
        </button>
      </nav>
    </>
  );
};
