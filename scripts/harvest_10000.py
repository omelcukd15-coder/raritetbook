#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Сверхскоростной потоковый сборщик до 10 000 полных книг (Persistent TLS Keep-Alive + Gzip + gcmlimit=50).
Использует постоянные HTTPS-соединения без повторных TLS-рукопожатий и неблокирующую запись на диск.
"""

import argparse
import gzip
import html
import http.client
import json
import re
import ssl
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = BASE_DIR / "archive"
BOOKS_DIR = ARCHIVE_DIR / "books"
CATALOG_DIR = ARCHIVE_DIR / "catalog"
PUBLIC_META_DIR = BASE_DIR / "public" / "archive-meta"

HEADERS = {
    "User-Agent": "RaritetBookKeepAliveHarvester/5.0 (https://raritetbook.ru; founder@omelchukdenis.ru) Python/3.11",
    "Accept-Encoding": "gzip",
    "Connection": "keep-alive",
}

CATEGORIES_META = [
    {"id": "history", "slug": "history", "title": "История России", "subtitle": "Летописи, исторические труды, Российская империя, мемуары и архивные памятники", "image": "/assets/images/categories/history.webp"},
    {"id": "russian-classics", "slug": "russian-classics", "title": "Русская классика", "subtitle": "Золотой фонд русской прозы, поэзии и драматургии XVIII – начала XX века", "image": "/assets/images/categories/russian-classics.webp"},
    {"id": "caucasus", "slug": "caucasus", "title": "Кавказ и народы России", "subtitle": "Исторические хроники, этнография, предания и литература о Кавказе", "image": "/assets/images/categories/caucasus.webp"},
    {"id": "foreign-classics", "slug": "foreign-classics", "title": "Зарубежная классика", "subtitle": "Мировая литература, приключения, фантастика и готика в классических переводах", "image": "/assets/images/categories/foreign-classics.webp"},
    {"id": "science", "slug": "science", "title": "Наука и философия", "subtitle": "Труды русских и мировых учёных, философия, география, психология и естествознание", "image": "/assets/images/categories/science.webp"},
    {"id": "rare-editions", "slug": "rare-editions", "title": "Редкие издания и учебники", "subtitle": "Старинные учебные курсы, педагогика, логика, публицистика и редкие дореволюционные книги", "image": "/assets/images/categories/rare-editions.webp"},
]

STREAM_JOBS = [
    ("caucasus", 500, [("Категория:Путевые заметки", None), ("Категория:Народные сказки", None), ("Категория:Этнография", "К")]),
    ("rare-editions", 800, [("Категория:Очерки", "М"), ("Категория:Очерки", "С"), ("Категория:Публицистика XIX века", None)]),
    ("science", 800, [("Категория:Критика", "М"), ("Категория:Статьи", "М"), ("Категория:Статьи", "С")]),
    ("history", 800, [("Категория:Историческая литература", "М"), ("Категория:Мемуары", "М"), ("Категория:Мемуары", "С")]),
    ("foreign-classics", 800, [("Категория:Романы", "М"), ("Категория:Романы", "С"), ("Категория:Повести", "М")]),
    ("russian-classics", 1200, [("Категория:Русская проза", "М"), ("Категория:Рассказы", "А"), ("Категория:Рассказы", "П")]),
    ("russian-classics", 1200, [("Категория:Рассказы", "С"), ("Категория:Рассказы", "Т")]),
    ("russian-classics", 1500, [("Категория:Импорт/lib.ru", "А")]),
    ("russian-classics", 1500, [("Категория:Импорт/lib.ru", "Б")]),
    ("russian-classics", 1500, [("Категория:Импорт/lib.ru", "Ж")]),
    ("russian-classics", 1500, [("Категория:Импорт/lib.ru", "Л")]),
    ("russian-classics", 1500, [("Категория:Импорт/lib.ru", "Р")]),
]

FLAGSHIP_RANKS = {
    "lermontov-mtsyri": 100, "pushkin-evgeniy-onegin": 99, "pushkin-kapitanskaya-dochka": 98,
    "lermontov-geroy-nashego-vremeni": 97, "tolstoy-hadzhi-murat": 96,
    "karamzin-istoriya-gosudarstva-rossiyskogo-tom-1": 95, "lomonosov-rossiyskaya-grammatika": 94,
    "chelpanov-uchebnik-logiki": 93, "perelman-zhivaya-matematika": 92,
    "tsiolkovskiy-vne-zemli": 91, "mendeleev-popytka-ponimaniya-efira": 90,
    "stoker-vampir-graf-drakula-1912": 89, "goethe-faust-kholodkovskiy": 88,
    "shakespeare-gamlet-kroneberg": 87, "homer-odisseya-zhukovskiy": 86,
    "khetagurov-osoba": 85, "khetagurov-iron-fandyr": 84,
    "potto-kavkazskaya-voyna-tom-5": 83, "slovo-o-polku-igoreve-zhukovskiy": 82,
    "ushinskiy-o-narodnosti-v-vospitanii": 81, "sechenov-avtobiograficheskie-zapiski": 80,
    "tsiolkovskiy-grezy-o-zemle-i-nebe": 79, "khetagurov-neuryaditsy-severnogo-kavkaza": 78,
}

TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ӕ": "ae", "æ": "ae",
}

FORBIDDEN_PREFIXES = (
    "ЭСБЕ/", "МЭСБЕ/", "РБС/", "ВЭ/", "БСЭ", "ЕЭБЕ/", "ПБЭ/", "НЭС/", "ТСД/", "Словарь",
    "Индекс:", "Страница:", "Автор:", "Викитека:", "Шаблон:", "Категория:",
    "Глава ", "Часть ", "Том ", "Песнь ", "Действие ", "Лекция ", "Примечания",
)

BAD_MARKERS = (
    "{{не окончено", "{{не завершено", "{{заготовка", "{{нет текста",
    "{{фрагмент", "{{отрывок", "{{уд-", "{{copyvio", "{{несвободн", "{{cc-by",
)

tls_local = threading.local()
ssl_ctx = ssl.create_default_context()
rate_lock = threading.Lock()
last_req_ts = 0.0


def get_conn() -> http.client.HTTPSConnection:
    conn = getattr(tls_local, "conn", None)
    if conn is None:
        conn = http.client.HTTPSConnection("ru.wikisource.org", timeout=25, context=ssl_ctx)
        tls_local.conn = conn
    return conn


def ws_api_keepalive(params: dict, retries: int = 4) -> dict:
    global last_req_ts
    path = "/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        with rate_lock:
            now = time.monotonic()
            wait = 0.02 - (now - last_req_ts)
            if wait > 0:
                time.sleep(wait)
            last_req_ts = time.monotonic()
        try:
            conn = get_conn()
            conn.request("GET", path, headers=HEADERS)
            resp = conn.getresponse()
            raw = resp.read()
            if resp.status == 429 or resp.status >= 500:
                tls_local.conn = None
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.getheader("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8"))
        except Exception:
            tls_local.conn = None
            if attempt < retries - 1:
                time.sleep(0.6 * (attempt + 1))
                continue
            raise
    raise RuntimeError("API error")


def slugify(text: str, max_len: int = 68) -> str:
    out = [TRANSLIT_MAP.get(ch, ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else "-") for ch in text.lower().strip()]
    s = re.sub(r"-+", "-", "".join(out)).strip("-")
    return (s[:max_len].rstrip("-") if len(s) > max_len else s) or "book"


def extract_otekste(wt: str):
    m = re.search(r"\{\{\s*(?:Отексте|отексте|О\s+тексте)\b", wt)
    if not m:
        return {}, wt
    start = m.start()
    depth = 0
    end = len(wt)
    i = start
    n = len(wt)
    while i < n - 1:
        two = wt[i : i + 2]
        if two == "{{": depth += 1; i += 2; continue
        if two == "}}":
            depth -= 1; i += 2
            if depth == 0:
                end = i
                break
            continue
        i += 1
    tmpl = wt[start + 2 : end - 2]
    body = wt[:start] + "\n" + wt[end:]

    fields = {}
    cur = []
    db = dk = 0
    j = 0
    tl = len(tmpl)
    while j < tl:
        two = tmpl[j : j + 2]
        if two == "{{": db += 1; cur.append(two); j += 2; continue
        if two == "}}": db = max(0, db - 1); cur.append(two); j += 2; continue
        if two == "[[": dk += 1; cur.append(two); j += 2; continue
        if two == "]]": dk = max(0, dk - 1); cur.append(two); j += 2; continue
        ch = tmpl[j]
        if ch == "|" and db == 0 and dk == 0:
            part = "".join(cur).strip()
            if "=" in part:
                k, v = part.split("=", 1)
                fields[k.strip().upper()] = v.strip()
            cur = []
        else:
            cur.append(ch)
        j += 1
    part = "".join(cur).strip()
    if "=" in part:
        k, v = part.split("=", 1)
        fields[k.strip().upper()] = v.strip()
    return fields, body


def clean_inline(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)
    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)
    for _ in range(2):
        ns = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if ns == s:
            break
        s = ns
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s).replace("'''", "").replace("''", "")).strip()


def verify_pd(wt: str, fields: dict):
    low = wt.lower()
    for bm in BAD_MARKERS:
        if bm in low:
            return False, None
    if not fields:
        return False, None

    lic = fields.get("ЛИЦЕНЗИЯ", "")
    raw_author = fields.get("АВТОР", "")
    raw_trans = fields.get("ПЕРЕВОДЧИК", "")
    raw_pub = " ".join([fields.get("ДАТАПУБЛИКАЦИИ", ""), fields.get("ПЕРВАЯПУБЛИКАЦИЯ", ""), fields.get("ДАТАСОЗДАНИЯ", ""), fields.get("ГОД", "")])
    years = [int(y) for y in re.findall(r"\b(1[5-9]\d{2}|20[0-2]\d)\b", raw_pub)]
    cat_years = [int(y) for y in re.findall(r"Категория:[^\]]*?\b(1[5-9]\d{2}|20[0-2]\d)\s+года", wt)]
    all_y = years + cat_years
    min_y = min(all_y) if all_y else None

    a_deaths = [int(y) for y in re.findall(r"[—–-]\s*(1[6-9]\d{2}|20\d{2})", raw_author)]
    t_deaths = [int(y) for y in re.findall(r"[—–-]\s*(1[6-9]\d{2}|20\d{2})", raw_trans)]
    if any(d > 1951 for d in a_deaths) or any(d > 1951 for d in t_deaths):
        return False, None

    is_pd = ("pd" in lic.lower()) or ("од-" in lic.lower()) or ("общественное достояние" in low) or ("pd-" in low)
    if raw_trans:
        if not ((t_deaths and max(t_deaths) <= 1948) or (min_y and min_y <= 1942) or (is_pd and (min_y is None or min_y <= 1942))):
            return False, None
    else:
        if not ((a_deaths and max(a_deaths) <= 1951) or (min_y and min_y <= 1946) or (is_pd and (min_y is None or min_y <= 1948))):
            return False, None

    return True, {"year": str(min_y) if min_y else "XIX — нач. XX в.", "lic": lic or "PD-rus"}


def parse_body_fast(body: str, fallback_title: str):
    s = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    s = re.sub(r"\[\[\s*(?:Категория|Category|Файл|File|Изображение|Image)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)

    poems = []
    def keep_poem(m):
        poems.append(m.group(1))
        return f"\n\n@@POEM_{len(poems)-1}@@\n\n"
    s = re.sub(r"<poem[^>]*>(.*?)</poem>", keep_poem, s, flags=re.I | re.S)

    for _ in range(2):
        ns = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if ns == s:
            break
        s = ns

    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "\n", s)
    s = html.unescape(s).replace("'''", "").replace("''", "")

    items = []
    for rb in re.split(r"\n\s*\n+", s):
        rb = rb.strip()
        if not rb:
            continue
        mp = re.fullmatch(r"@@POEM_(\d+)@@", rb)
        if mp:
            praw = html.unescape(re.sub(r"<[^>]+>", "", poems[int(mp.group(1))]))
            stanzas = [[vl.strip() for vl in ch.splitlines() if vl.strip()] for ch in re.split(r"\n\s*\n+", praw.strip())]
            stanzas = [st for st in stanzas if st]
            if stanzas:
                items.append({"type": "poem", "stanzas": stanzas, "text": "\n\n".join("\n".join(st) for st in stanzas)})
            continue
        mh = re.match(r"^(=+)\s*(.+?)\s*\1$", rb)
        if mh:
            ht = mh.group(2).strip()
            if ht and ht.lower() not in ("примечания", "сноски", "литература"):
                items.append({"type": "h2", "text": ht})
            continue
        txt = re.sub(r"\s+", " ", rb).strip()
        if txt and not ("общественное достояние" in txt.lower() and len(txt) < 240):
            items.append({"type": "paragraph", "text": txt})

    if not items:
        return [], 0, 0

    full_txt = " ".join(x.get("text", "") for x in items)
    words = len(full_txt.split())
    if words < 400:
        return [], 0, 0
    if (full_txt.count("ѣ") + full_txt.count("Ѣ")) > len(full_txt) * 0.003:
        return [], 0, 0
    # Быстрая проверка доли кириллицы на срезе первых 2000 символов
    sample = full_txt[:2000]
    cyr = sum(1 for c in sample if "а" <= c <= "я" or "А" <= c <= "Я" or c in "ёЁ")
    lat = sum(1 for c in sample if "a" <= c <= "z" or "A" <= c <= "Z")
    if cyr < (cyr + lat) * 0.72:
        return [], 0, 0

    h2_cnt = sum(1 for x in items if x["type"] == "h2")
    chapters = []
    if h2_cnt >= 2:
        ct, cc = "Глава 1", []
        for x in items:
            if x["type"] == "h2":
                if cc:
                    chapters.append({"id": f"chapter-{len(chapters)+1}", "title": ct, "content": cc})
                    cc = []
                ct = x["text"]
            else:
                cc.append(x)
        if cc:
            chapters.append({"id": f"chapter-{len(chapters)+1}", "title": ct, "content": cc})
    else:
        content = [x for x in items if x["type"] != "h2"]
        if len(content) > 85:
            chapters = [{"id": f"chapter-{idx+1}", "title": f"Часть {idx+1}", "content": content[i : i + 55]} for idx, i in enumerate(range(0, len(content), 55))]
        else:
            chapters = [{"id": "chapter-1", "title": fallback_title, "content": content}]
    return chapters, words, len(full_txt)


def xml_esc(s: str) -> str:
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def make_fb2(meta: dict, chapters: list) -> str:
    parts = [p for p in meta["author"].split() if p]
    fn, ln = (parts[0] if parts else meta["author"]), (parts[-1] if len(parts) > 1 else "")
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">',
        f"<description><title-info><genre>antique</genre><author><first-name>{xml_esc(fn)}</first-name><last-name>{xml_esc(ln)}</last-name></author>",
        f"<book-title>{xml_esc(meta['title'])}</book-title><lang>ru</lang></title-info></description><body>",
    ]
    for ch in chapters:
        out.append(f'<section id="{xml_esc(ch["id"])}"><title><p>{xml_esc(ch["title"])}</p></title>')
        for b in ch["content"]:
            if b["type"] == "poem":
                out.append("<poem>" + "".join("<stanza>" + "".join(f"<v>{xml_esc(v)}</v>" for v in st) + "</stanza>" for st in b.get("stanzas", [])) + "</poem>")
            else:
                out.append(f"<p>{xml_esc(b['text'])}</p>")
        out.append("</section>")
    out.append("</body></FictionBook>")
    return "\n".join(out)


def short_name(full: str) -> str:
    clean = re.sub(r"\([^)]*\)", "", full).strip()
    p = [x for x in clean.split() if x]
    if len(p) == 3:
        return f"{p[0][0]}. {p[1][0]}. {p[2]}"
    if len(p) == 2:
        return f"{p[0][0]}. {p[1]}"
    return clean or "Неизвестный автор"


def rebuild_indexes(catalog_books: list):
    PUBLIC_META_DIR.mkdir(parents=True, exist_ok=True)
    cat_counts = {}
    for b in catalog_books:
        cat_counts[b["category"]] = cat_counts.get(b["category"], 0) + 1
    cats_out = [{**cm, "booksCount": cat_counts.get(cm["id"], 0)} for cm in CATEGORIES_META]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    (CATALOG_DIR / "catalog.json").write_text(
        json.dumps({"version": f"3.0.{len(catalog_books)}", "generatedAt": now_iso, "totalBooks": len(catalog_books), "books": catalog_books}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (CATALOG_DIR / "categories.json").write_text(json.dumps(cats_out, ensure_ascii=False, indent=2), encoding="utf-8")

    lite = [{
        "id": b["id"], "slug": b["slug"], "t": b["title"], "alt": b.get("altTitles", []),
        "a": b["author"], "as": b["authorShort"], "aslug": b["authorSlug"], "ay": b.get("authorYears", ""),
        "tr": b.get("translator"), "lang": b.get("language", "ru"), "cat": b["category"],
        "wy": b.get("writtenYear", ""), "ey": b.get("editionYear", ""), "d": b.get("description", "")[:65],
        "ch": b.get("chaptersCount", 1), "w": b.get("wordsCount", 0), "rm": b.get("readingMinutes", 5),
        "rank": FLAGSHIP_RANKS.get(b["slug"], 0),
    } for b in catalog_books]
    lite.sort(key=lambda x: (-x["rank"], x["t"]))

    (PUBLIC_META_DIR / "catalog-lite.json").write_text(
        json.dumps({"version": f"3.0.{len(lite)}", "total": len(lite), "books": lite}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (PUBLIC_META_DIR / "categories.json").write_text(json.dumps(cats_out, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=10000)
    args = ap.parse_args()

    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)

    # Собираем ВСЕ уже сохранённые на диск книги (чтобы ничего не потерять после перезапусков!)
    catalog_books = []
    seen_slugs = set()
    seen_urls = set()

    for bj_path in BOOKS_DIR.glob("*/*/book.json"):
        try:
            m = json.loads(bj_path.read_text(encoding="utf-8"))
            st = m.get("stats", {})
            rel = f"/archive/books/{m['authorSlug']}/{m['slug']}"
            catalog_books.append({
                "id": m["id"], "slug": m["slug"], "title": m["title"], "altTitles": m.get("altTitles", []),
                "author": m["author"], "authorShort": m["authorShort"], "authorSlug": m["authorSlug"],
                "authorYears": m.get("authorYears", ""), "translator": m.get("translator"),
                "language": m.get("language", "ru"), "category": m["category"],
                "writtenYear": m.get("writtenYear", ""), "editionYear": m.get("editionYear", ""),
                "description": m.get("description", "")[:90], "historicalNote": m.get("historicalNote", "")[:120],
                "legalStatus": m.get("legalStatus", ""), "sourceUrl": m.get("sourceUrl", ""),
                "downloadAllowed": True, "bookUrl": f"{rel}/book.json", "fb2Url": f"{rel}/original.fb2",
                "coverUrl": f"{rel}/cover.webp", "chaptersCount": st.get("chaptersCount", 1),
                "wordsCount": st.get("wordsCount", 0), "charsCount": st.get("charsCount", 0),
                "readingMinutes": st.get("readingMinutes", 5),
            })
            seen_slugs.add(m["slug"])
            seen_urls.add(m.get("sourceUrl", ""))
        except Exception:
            continue

    state_lock = threading.Lock()
    start_count = len(catalog_books)
    t0 = time.time()
    print(f"Keep-Alive старт: на диске уже {start_count} книг, цель = {args.target}.", flush=True)

    def worker(job):
        cat_id, job_quota, wcats = job
        added_here = 0
        for wc, start_prefix in wcats:
            gcmcont = None
            first_req = True
            while added_here < job_quota:
                with state_lock:
                    if len(catalog_books) >= args.target:
                        return
                params = {
                    "action": "query",
                    "generator": "categorymembers",
                    "gcmtitle": wc,
                    "gcmnamespace": 0,
                    "gcmlimit": 15,
                    "prop": "revisions",
                    "rvslots": "main",
                    "rvprop": "content|size",
                    "format": "json",
                }
                if first_req and start_prefix:
                    params["gcmstartsortkeyprefix"] = start_prefix
                first_req = False
                if gcmcont:
                    params["gcmcontinue"] = gcmcont
                try:
                    data = ws_api_keepalive(params)
                except Exception:
                    break

                pages = list(data.get("query", {}).get("pages", {}).values())
                for pobj in pages:
                    wtitle = pobj.get("title", "")
                    if not wtitle or "/" in wtitle or "(ДО)" in wtitle or any(wtitle.startswith(p) for p in FORBIDDEN_PREFIXES):
                        continue
                    revs = pobj.get("revisions")
                    if not revs:
                        continue
                    rev0 = revs[0]
                    sz = rev0.get("size", 0)
                    if sz < 3800 or sz > 320000:
                        continue
                    wt = rev0.get("slots", {}).get("main", {}).get("*", "")
                    if not wt:
                        continue

                    src_url = f"https://ru.wikisource.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
                    with state_lock:
                        if len(catalog_books) >= args.target:
                            return
                        if src_url in seen_urls:
                            continue

                    fields, body = extract_otekste(wt)
                    ok, info = verify_pd(wt, fields)
                    if not ok:
                        continue

                    raw_title = clean_inline(fields.get("НАЗВАНИЕ", "")) or re.sub(r"\s*\([^)]+\)\s*$", "", wtitle).strip()
                    raw_sub = clean_inline(fields.get("ПОДЗАГОЛОВОК", ""))
                    raw_auth = fields.get("АВТОР", "")
                    ym = re.search(r"\((\d{4}\s*[—–-]\s*\d{4})\)", raw_auth)
                    ayears = ym.group(1).replace("-", "–").replace("—", "–") if ym else ""
                    clean_auth = clean_inline(re.sub(r"\([^)]*\)", "", raw_auth)).strip()
                    if not clean_auth:
                        mp = re.search(r"\(([^);]+)\)\s*$", wtitle)
                        clean_auth = mp.group(1).strip() if mp else "Неизвестный автор"

                    translator = clean_inline(fields.get("ПЕРЕВОДЧИК", "")) or None
                    orig_lang = clean_inline(fields.get("ЯЗЫКОРИГИНАЛА", ""))
                    final_cat = "foreign-classics" if (cat_id == "russian-classics" and (translator or orig_lang)) else cat_id

                    chapters, words, chars = parse_body_fast(body, raw_title)
                    if not chapters:
                        continue

                    aslug = slugify(clean_auth.split()[-1] if clean_auth != "Неизвестный автор" else "anonim", 28)
                    bslug = slugify(f"{aslug}-{raw_title}", 64)
                    pid = pobj.get("pageid", 0)

                    with state_lock:
                        if len(catalog_books) >= args.target or src_url in seen_urls:
                            continue
                        if bslug in seen_slugs:
                            bslug = f"{bslug}-{pid}"
                        if bslug in seen_slugs:
                            continue
                        seen_slugs.add(bslug)
                        seen_urls.add(src_url)

                    sbib = clean_inline(fields.get("ИСТОЧНИК", ""))
                    first_p = chapters[0]["content"][0]["text"][:180] if chapters[0]["content"] else ""
                    desc = (raw_sub + ". " + first_p).strip(". ")[:200] or f"Произведение «{raw_title}» ({clean_auth})."
                    hnote = f"Источник архива: {sbib[:200]}." if sbib else f"Проверенное издание ({info['year']})."
                    legal = f"Общественное достояние (ст. 1281, 1282 ГК РФ; {info['lic']}; {info['year']})"
                    rmin = max(3, round(words / 180))
                    ashort = short_name(clean_auth)
                    rel = f"/archive/books/{aslug}/{bslug}"

                    payload = {
                        "id": bslug, "slug": bslug, "title": raw_title, "altTitles": [raw_sub] if raw_sub else [],
                        "author": clean_auth, "authorShort": ashort, "authorSlug": aslug, "authorYears": ayears,
                        "translator": translator, "language": "ru", "category": final_cat,
                        "writtenYear": clean_inline(fields.get("ДАТАСОЗДАНИЯ", "")) or info["year"],
                        "editionYear": info["year"], "description": desc, "historicalNote": hnote,
                        "sourceUrl": src_url, "legalStatus": legal, "downloadAllowed": True,
                        "fb2Url": f"{rel}/original.fb2", "coverUrl": f"{rel}/cover.webp",
                        "stats": {"chaptersCount": len(chapters), "wordsCount": words, "charsCount": chars, "readingMinutes": rmin},
                        "toc": [{"id": c["id"], "title": c["title"]} for c in chapters],
                        "chapters": chapters,
                    }

                    bdir = BOOKS_DIR / aslug / bslug
                    bdir.mkdir(parents=True, exist_ok=True)
                    (bdir / "book.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                    (bdir / "original.fb2").write_text(make_fb2(payload, chapters), encoding="utf-8")

                    cat_entry = {
                        "id": bslug, "slug": bslug, "title": raw_title, "altTitles": payload["altTitles"],
                        "author": clean_auth, "authorShort": ashort, "authorSlug": aslug, "authorYears": ayears,
                        "translator": translator, "language": "ru", "category": final_cat,
                        "writtenYear": payload["writtenYear"], "editionYear": info["year"],
                        "description": desc[:90], "historicalNote": hnote[:120], "legalStatus": legal,
                        "sourceUrl": src_url, "downloadAllowed": True, "bookUrl": f"{rel}/book.json",
                        "fb2Url": f"{rel}/original.fb2", "coverUrl": f"{rel}/cover.webp",
                        "chaptersCount": len(chapters), "wordsCount": words, "charsCount": chars, "readingMinutes": rmin,
                    }

                    snapshot = None
                    with state_lock:
                        if len(catalog_books) < args.target:
                            catalog_books.append(cat_entry)
                            added_here += 1
                            cur_total = len(catalog_books)
                            if cur_total % 1000 == 0:
                                elapsed = max(1.0, time.time() - t0)
                                speed = (cur_total - start_count) / elapsed
                                print(f"  --> В архиве {cur_total}/{args.target} книг ({speed:.1f} кн/сек)", flush=True)
                                snapshot = list(catalog_books)
                    if snapshot is not None:
                        rebuild_indexes(snapshot)

                gcmcont = data.get("continue", {}).get("gcmcontinue")
                if not gcmcont:
                    break

    with ThreadPoolExecutor(max_workers=12) as ex:
        list(ex.map(worker, STREAM_JOBS))

    rebuild_indexes(catalog_books)
    total_w = sum(b.get("wordsCount", 0) for b in catalog_books)
    print(f"\n=== ФИНИШ! Собрано полных книг: {len(catalog_books)}, всего слов: {total_w:,} ===", flush=True)


if __name__ == "__main__":
    main()
