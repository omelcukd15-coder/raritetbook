import React, { useEffect, useRef, useState } from 'react';
import { Download, Send, X } from 'lucide-react';

interface QuoteCardModalProps {
  quote: string;
  bookTitle: string;
  authorShort: string;
  slug: string;
  onClose: () => void;
}

export const QuoteCardModal: React.FC<QuoteCardModalProps> = ({
  quote,
  bookTitle,
  authorShort,
  slug,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 1080;
    const H = 1080;
    canvas.width = W;
    canvas.height = H;

    // Фон старинной бумаги с тёмным паспарту
    ctx.fillStyle = '#181411';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#E5D2B2';
    ctx.fillRect(54, 54, W - 108, H - 108);

    // Декоративная двойная золотая рамка
    ctx.strokeStyle = '#8C6B37';
    ctx.lineWidth = 4;
    ctx.strokeRect(76, 76, W - 152, H - 152);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(88, 88, W - 176, H - 176);

    // Верхний колонтитул
    ctx.fillStyle = '#6B5129';
    ctx.font = '600 26px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦   R A R I T E T B O O K . R U   ✦', W / 2, 148);

    // Разбивка цитаты по строкам
    const trimmed = quote.length > 420 ? quote.slice(0, 417).trimEnd() + '…' : quote;
    const words = `«${trimmed}»`.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    const maxWidth = W - 280;
    const fontSize = trimmed.length > 250 ? 36 : 44;
    ctx.font = `italic ${fontSize}px Georgia, serif`;

    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const lineHeight = fontSize * 1.48;
    const blockHeight = lines.length * lineHeight;
    let startY = Math.max(250, (H - blockHeight) / 2);

    ctx.fillStyle = '#241A11';
    for (const ln of lines.slice(0, 12)) {
      ctx.fillText(ln, W / 2, startY);
      startY += lineHeight;
    }

    // Автор и произведение внизу
    ctx.fillStyle = '#5A4324';
    ctx.font = 'bold 32px Georgia, serif';
    ctx.fillText(`— ${authorShort}`, W / 2, H - 195);

    ctx.fillStyle = '#3B2C1A';
    ctx.font = '28px Georgia, serif';
    const shortBook = bookTitle.length > 52 ? bookTitle.slice(0, 49) + '…' : bookTitle;
    ctx.fillText(`«${shortBook}»`, W / 2, H - 148);

    ctx.fillStyle = '#7C623C';
    ctx.font = '21px sans-serif';
    ctx.fillText('Старинные книги. Вечные знания • raritetbook.ru', W / 2, H - 108);

    setDataUrl(canvas.toDataURL('image/png'));
  }, [quote, bookTitle, authorShort]);

  const shareTelegram = () => {
    const url = `https://raritetbook.ru/book/${slug}`;
    const text = `«${quote.slice(0, 260)}»\n— ${authorShort}, «${bookTitle}»`;
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <div className="rb-modal-overlay" onClick={onClose}>
      <div className="rb-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', margin: 0 }}>
            Открытка с цитатой
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {dataUrl && (
            <a
              href={dataUrl}
              download={`raritetbook-quote-${slug}.png`}
              className="rb-btn rb-btn--gold"
              style={{ flex: 1 }}
            >
              <Download size={16} /> Скачать открытку
            </a>
          )}
          <button type="button" onClick={shareTelegram} className="rb-btn" style={{ flex: 1 }}>
            <Send size={16} /> В Telegram
          </button>
        </div>
      </div>
    </div>
  );
};
