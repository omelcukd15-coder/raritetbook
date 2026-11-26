/**
 * Post-build SEO Static Pre-Renderer & PWA Offline Shell Injector — RaritetBook.ru
 * 1. Инжектирует полный список скомпилированных JS/CSS/SVG бандлов в dist/sw.js (100% работа в авиарежиме после первого визита).
 * 2. Генерирует статические HTML-страницы (HTTP 200 OK!) для /catalog, /about, /author, /privacy, /terms
 *    и топ-2000 главных книг (включая школьную классику и осетинский фонд) с уникальными <title>, <meta description>,
 *    OpenGraph, Schema.org Book JSON-LD и семантическим текстом в <div id="root"> для мгновенной индексации Яндексом и Google!
 * 3. Генерирует полный Sitemap Index (sitemap.xml -> sitemap-1..4.xml) на все 16 050 книг!
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const CATALOG_PATH = path.join(ROOT, 'archive', 'catalog', 'catalog.json');

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectAssets(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectAssets(path.join(dir, entry.name), rel));
    } else if (/\.(js|css|svg|webp)$/i.test(entry.name) && !entry.name.includes('AdminImportPage')) {
      out.push(rel);
    }
  }
  return out;
}

// 1. Инжектируем все ассеты сборки в dist/sw.js для 100% работы в авиарежиме
const swPath = path.join(DIST, 'sw.js');
if (fs.existsSync(swPath)) {
  const builtAssets = collectAssets(path.join(DIST, 'assets'), '/assets');
  const injectedList = builtAssets.map((a) => `  ${JSON.stringify(a)},`).join('\n');
  const swRaw = fs.readFileSync(swPath, 'utf8');
  fs.writeFileSync(swPath, swRaw.replace('/*__PRECACHE_ASSETS__*/', injectedList), 'utf8');
  console.log(`[PWA] Injected ${builtAssets.length} shell assets into dist/sw.js`);
}

// Читаем базовый dist/index.html как шаблон с актуальными хэшами скриптов/стилей
const baseHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

function buildSeoHtml({ title, description, canonicalPath, ogType = 'website', jsonLd = null, bodyHtml = '' }) {
  const canonicalUrl = `https://raritetbook.ru${canonicalPath}`;
  let html = baseHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escHtml(description)}" />`
    )
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${escHtml(canonicalUrl)}" />`
    )
    .replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${ogType}" />`)
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${escHtml(title)}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${escHtml(description)}" />`
    );

  if (jsonLd) {
    const safeJson = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
    html = html.replace('</head>', `  <script type="application/ld+json">${safeJson}</script>\n  </head>`);
  }

  if (bodyHtml) {
    html = html.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
  }
  return html;
}

// 2. Статические маршруты (HTTP 200 OK для поисковых роботов)
const staticPages = [
  {
    route: 'school',
    title: 'Школьная программа 5–11 класс: список литературы на лето и учебники по всем предметам — RaritetBook.ru',
    description:
      'Полная школьная библиотека 5–11 класс бесплатно онлайн и в FB2: список чтения на лето, подготовка к ОГЭ и ЕГЭ, литература, история, математика, физика, логика, география и осетинская литература.',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>Школьная программа 5–11 класс и список чтения на лето</h1><p>Все обязательные произведения ФГОС и старинные учебники по литературе, истории, математике, физике, логике, биологии, географии и русскому языку бесплатно онлайн и офлайн.</p></main>',
  },
  {
    route: 'catalog',
    title: 'Каталог старинных и классических книг (16 050 томов) — RaritetBook.ru',
    description:
      'Полный каталог открытой цифровой библиотеки RaritetBook.ru: 16 050 книг по истории России, классике, науке и осетинской литературе (ӕ) бесплатно онлайн и в FB2.',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>Каталог цифровой библиотеки RaritetBook.ru (16 050 книг)</h1><p>Русская и зарубежная классика, история России, старинные учебники, научные труды и осетинский литературный фонд (ӕ) в общественном достоянии.</p></main>',
  },
  {
    route: 'about',
    title: 'О проекте и правовой статус — RaritetBook.ru',
    description:
      'Открытая цифровая библиотека старинных и редких изданий RaritetBook.ru. Все произведения находятся в общественном достоянии (ст. 1281, 1282 ГК РФ).',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>О цифровой библиотеке RaritetBook.ru</h1><p>Бесплатный архив старинных, научных и классических книг без рекламы и платных подписок.</p></main>',
  },
  {
    route: 'author',
    title: 'Об авторе проекта — Денис Омельчук | RaritetBook.ru',
    description: 'Основатель и разработчик открытой цифровой библиотеки RaritetBook.ru — Денис Омельчук (@omelden).',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>Денис Омельчук — основатель RaritetBook.ru</h1><p>Контакты автора проекта: Telegram @omelden, сайт OmelchukDenis.ru.</p></main>',
  },
  {
    route: 'privacy',
    title: 'Политика конфиденциальности — RaritetBook.ru',
    description: 'Политика обработки данных открытой библиотеки RaritetBook.ru.',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>Политика конфиденциальности</h1></main>',
  },
  {
    route: 'terms',
    title: 'Пользовательское соглашение — RaritetBook.ru',
    description: 'Условия использования открытой цифровой библиотеки RaritetBook.ru.',
    body: '<main style="max-width:960px;margin:0 auto;padding:32px 20px"><h1>Пользовательское соглашение</h1></main>',
  },
];

