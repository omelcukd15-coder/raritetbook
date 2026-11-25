import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bookmark,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  FileCode2,
  HardDrive,
  Lock,
  RefreshCw,
  Upload,
  Users,
} from 'lucide-react';
import type {
  AdminLiveStats,
  BookChapter,
  CatalogManifest,
  CategoryId,
  ContentBlock,
  FullBookData,
} from '../../types/library';
import { API_BASE_URL } from '../../services/storageAndSync';
import { loadCatalogManifest } from '../../services/catalogService';
import { BookCover } from '../../components/BookCover/BookCover';

const MAX_XML_SECTION_DEPTH = 6;
const MAX_CHAPTERS = 600;
const MAX_BLOCKS_PER_CHAPTER = 5_000;

function slugifyRu(input: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ы: 'y', э: 'e', ю: 'yu', я: 'ya', ӕ: 'ae',
  };
  return input
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? (/[a-z0-9]/.test(c) ? c : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function parseFb2Xml(xmlText: string, category: CategoryId, sourceUrl: string, legalStatus: string): FullBookData {
  if (/<!(?:DOCTYPE|ENTITY)/i.test(xmlText)) {
    throw new Error('Запрещённые DTD/ENTITY-декларации в XML-файле.');
  }

  const safeSourceUrl =
    sourceUrl.trim() && /^https?:\/\//i.test(sourceUrl.trim()) ? sourceUrl.trim().slice(0, 300) : '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('Ошибка структуры XML: файл не является валидным FB2.');
  }

  const txt = (sel: string, root: ParentNode = doc) =>
    root.querySelector(sel)?.textContent?.trim() || '';

  const title = (txt('title-info > book-title') || 'Без названия').slice(0, 240);
  const firstName = txt('title-info > author > first-name');
  const middleName = txt('title-info > author > middle-name');
  const lastName = txt('title-info > author > last-name');
  const author = ([firstName, middleName, lastName].filter(Boolean).join(' ') || 'Неизвестный автор').slice(0, 160);
  const authorShort =
    firstName && lastName
      ? `${firstName[0]}.${middleName ? ` ${middleName[0]}.` : ''} ${lastName}`.slice(0, 100)
      : author.slice(0, 100);
  const language = txt('title-info > lang').slice(0, 8) || 'ru';
  const writtenYear = txt('title-info > date').slice(0, 32) || '';
  const editionYear = (txt('publish-info > year') || writtenYear).slice(0, 32);
  const annotation = txt('title-info > annotation') || `Издание произведения «${title}».`;
  const transFirst = txt('title-info > translator > first-name');
  const transLast = txt('title-info > translator > last-name');
  const transNick = txt('title-info > translator > nickname');
  const translator = ([transFirst, transLast].filter(Boolean).join(' ') || transNick || '').slice(0, 120) || null;

  const body = doc.querySelector('body');
  if (!body) throw new Error('В FB2 отсутствует секция <body>.');

  const sections = Array.from(body.querySelectorAll(':scope > section')).slice(0, MAX_CHAPTERS);
  const chapters: BookChapter[] = [];

  const extractBlocks = (sec: Element, depth = 0): ContentBlock[] => {
    if (depth > MAX_XML_SECTION_DEPTH) return [];
    const blocks: ContentBlock[] = [];
    for (const child of Array.from(sec.children)) {
      if (blocks.length >= MAX_BLOCKS_PER_CHAPTER) break;
      const tag = child.localName.toLowerCase();
      if (tag === 'title') continue;
      if (tag === 'epigraph') {
        const t = child.textContent?.trim();
        if (t) blocks.push({ type: 'epigraph', text: t });
      } else if (tag === 'subtitle') {
        const t = child.textContent?.trim();
        if (t) blocks.push({ type: 'subtitle', text: t });
      } else if (tag === 'poem') {
        const stanzas = Array.from(child.querySelectorAll('stanza'))
          .slice(0, 400)
          .map((st) =>
            Array.from(st.querySelectorAll('v'))
              .slice(0, 120)
              .map((v) => v.textContent?.trim() || '')
              .filter(Boolean)
          );
        if (stanzas.length) {
          blocks.push({
            type: 'poem',
            stanzas,
            text: stanzas.map((s) => s.join('\n')).join('\n\n'),
          });
        }
      } else if (tag === 'p') {
        const plain = child.textContent?.trim() || '';
        if (plain) blocks.push({ type: 'paragraph', text: plain });
      } else if (tag === 'section') {
        const subTitle = child.querySelector(':scope > title')?.textContent?.trim();
        if (subTitle) blocks.push({ type: 'subtitle', text: subTitle });
        blocks.push(...extractBlocks(child, depth + 1));
      }
    }
    return blocks.slice(0, MAX_BLOCKS_PER_CHAPTER);
  };

  if (sections.length > 0) {
    sections.forEach((sec, idx) => {
      const chTitle =
        sec.querySelector(':scope > title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180) ||
        `Глава ${idx + 1}`;
      const content = extractBlocks(sec, 0);
      if (content.length > 0) {
        chapters.push({ id: `chapter-${idx + 1}`, title: chTitle, content });
      }
    });
  } else {
    const content = extractBlocks(body, 0);
    chapters.push({ id: 'chapter-1', title, content });
  }

  const authorSlug = slugifyRu(lastName || author) || 'author';
  const slug = slugifyRu(`${authorSlug}-${title}`) || 'book';
  const wordsCount = chapters.reduce(
    (acc, ch) => acc + ch.content.reduce((s, b) => s + b.text.split(/\s+/).length, 0),
    0
  );
  const charsCount = chapters.reduce(
    (acc, ch) => acc + ch.content.reduce((s, b) => s + b.text.length, 0),
    0
  );

  return {
    id: slug,
    slug,
    title,
    altTitles: [],
    author,
    authorShort,
    authorSlug,
    authorYears: '',
    translator,
    language,
    category,
    writtenYear,
    editionYear,
    description: annotation.slice(0, 400),
    historicalNote: 'Импортировано из проверенного FB2-источника.',
    sourceUrl: safeSourceUrl,
    legalStatus: legalStatus.slice(0, 240),
    downloadAllowed: true,
    fb2Url: `/archive/books/${authorSlug}/${slug}/original.fb2`,
    coverUrl: `/archive/books/${authorSlug}/${slug}/cover.webp`,
    stats: {
      chaptersCount: chapters.length,
      wordsCount,
      charsCount,
      readingMinutes: Math.max(4, Math.round(wordsCount / 180)),
    },
    toc: chapters.map((c) => ({ id: c.id, title: c.title })),
    chapters,
  };
}

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AdminImportPage: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Живая аналитика D1 + манифест шардов 100K
  const [liveStats, setLiveStats] = useState<AdminLiveStats | null>(null);
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Конвертер FB2
  const [category, setCategory] = useState<CategoryId>('russian-classics');
  const [sourceUrl, setSourceUrl] = useState('');
  const [legalStatus, setLegalStatus] = useState(
    'Общественное достояние (ст. 1281, 1282 ГК РФ — проверено администратором)'
  );
  const [parsedBook, setParsedBook] = useState<FullBookData | null>(null);
  const [error, setError] = useState('');

  const fetchAdminTelemetry = useCallback(async (keyToUse: string) => {
    if (!keyToUse) return;
    setStatsLoading(true);
    try {
      const [statsResp, mf] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/stats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: keyToUse }),
        }),
        loadCatalogManifest().catch(() => null),
      ]);
      if (mf) setManifest(mf);
      if (statsResp.ok) {
        const data = await statsResp.json();
        if (data.stats) setLiveStats(data.stats);
      }
    } catch {
      // ignore transient error
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked || !sessionKey) return;
    const timer = setInterval(() => {
      void fetchAdminTelemetry(sessionKey);
    }, 30_000);
    return () => clearInterval(timer);
  }, [unlocked, sessionKey, fetchAdminTelemetry]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr('');
    setVerifying(true);
    const trimmed = adminKey.trim();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/admin/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setSessionKey(trimmed);
        setLiveStats(data.stats || null);
        setUnlocked(true);
        setAdminKey('');
        void loadCatalogManifest().then(setManifest).catch(() => null);
      } else {
        setAuthErr(data.error || 'Неверный ключ администратора.');
      }
    } catch {
      setAuthErr('Не удалось связаться с облачным сервером проверки.');
    } finally {
      setVerifying(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > 25 * 1024 * 1024) {
      setError('Размер файла превышает допустимый лимит 25 МБ.');
      return;
    }
    try {
      const text = await file.text();
      const result = parseFb2Xml(text, category, sourceUrl, legalStatus);
      setParsedBook(result);
    } catch (err: any) {
      setError(err?.message || 'Не удалось обработать FB2');
    }
  };

  const downloadJson = () => {
    if (!parsedBook) return;
    const blob = new Blob([JSON.stringify(parsedBook, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'book.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!unlocked) {
    return (
      <main className="rb-container" style={{ padding: '48px 20px', maxWidth: 460 }}>
        <div className="rb-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Lock size={20} color="var(--gold-bright)" />
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.65rem', margin: 0 }}>
              Панель управления архивом
            </h1>
          </div>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            Живая облачная статистика читателей (Cloudflare D1), мониторинг ёмкости 100 000 книг и конвейер конвертации FB2.
          </p>
          <form onSubmit={handleUnlock}>
            <input
              type="password"
              maxLength={128}
              className="rb-field"
              placeholder="Серверный ключ администратора"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              required
            />
            {authErr && (
              <div style={{ color: '#f28b6d', fontSize: '0.84rem', marginBottom: 10 }}>{authErr}</div>
            )}
            <button type="submit" disabled={verifying} className="rb-btn rb-btn--gold" style={{ width: '100%' }}>
              {verifying ? 'Проверка ключа...' : 'Войти в консоль администратора'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const totalBooks = manifest?.totalBooks || 15000;
  const maxCap = manifest?.maxCapacity || 100000;
  const capPct = Math.min(100, Math.round((totalBooks / maxCap) * 100));

  return (
    <main className="rb-container" style={{ paddingTop: 28, paddingBottom: 56 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.1rem', margin: 0 }}>
            Центр управления RaritetBook.ru
          </h1>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            Живая телеметрия базы Cloudflare D1 • Авто-шардированный движок на 100 000 томов (автообновление каждые 30 сек)
          </div>
        </div>
        <button
          type="button"
          className="rb-btn rb-btn--sm"
          disabled={statsLoading}
          onClick={() => fetchAdminTelemetry(sessionKey)}
        >
          <RefreshCw size={15} /> {statsLoading ? 'Обновление…' : 'Обновить данные'}
        </button>
      </div>

      {/* KPI КАРТОЧКИ ЖИВОЙ СТАТИСТИКИ ПОЛЬЗОВАТЕЛЕЙ И ФОНДА */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div className="rb-panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <Users size={16} color="var(--gold-bright)" /> Читателей в облаке D1
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>
            {(liveStats?.totalUsers ?? 0).toLocaleString('ru-RU')}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--gold-bright)' }}>
            +{liveStats?.newUsers24h ?? 0} за последние 24 часа
          </div>
        </div>

        <div className="rb-panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <Activity size={16} color="var(--gold-bright)" /> Активны (24ч / 7 дней)
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>
            {liveStats?.activeUsers24h ?? 0}{' '}
            <span style={{ fontSize: '1.15rem', color: 'var(--text-muted)' }}>
              / {liveStats?.activeUsers7d ?? 0}
            </span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Синхронизаций чтения без VPN
          </div>
        </div>

        <div className="rb-panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <Bookmark size={16} color="var(--gold-bright)" /> Начато книг / Закладок
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>
            {liveStats?.totalReadingRecords ?? 0}{' '}
            <span style={{ fontSize: '1.15rem', color: 'var(--text-muted)' }}>
              / {liveStats?.totalBookmarks ?? 0}
            </span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Сохранено в облачных билетах
          </div>
        </div>

        <div className="rb-panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <HardDrive size={16} color="var(--gold-bright)" /> Фонд архива (из 100K)
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>
            {totalBooks.toLocaleString('ru-RU')}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--gold-bright)' }}>
            {manifest?.chunks.length || 3} индексных чанка • {manifest?.shardRepos.length || 2} CDN-репозитория
          </div>
        </div>
      </section>

      {/* ПОЛОСА ЗАПАСА МОЩНОСТИ ПОД 100 000 КНИГ */}
      <div className="rb-panel" style={{ marginBottom: 22, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <span>
            <Database size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--gold-bright)' }} />
            Заполнение авто-шардированной архитектуры <strong>100 000 томов</strong>:
          </span>
          <strong style={{ color: 'var(--gold-bright)' }}>
            {totalBooks.toLocaleString('ru-RU')} / {maxCap.toLocaleString('ru-RU')} книг ({capPct}%) •{' '}
            {Math.round((manifest?.totalWords || 90_000_000) / 1_000_000)} млн слов
          </strong>
        </div>
        <div className="rb-progress-track" style={{ height: 8 }}>
          <div className="rb-progress-fill" style={{ width: `${Math.max(2, capPct)}%` }} />
        </div>
      </div>

      {/* ДВЕ КОЛОНКИ АНАЛИТИКИ: ПОСЛЕДНИЕ ПОЛЬЗОВАТЕЛИ + ТОП ЧИТАЕМЫХ КНИГ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
          marginBottom: 28,
        }}
      >
        <div className="rb-panel">
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', marginTop: 0 }}>
            Последние читатели в облаке
          </h2>
          {!liveStats?.recentUsers.length ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Пока нет зарегистрированных облачных аккаунтов. Создайте тестовый аккаунт на сайте — он мгновенно появится здесь!
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>E-mail</th>
                    <th style={{ padding: '6px 8px' }}>Книг / Закл.</th>
                    <th style={{ padding: '6px 8px' }}>Активность</th>
                  </tr>
                </thead>
                <tbody>
                  {liveStats.recentUsers.map((u) => (
                    <tr key={u.email} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '7px 8px', fontWeight: 500 }}>{u.email}</td>
                      <td style={{ padding: '7px 8px', color: 'var(--gold-bright)' }}>
                        {u.booksCount} / {u.bookmarksCount}
                      </td>
                      <td style={{ padding: '7px 8px', color: 'var(--text-muted)' }}>{fmtDate(u.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rb-panel">
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', marginTop: 0 }}>
            Топ читаемых произведений
          </h2>
          {!liveStats?.topBooks.length ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Рейтинг формируется автоматически на основе синхронизированного прогресса читателей.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {liveStats.topBooks.map((tb, idx) => (
                <div
                  key={tb.slug}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.025)',
                    fontSize: '0.85rem',
                  }}
                >
                  <Link to={`/book/${tb.slug}`} style={{ color: 'var(--text-main)', textDecoration: 'none' }}>
                    <strong style={{ color: 'var(--gold-bright)', marginRight: 6 }}>#{idx + 1}</strong>
                    <BookOpen size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                    {tb.slug}
                  </Link>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                    {tb.readers} чит. • ср. {tb.avgPercent}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* КОНВЕЙЕР ИМПОРТА FB2 */}
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.75rem', margin: '0 0 14px' }}>
        Конвейер проверки и конвертации FB2 → Архив
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 22 }}>
        <div className="rb-panel">
          <h3 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>1. Загрузка и проверка прав</h3>

          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            Категория фонда
          </label>
          <select
            className="rb-field"
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryId)}
          >
            <option value="history">История России</option>
            <option value="russian-classics">Русская классика</option>
            <option value="caucasus">Кавказ и народы России</option>
            <option value="foreign-classics">Зарубежная классика</option>
            <option value="science">Наука и философия</option>
            <option value="rare-editions">Редкие издания и учебники</option>
          </select>

          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            Источник текста
          </label>
          <input
            type="url"
            maxLength={300}
            className="rb-field"
            placeholder="https://..."
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />

          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            Правовое основание (ст. 1281–1282 ГК РФ)
          </label>
          <input
            type="text"
            maxLength={240}
            className="rb-field"
            value={legalStatus}
            onChange={(e) => setLegalStatus(e.target.value)}
          />

          <label className="rb-btn rb-btn--gold" style={{ width: '100%', marginTop: 8 }}>
            <Upload size={17} /> Выбрать файл .fb2
            <input type="file" accept=".fb2,.xml" onChange={handleFile} style={{ display: 'none' }} />
          </label>

          {error && <p style={{ color: '#f28b6d', fontSize: '0.85rem', marginTop: 12 }}>{error}</p>}
        </div>

        <div className="rb-panel">
          <h3 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>2. Предпросмотр карточки и JSON</h3>
          {!parsedBook ? (
            <p style={{ color: 'var(--text-muted)' }}>
              Загрузите <code>.fb2</code>, чтобы проверить XML-структуру, извлечённые главы, стихи, эпиграфы и обложку.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 16 }}>
              <BookCover
                title={parsedBook.title}
                authorShort={parsedBook.authorShort}
                year={parsedBook.editionYear}
                category={parsedBook.category}
                slug={parsedBook.slug}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gold-bright)', fontSize: '0.8rem' }}>
                  <CheckCircle2 size={15} /> Валидный FB2 • {parsedBook.stats.chaptersCount} глав •{' '}
                  {parsedBook.stats.wordsCount.toLocaleString('ru-RU')} слов
                </div>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', margin: '6px 0 4px' }}>
                  {parsedBook.title}
                </h3>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  {parsedBook.author} ({parsedBook.language})
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                  Путь архива: <code>books/{parsedBook.authorSlug}/{parsedBook.slug}/</code>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="rb-btn rb-btn--gold rb-btn--sm" onClick={downloadJson}>
                    <Download size={15} /> Скачать book.json
                  </button>
                  <span className="rb-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <FileCode2 size={14} /> Готово к выгрузке
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
