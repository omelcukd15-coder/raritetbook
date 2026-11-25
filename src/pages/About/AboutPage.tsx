import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Scale, Shield } from 'lucide-react';

export const AboutPage: React.FC<{ section?: 'about' | 'privacy' | 'terms' }> = ({
  section = 'about',
}) => {
  useEffect(() => {
    const titles = {
      about: 'О цифровой библиотеке RaritetBook.ru',
      privacy: 'Политика конфиденциальности — RaritetBook.ru',
      terms: 'Правила пользования и правовой статус — RaritetBook.ru',
    };
    document.title = titles[section];
    window.scrollTo(0, 0);
  }, [section]);

  return (
    <main className="rb-container" style={{ paddingTop: 28, paddingBottom: 48, maxWidth: 960 }}>
      {section === 'about' && (
        <div className="rb-panel" style={{ padding: '32px 28px' }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 3.6vw, 2.8rem)', marginTop: 0 }}>
            О проекте RaritetBook.ru
          </h1>
          <p style={{ color: '#e2d5c1', fontSize: '1.05rem', lineHeight: 1.68 }}>
            <strong>RaritetBook.ru</strong> («Старинные книги. Вечные знания») — самостоятельная открытая цифровая библиотека исторической, научной, учебной и классической литературы России и мира.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.68 }}>
            Наша задача — сохранить книжное наследие прошлых веков в удобном современном цифровом формате. В отличие от каталогов сканированных PDF-страниц, каждое произведение в RaritetBook представлено с полноценной текстовой вёрсткой, оглавлением, сохранением стихотворных строф, эпиграфов и исторических сведений.
          </p>

          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.65rem', marginTop: 26 }}>
            Ключевые принципы библиотеки
          </h2>
          <ul style={{ color: 'var(--text-muted)', lineHeight: 1.75, paddingLeft: 20 }}>
            <li><strong>Полная бесплатность и отсутствие рекламы:</strong> чтение и загрузка оригинальных FB2-файлов открыты для всех читателей.</li>
            <li><strong>Чтение без обязательной регистрации:</strong> закладки, тема оформления («Старинная бумага», «День», «Ночь») и прогресс работают сразу на вашем устройстве, а при желании синхронизируются через аккаунт.</li>
            <li><strong>Офлайн-доступ (PWA):</strong> любая открытая книга сохраняется в памяти браузера (IndexedDB) — её можно дочитать в дороге, в самолёте или в горах без мобильной связи.</li>
            <li><strong>Соблюдение авторского права:</strong> мы публикуем произведения, перешедшие в общественное достояние согласно статьям 1281 и 1282 ГК РФ.</li>
          </ul>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
            <Link to="/catalog" className="rb-btn rb-btn--gold">
              <BookOpen size={17} /> Перейти в каталог (15 000 книг)
            </Link>
            <Link to="/author" className="rb-btn">Об авторе проекта</Link>
          </div>
        </div>
      )}

      {section === 'privacy' && (
        <div className="rb-panel" style={{ padding: '32px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Shield size={22} color="var(--gold-bright)" />
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.2rem', margin: 0 }}>
              Политика конфиденциальности
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.68 }}>
            Цифровая библиотека <strong>RaritetBook.ru</strong> придерживается принципа минимизации персональных данных:
          </p>
          <ul style={{ color: 'var(--text-muted)', lineHeight: 1.75, paddingLeft: 20 }}>
            <li>Чтение всех книг, поиск и скачивание файлов доступны без регистрации и передачи каких-либо личных данных.</li>
            <li>При добровольном создании аккаунта для синхронизации прогресса хранятся только адрес электронной почты, криптографический хеш пароля с солью и компактный JSON прогресса чтения (до 10 КБ).</li>
            <li>Пароли никогда не сохраняются в открытом виде и не помещаются в `localStorage`.</li>
            <li>Мы не используем рекламные трекеры и не передаём данные третьим лицам.</li>
          </ul>
        </div>
      )}

      {section === 'terms' && (
        <div className="rb-panel" style={{ padding: '32px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Scale size={22} color="var(--gold-bright)" />
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.2rem', margin: 0 }}>
              Правила пользования и правовой статус
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.68 }}>
            Все тексты произведений в фонде <strong>RaritetBook.ru</strong> размещаются на основании перехода исключительного права в общественное достояние (статьи 1281 и 1282 Гражданского кодекса Российской Федерации).
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.68 }}>
            При отборе книг учитываются как годы жизни автора оригинала, так и годы жизни автора перевода и дата публикации издания. Если у вас есть документальные уточнения по любому изданию, свяжитесь с основателем проекта через Telegram:{' '}
            <a href="https://t.me/omelden" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-bright)' }}>
              @omelden
            </a>{' '}
            или WhatsApp:{' '}
            <a href="https://wa.me/79888764310" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-bright)' }}>
              +7 (988) 876-43-10
            </a>.
          </p>
        </div>
      )}
    </main>
  );
};
