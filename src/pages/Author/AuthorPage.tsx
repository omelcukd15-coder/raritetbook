import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Code2, ExternalLink, Globe, MapPin, MessageCircle, Phone, Send, ShieldCheck } from 'lucide-react';

export const AuthorPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Об авторе проекта — Денис Омельчук | RaritetBook.ru';
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="rb-container" style={{ paddingBottom: 44 }}>
      <section className="rb-author-hero">
        <div className="rb-author-photo-frame">
          <img
            src="/assets/images/author-denis.webp"
            alt="Денис Омельчук — основатель и разработчик RaritetBook.ru"
            className="rb-author-photo"
          />
        </div>

        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--gold-bright)',
              fontSize: '0.84rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            <MapPin size={14} /> Владикавказ, Россия
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2.2rem, 4vw, 3.2rem)',
              lineHeight: 1.08,
              margin: '0 0 14px',
            }}
          >
            Денис Омельчук
          </h1>

          <p style={{ fontSize: '1.08rem', color: '#e3d6c2', margin: '0 0 14px', maxWidth: 680 }}>
            Автор, основатель и разработчик открытой цифровой библиотеки{' '}
            <strong style={{ color: 'var(--gold-bright)' }}>RaritetBook.ru</strong>.
          </p>

          <p style={{ color: 'var(--text-muted)', lineHeight: 1.68, margin: '0 0 16px', maxWidth: 680 }}>
            Проект создан с целью сделать редкие дореволюционные издания, старинные русские учебники, научные труды, исторические хроники России и Кавказа, а также мировую классику доступными каждому читателю — бесплатно, без навязчивой рекламы, пейволлов и обязательной регистрации, с удобным чтением на смартфоне даже без доступа к сети.
          </p>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(185, 149, 91, 0.1)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.95rem',
              marginBottom: 18,
            }}
          >
            <Phone size={16} color="var(--gold-bright)" />
            <a href="tel:+79888764310" style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              +7 (988) 876-43-10
            </a>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a
              href="https://wa.me/79888764310"
              target="_blank"
              rel="noopener noreferrer"
              className="rb-btn"
              style={{
                background: 'linear-gradient(180deg, #279b56 0%, #1d7e44 100%)',
                borderColor: '#37b86c',
                color: '#ffffff',
                fontWeight: 600,
              }}
            >
              <MessageCircle size={17} /> Написать в WhatsApp
            </a>

            <a
              href="https://t.me/omelden"
              target="_blank"
              rel="noopener noreferrer"
              className="rb-btn rb-btn--gold"
            >
              <Send size={16} /> Telegram: @omelden
            </a>

            <a
              href="https://omelchukdenis.ru"
              target="_blank"
              rel="noopener noreferrer"
              className="rb-btn"
            >
              <Globe size={17} /> OmelchukDenis.ru <ExternalLink size={14} />
            </a>

            <Link to="/catalog" className="rb-btn">
              <BookOpen size={17} /> Открыть фонд (10 000 книг)
            </Link>
          </div>
        </div>
      </section>

      {/* Принципы и архитектура + Пресс-кит */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 18,
          marginTop: 12,
        }}
      >
        <div className="rb-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Code2 size={20} color="var(--gold-bright)" />
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', margin: 0 }}>
              Инженерный подход
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.62, margin: 0 }}>
            Платформа спроектирована по архитектуре Static-First + Object Storage и рассчитана на масштабирование фонда от 10 000 до 50 000 томов. Поиск выполняется в отдельном потоке (Web Worker) с поддержкой русской и осетинской орфографии («ӕ»), а открытые книги автоматически кэшируются в браузере для чтения офлайн.
          </p>
        </div>

        <div className="rb-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <ShieldCheck size={20} color="var(--gold-bright)" />
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', margin: 0 }}>
              Открытость и законность
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.62, margin: 0 }}>
            Все публикуемые тексты проходят проверку правового статуса в соответствии со статьями 1281 и 1282 Гражданского кодекса РФ (переход произведений и переводов в общественное достояние). В карточке каждого издания указываются библиографические сведения и источник.
          </p>
        </div>

        <div className="rb-panel">
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', margin: 0, marginBottom: 10 }}>
            Контакты и пресс-справка для СМИ
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 12px' }}>
            <strong style={{ color: 'var(--text-main)' }}>Информационный повод:</strong> молодой разработчик из Владикавказа Денис Омельчук создал бесплатную цифровую библиотеку из 10 000 старинных, научных и классических книг <em>RaritetBook.ru</em>, доступную читателям по всей России без рекламы и регистрации.
          </p>
          <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div>• Телефон / WhatsApp: <a href="https://wa.me/79888764310" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-bright)' }}>+7 (988) 876-43-10</a></div>
            <div>• Telegram: <a href="https://t.me/omelden" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-bright)' }}>@omelden</a></div>
            <div>• Официальный сайт автора: <a href="https://omelchukdenis.ru" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-bright)' }}>omelchukdenis.ru</a></div>
          </div>
        </div>
      </section>
    </main>
  );
};
