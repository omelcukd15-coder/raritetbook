import React from 'react';
import { Link } from 'react-router-dom';
import type { CatalogBookLite } from '../../types/library';
import { BookCover } from '../BookCover/BookCover';

interface BookCardProps {
  book: CatalogBookLite;
  progressPercent?: number;
}

export const BookCard: React.FC<BookCardProps> = ({ book, progressPercent }) => {
  return (
    <Link to={`/book/${book.slug}`} className="rb-book-card">
      <BookCover
        title={book.t}
        authorShort={book.as}
        year={book.ey || book.wy}
        category={book.cat}
        slug={book.slug}
      />
      <div className="rb-book-card__meta">
        <div className="rb-book-card__title" title={book.t}>
          {book.t}
        </div>
        <div className="rb-book-card__author">{book.as}</div>
      </div>

      {typeof progressPercent === 'number' && progressPercent > 0 ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Прогресс</span>
            <span style={{ color: 'var(--gold-bright)' }}>{progressPercent}%</span>
          </div>
          <div className="rb-progress-track">
            <div className="rb-progress-fill" style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </div>
        </div>
      ) : (
        <div className="rb-book-card__foot">
          <span>{book.ey ? book.ey.slice(0, 4) : 'Архив'}</span>
          <span>~{book.rm} мин</span>
        </div>
      )}
    </Link>
  );
};
