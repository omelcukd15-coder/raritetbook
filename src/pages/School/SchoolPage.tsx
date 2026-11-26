import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, GraduationCap, Share2, Sun } from 'lucide-react';
import type { SchoolCurriculumPayload } from '../../types/library';
import { loadSchoolCurriculum } from '../../services/catalogService';
import { getAllProgress } from '../../services/storageAndSync';
import { BookCard } from '../../components/BookCard/BookCard';

const GRADE_LABELS: Record<number, string> = {
  5: '5 класс',
  6: '6 класс',
  7: '7 класс',
  8: '8 класс',
  9: '9 класс (ОГЭ)',
  10: '10 класс',
  11: '11 класс (ЕГЭ)',
};

export const SchoolPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialGrade = Number(searchParams.get('grade')) || 0;
  const initialSubj = searchParams.get('subj') || 'all';

  const [data, setData] = useState<SchoolCurriculumPayload | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number>(
    initialGrade >= 5 && initialGrade <= 11 ? initialGrade : 0
  );
  const [selectedSubj, setSelectedSubj] = useState<string>(initialSubj);
  const [onlySummer, setOnlySummer] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progressMap, setProgressMap] = useState(getAllProgress);

  useEffect(() => {
    document.title =
      'Школьная программа 5–11 класс: литература на лето и учебники по всем предметам — RaritetBook.ru';
    loadSchoolCurriculum()
      .then(setData)
      .finally(() => setLoading(false));

    const onProg = () => setProgressMap(getAllProgress());
    window.addEventListener('raritetbook:progress-updated', onProg);
    return () => window.removeEventListener('raritetbook:progress-updated', onProg);
  }, []);

  useEffect(() => {
    const g = Number(searchParams.get('grade')) || 0;
    const s = searchParams.get('subj') || 'all';
    setSelectedGrade(g >= 5 && g <= 11 ? g : 0);
    setSelectedSubj(s);
  }, [searchParams]);

  const selectGrade = (g: number) => {
    setSelectedGrade(g);
    const next = new URLSearchParams(searchParams);
    if (g === 0) next.delete('grade');
    else next.set('grade', String(g));
    setSearchParams(next, { replace: true });
  };

  const selectSubject = (s: string) => {
    setSelectedSubj(s);
    const next = new URLSearchParams(searchParams);
    if (s === 'all') next.delete('subj');
    else next.set('subj', s);
    setSearchParams(next, { replace: true });
  };

  const filteredItems = useMemo(() => {
    const all = data?.items || [];
    const seenSlugs = new Set<string>();
    const out = [];
    const normQ = query.trim().toLowerCase().replace(/ё/g, 'е').replace(/æ/g, 'ӕ');

    for (const item of all) {
      if (selectedGrade > 0 && !item.grades.includes(selectedGrade)) continue;
      if (selectedSubj !== 'all' && item.subject !== selectedSubj) continue;
      if (onlySummer && !item.summer) continue;
      if (normQ) {
        const hay = `${item.book.t} ${item.book.a} ${item.note}`
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/æ/g, 'ӕ');
        if (!hay.includes(normQ)) continue;
      }
      if (seenSlugs.has(item.book.slug)) continue;
      seenSlugs.add(item.book.slug);
      out.push(item);
    }
    return out;
  }, [data, selectedGrade, selectedSubj, onlySummer, query]);

  const completedCount = useMemo(
    () => filteredItems.filter((it) => (progressMap[it.book.slug]?.percent || 0) >= 95).length,
    [filteredItems, progressMap]
  );

  const handleShareList = async () => {
    const gradeTitle = selectedGrade ? GRADE_LABELS[selectedGrade] : '5–11 класс';
    const shareUrl = window.location.href;
    const shareText = `📚 Школьная программа и список чтения на лето (${gradeTitle}) — все полные книги бесплатно онлайн и в FB2 без рекламы на RaritetBook.ru:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Школьная программа (${gradeTitle})`, text: shareText, url: shareUrl });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div>
      <section className="rb-catalog-hero">
        <div className="rb-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--gold-bright)', fontSize: '0.84rem', marginBottom: 6 }}>
                <GraduationCap size={18} /> Федеральная программа ФГОС • Подготовка к ОГЭ и ЕГЭ • Чтение на лето
              </div>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.9rem, 3.4vw, 2.7rem)', margin: '0 0 8px' }}>
                Школьная библиотека (5–11 класс)
              </h1>
              <p style={{ color: 'var(--text-muted)', margin: '0 0 18px', fontSize: '0.95rem', maxWidth: 740 }}>
                Вся программа в одном месте без поисков по десяткам сайтов: русская, зарубежная и родная (осетинская) литература, история, занимательная математика, физика, логика, география и грамматика. Полные издания бесплатно и офлайн.
              </p>
            </div>

            <button type="button" className="rb-btn rb-btn--gold" onClick={handleShareList}>
              {copied ? <CheckCircle2 size={17} /> : <Share2 size={17} />}
              {copied ? 'Ссылка скопирована!' : 'Отправить список в чат класса'}
            </button>
          </div>

          {/* ВЫБОР КЛАССА: 5 .. 11 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button
              type="button"
              className={`rb-chip ${selectedGrade === 0 ? 'rb-chip--active' : ''}`}
              onClick={() => selectGrade(0)}
            >
              Все классы (5–11)
            </button>
            {[5, 6, 7, 8, 9, 10, 11].map((g) => (
              <button
                key={g}
                type="button"
                className={`rb-chip ${selectedGrade === g ? 'rb-chip--active' : ''}`}
                onClick={() => selectGrade(g)}
              >
                {GRADE_LABELS[g]}
              </button>
            ))}
          </div>

          {/* ВЫБОР ПРЕДМЕТА */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {(data?.subjects || []).map((subj) => (
              <button
                key={subj.id}
                type="button"
                className={`rb-chip ${selectedSubj === subj.id ? 'rb-chip--active' : ''}`}
                onClick={() => selectSubject(subj.id)}
              >
                {subj.title}
              </button>
            ))}
          </div>

          {/* ПОИСК ПО ШКОЛЬНОЙ ПОЛКЕ + ФИЛЬТР «НА ЛЕТО» + СЧЁТЧИК ПРОЧИТАННОГО */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="rb-search-box" style={{ maxWidth: 420, flex: '1 1 240px' }}>
              <input
                type="search"
                maxLength={100}
                className="rb-search-box__input"
                style={{ padding: '10px 14px', fontSize: '0.92rem' }}
                placeholder="Найти книгу или автора в школьной программе..."
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 100))}
              />
            </div>

            <button
              type="button"
              className={`rb-chip ${onlySummer ? 'rb-chip--active' : ''}`}
              onClick={() => setOnlySummer((v) => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Sun size={15} /> Список чтения на лето
            </button>

            <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Книг в подборке: <strong style={{ color: 'var(--gold-bright)' }}>{filteredItems.length}</strong>
              {completedCount > 0 && (
                <span>
                  {' '}
                  • Прочитано полностью: <strong style={{ color: 'var(--gold-bright)' }}>{completedCount}</strong>
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="rb-container" style={{ paddingTop: 26, paddingBottom: 42 }}>
        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            Загрузка школьной программы…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rb-panel" style={{ textAlign: 'center', padding: '38px 20px' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)', marginTop: 0 }}>В этом фильтре книг не найдено</h2>
            <button
              type="button"
              className="rb-btn rb-btn--gold"
              onClick={() => {
                selectGrade(0);
                selectSubject('all');
                setOnlySummer(false);
                setQuery('');
              }}
            >
              Показать всю школьную программу
            </button>
          </div>
        ) : (
          <div className="rb-books-grid">
            {filteredItems.map(({ book, grades, note }) => (
              <div key={book.slug} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <BookCard book={book} progressPercent={progressMap[book.slug]?.percent} />
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    padding: '0 4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <span style={{ color: 'var(--gold-bright)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {grades.length === 1 ? `${grades[0]} кл.` : `${grades[0]}–${grades[grades.length - 1]} кл.`}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={note}>
                    {note}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
