import React, { useState } from 'react';
import { CheckCircle2, Download, FileCode2, Lock, Upload } from 'lucide-react';
import type { BookChapter, CategoryId, ContentBlock, FullBookData } from '../../types/library';
import { API_BASE_URL } from '../../services/storageAndSync';
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
  // Защита от XXE / Billion Laughs DTD-экспансии
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

export const AdminImportPage: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [category, setCategory] = useState<CategoryId>('russian-classics');
  const [sourceUrl, setSourceUrl] = useState('');
  const [legalStatus, setLegalStatus] = useState(
    'Общественное достояние (ст. 1281, 1282 ГК РФ — проверено администратором)'
  );
  const [parsedBook, setParsedBook] = useState<FullBookData | null>(null);
  const [error, setError] = useState('');

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr('');
    setVerifying(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/admin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: adminKey.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setUnlocked(true);
        setAdminKey('');
      } else {
        setAuthErr(data.error || 'Неверный ключ администратора.');
      }
    } catch {
      setAuthErr('Не удалось проверить ключ на сервере.');
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
              Служебный вход администратора
            </h1>
          </div>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            Инструмент проверки прав и конвертации FB2 → <code>book.json</code>. Ключ проверяется на защищённом сервере Cloudflare с защитой от перебора.
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
              {verifying ? 'Проверка ключа...' : 'Открыть консоль импорта'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="rb-container" style={{ paddingTop: 28, paddingBottom: 48 }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.2rem', marginTop: 0 }}>
        Конвейер импорта FB2 → Архив
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 22 }}>
        <div className="rb-panel">
          <h2 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>1. Загрузка и проверка прав</h2>

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
          <h2 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>2. Предпросмотр карточки и JSON</h2>
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
