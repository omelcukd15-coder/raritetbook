import React from 'react';
import type { CategoryId } from '../../types/library';

interface BookCoverProps {
  title: string;
  authorShort: string;
  year?: string;
  category: CategoryId;
  slug: string;
  size?: 'sm' | 'md' | 'lg';
}

const PALETTES: Record<CategoryId, { bg1: string; bg2: string; spine: string; accent: string; badge: string }> = {
  history: {
    bg1: '#2D1E16',
    bg2: '#18110D',
    spine: '#120C09',
    accent: '#C9A467',
    badge: 'ИСТОРІЯ РОССІИ',
  },
  'russian-classics': {
    bg1: '#292019',
    bg2: '#15110E',
    spine: '#100D0A',
    accent: '#D4AF72',
    badge: 'РУССКАЯ КЛАССИКА',
  },
  caucasus: {
    bg1: '#1E2422',
    bg2: '#121514',
    spine: '#0C0F0E',
    accent: '#C59E5F',
    badge: 'КАВКАЗЪ И НАРОДЫ',
  },
  'foreign-classics': {
    bg1: '#251C22',
    bg2: '#141013',
    spine: '#0E0B0E',
    accent: '#BE9860',
    badge: 'МІРОВАЯ ЛИТЕРАТУРА',
  },
  science: {
    bg1: '#1D221B',
    bg2: '#111410',
    spine: '#0B0E0B',
    accent: '#C2A063',
    badge: 'НАУКА И МЫСЛЬ',
  },
  'rare-editions': {
    bg1: '#312115',
    bg2: '#1A120C',
    spine: '#120C08',
    accent: '#D7B274',
    badge: 'РѢДКОЕ ИЗДАНІЕ',
  },
};

function hashSlug(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const BookCover: React.FC<BookCoverProps> = ({
  title,
  authorShort,
  year,
  category,
  slug,
  size = 'md',
}) => {
  const pal = PALETTES[category] || PALETTES['russian-classics'];
  const variant = hashSlug(slug) % 3;
  const cleanTitle = title.length > 58 ? title.slice(0, 55).trimEnd() + '…' : title;

  return (
    <div
      className={`rb-cover rb-cover--${size} rb-cover--v${variant}`}
      style={
        {
          '--cover-bg1': pal.bg1,
          '--cover-bg2': pal.bg2,
          '--cover-spine': pal.spine,
          '--cover-gold': pal.accent,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className="rb-cover__spine" />
      <div className="rb-cover__frame">
        <div className="rb-cover__corner rb-cover__corner--tl" />
        <div className="rb-cover__corner rb-cover__corner--tr" />
        <div className="rb-cover__corner rb-cover__corner--bl" />
        <div className="rb-cover__corner rb-cover__corner--br" />

        <div className="rb-cover__badge">{pal.badge}</div>
        <div className="rb-cover__author">{authorShort}</div>
        <div className="rb-cover__ornament">✦ ── ❖ ── ✦</div>
        <div className="rb-cover__title">{cleanTitle}</div>

        <div className="rb-cover__footer">
          <span className="rb-cover__monogram">RB</span>
          {year && <span className="rb-cover__year">{year.slice(0, 4)}</span>}
        </div>
      </div>
    </div>
  );
};
