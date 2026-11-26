export type CategoryId =
  | 'history'
  | 'russian-classics'
  | 'caucasus'
  | 'foreign-classics'
  | 'science'
  | 'rare-editions';

export interface CatalogBookLite {
  id: string;
  slug: string;
  t: string;        // title
  alt: string[];    // altTitles
  a: string;        // author full
  as: string;       // authorShort
  aslug: string;    // authorSlug
  ay: string;       // authorYears
  tr: string | null;// translator
  lang: string;     // language ('ru' | 'os')
  cat: CategoryId;  // category
  wy: string;       // writtenYear
  ey: string;       // editionYear
  d: string;        // description preview
  ch: number;       // chaptersCount
  w: number;        // wordsCount
  rm: number;       // readingMinutes
  rank: number;     // flagship priority
  sh?: number;      // CDN shard index (0..9 for 100,000 books)
}

export interface CatalogManifest {
  version: string;
  generatedAt: string;
  totalBooks: number;
  ossetianBooks?: number;
  totalWords: number;
  chunkSize: number;
  maxCapacity: number;
  catMap: CategoryId[];
  langMap: string[];
  shardRepos: string[];
  chunks: string[];
}

export interface HomeFeaturedPayload {
  version: string;
  totalBooks: number;
  ossetianBooks?: number;
  totalWords: number;
  maxCapacity: number;
  shardsCount: number;
  flagships: CatalogBookLite[];
  ossetian?: CatalogBookLite[];
  science: CatalogBookLite[];
  recent: CatalogBookLite[];
}

export interface AdminLiveStats {
  totalUsers: number;
  newUsers24h: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalReadingRecords: number;
  totalBookmarks: number;
  recentUsers: {
    email: string;
    createdAt: number;
    updatedAt: number;
    booksCount: number;
    bookmarksCount: number;
  }[];
  topBooks: {
    slug: string;
    readers: number;
    avgPercent: number;
  }[];
  serverTime: number;
}

export interface CategoryMeta {
  id: CategoryId;
  slug: string;
  title: string;
  subtitle: string;
  image: string;
  booksCount: number;
}

export interface ContentBlock {
  type: 'paragraph' | 'poem' | 'epigraph' | 'subtitle' | 'quote';
  text: string;
  html?: string;
  stanzas?: string[][];
}

export interface BookChapter {
  id: string;
  title: string;
  content: ContentBlock[];
}

export interface FullBookData {
  id: string;
  slug: string;
  shard?: number;
  title: string;
  altTitles: string[];
  author: string;
  authorShort: string;
  authorSlug: string;
  authorYears: string;
  translator: string | null;
  language: string;
  category: CategoryId;
  writtenYear: string;
  editionYear: string;
  description: string;
  historicalNote: string;
  sourceUrl: string;
  legalStatus: string;
  downloadAllowed: boolean;
  fb2Url: string;
  coverUrl: string;
  stats: {
    chaptersCount: number;
    wordsCount: number;
    charsCount: number;
    readingMinutes: number;
  };
  toc: { id: string; title: string }[];
  chapters: BookChapter[];
}

export type ReaderTheme = 'parchment' | 'day' | 'night';
export type ReaderFont = 'serif' | 'sans';
export type ReaderWidth = 'narrow' | 'medium' | 'wide';

export interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: number; // 14..24
  lineHeight: number; // 1.45..2.0
  fontFamily: ReaderFont;
  columnWidth: ReaderWidth;
}

export interface BookReadingProgress {
  slug: string;
  chapterIndex: number;
  scrollRatio: number; // 0..1 within chapter
  percent: number;     // 0..100 overall book
  bookmark?: {
    chapterIndex: number;
    scrollRatio: number;
    excerpt: string;
    createdAt: number;
  } | null;
  updatedAt: number;
}

export interface UserSession {
  email: string;
  token?: string;
  createdAt: number;
  mode: 'cloud';
}
