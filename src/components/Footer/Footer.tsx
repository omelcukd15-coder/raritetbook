import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ExternalLink, MessageCircle, Scale, Send } from 'lucide-react';

export const Footer: React.FC = () => {
  const location = useLocation();
  if (location.pathname.startsWith('/read/')) {
    return null;
  }

  return (
    <footer className="rb-footer">
      <div className="rb-container">
        <div className="rb-footer__row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <img src="/assets/icons/logo.svg" alt="" width={38} height={27} />
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', color: 'var(--text-main)' }}>
              RaritetBook.ru
            </strong>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>Читай. Узнавай. Сохраняй историю.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
            <a
              href="https://t.me/omelden"
              target="_blank"
              rel="noopener noreferrer"
              className="rb-nav__link"
            >
              <Send size={14} /> Telegram: @omelden
            </a>
            <a
              href="https://wa.me/79888764310"
              target="_blank"
              rel="noopener noreferrer"
              className="rb-nav__link"
            >
              <MessageCircle size={14} /> WhatsApp: +7 (988) 876-43-10
            </a>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Scale size={14} color="var(--gold)" /> Все материалы — в общественном достоянии (ст. 1281–1282 ГК РФ)
            </span>
          </div>
        </div>

        <div
          className="rb-footer__row"
          style={{
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(185, 149, 91, 0.15)',
            fontSize: '0.8rem',
          }}
        >
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <Link to="/catalog" className="rb-nav__link">Каталог</Link>
            <Link to="/about" className="rb-nav__link">О проекте</Link>
            <Link to="/author" className="rb-nav__link">Об авторе</Link>
            <Link to="/privacy" className="rb-nav__link">Конфиденциальность</Link>
            <Link to="/terms" className="rb-nav__link">Правила пользования</Link>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span>
              Разработка и поддержка —{' '}
              <Link to="/author" style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                Денис Омельчук
              </Link>
            </span>
            <a
              href="https://omelchukdenis.ru"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--gold-bright)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              OmelchukDenis.ru <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