for (const sp of staticPages) {
  const dir = path.join(DIST, sp.route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    buildSeoHtml({
      title: sp.title,
      description: sp.description,
      canonicalPath: `/${sp.route}`,
      bodyHtml: sp.body,
    }),
    'utf8'
  );
}

// 3. Пререндер SEO-страниц книг (HTTP 200 OK + Schema.org Book + семантический HTML) + Полный Sitemap на 16 050 URL
if (fs.existsSync(CATALOG_PATH)) {
  const catData = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const books = catData.books || [];

  // Выбираем топ-2000 самых востребованных книг (вся школьная и флагманская классика + весь осетинский литературный фонд + крупные романы)
  const prioritized = [...books].sort((a, b) => {
    const rA = Number(a.rank || 0) + (a.language === 'os' && a.authorSlug !== 'iron-arkhiv' ? 40 : 0);
    const rB = Number(b.rank || 0) + (b.language === 'os' && b.authorSlug !== 'iron-arkhiv' ? 40 : 0);
    if (rB !== rA) return rB - rA;
    return Number(b.wordsCount || 0) - Number(a.wordsCount || 0);
  });

  const prerenderSlice = prioritized.slice(0, 2000);
  for (const b of prerenderSlice) {
    const slug = b.slug;
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) continue;
    const bookDir = path.join(DIST, 'book', slug);
    fs.mkdirSync(bookDir, { recursive: true });

    const pageTitle = `${b.title} — ${b.authorShort || b.author} | Читать онлайн бесплатно и скачать FB2 — RaritetBook.ru`;
    const pageDesc = `${b.title} (${b.author}${b.editionYear ? `, ${b.editionYear}` : ''}). ${
      b.description || 'Читать полное проверенное издание онлайн бесплатно без регистрации или скачать в формате FB2.'
    }`.slice(0, 240);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Book',
      name: b.title,
      author: { '@type': 'Person', name: b.author },
      inLanguage: b.language || 'ru',
      datePublished: b.editionYear || undefined,
      isAccessibleForFree: true,
      url: `https://raritetbook.ru/book/${slug}`,
      description: pageDesc,
    };

    const semanticBody = `<main style="max-width:920px;margin:0 auto;padding:36px 20px;font-family:Georgia,serif">
      <article>
        <h1>${escHtml(b.title)}</h1>
        <p><strong>Автор:</strong> ${escHtml(b.author)}${b.editionYear ? ` • <strong>Издание:</strong> ${escHtml(b.editionYear)}` : ''}</p>
        <p>${escHtml(b.description || '')}</p>
        <p>Объём: ${Number(b.chaptersCount || 1)} гл., ${Number(b.wordsCount || 0).toLocaleString('ru-RU')} слов. Доступно бесплатно онлайн и в формате FB2 (${escHtml(b.legalStatus || 'Общественное достояние')}).</p>
        <p><a href="/read/${escHtml(slug)}" style="color:#dfc089">Читать «${escHtml(b.title)}» онлайн →</a> • <a href="/catalog" style="color:#dfc089">Каталог библиотеки</a></p>
      </article>
    </main>`;

    fs.writeFileSync(
      path.join(bookDir, 'index.html'),
      buildSeoHtml({
        title: pageTitle,
        description: pageDesc,
        canonicalPath: `/book/${slug}`,
        ogType: 'book',
        jsonLd,
        bodyHtml: semanticBody,
      }),
      'utf8'
    );
  }
  console.log(`[SEO] Pre-rendered ${prerenderSlice.length + staticPages.length} static HTML pages (HTTP 200 OK)`);

  // 4. Полный шардированный Sitemap Index для Яндекса и Google на все 16 050+ страниц!
  const SITEMAP_CHUNK = 5000;
  const sitemapFiles = [];
  const today = new Date().toISOString().slice(0, 10);

  const coreUrls = [
    '/',
    '/school',
    '/school?grade=5',
    '/school?grade=6',
    '/school?grade=7',
    '/school?grade=8',
    '/school?grade=9',
    '/school?grade=10',
    '/school?grade=11',
    '/catalog',
    '/catalog?lang=os',
    '/about',
    '/author',
    '/privacy',
    '/terms',
  ];
  const allLocs = [
    ...coreUrls.map((u) => `https://raritetbook.ru${u}`),
    ...books.map((b) => `https://raritetbook.ru/book/${b.slug}`),
  ];

  for (let i = 0; i < allLocs.length; i += SITEMAP_CHUNK) {
    const partIdx = Math.floor(i / SITEMAP_CHUNK) + 1;
    const fname = `sitemap-${partIdx}.xml`;
    const slice = allLocs.slice(i, i + SITEMAP_CHUNK);
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      slice.map((loc) => `  <url><loc>${escHtml(loc)}</loc></url>`).join('\n') +
      `\n</urlset>\n`;
    fs.writeFileSync(path.join(DIST, fname), xml, 'utf8');
    sitemapFiles.push(fname);
  }

  const indexXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sitemapFiles
      .map((f) => `  <sitemap><loc>https://raritetbook.ru/${f}</loc><lastmod>${today}</lastmod></sitemap>`)
      .join('\n') +
    `\n</sitemapindex>\n`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), indexXml, 'utf8');
  console.log(`[SEO] Generated Sitemap Index with ${allLocs.length} URLs across ${sitemapFiles.length} files`);
}
