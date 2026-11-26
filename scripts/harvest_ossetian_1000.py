#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Специальный сборщик фонда на осетинском языке (ирон / дигорон æвзаг, lang='os') ~1 050 книг.
Источники (100% легально по ГК РФ):
1. Осетинский раздел Викитеки (https://wikisource.org, Category:Ирон) — ~560 произведений классиков осетинской литературы
   (Хетӕгкаты Къоста, Гӕдиаты Секъа, Коцойты Арсен, Багъӕраты Созыр, Гуырдзыбеты Бласка, Малиты Геуӕрги,
    Тогуызты Газакк / Илас Ӕрнигон, Кочысаты Розӕ, Кочысаты Мухарбег, Калоты Хазби, Елехъоты Мурат — все авторы ушли из жизни до 1945 г., ст. 1281 ГК РФ).
2. Осетинский нартский эпос («Нарты кадджытӕ») с ironau.ru — народный фольклор (ст. 1259 п. 6 ГК РФ — общественное достояние).
3. Крупные исторические, биографические, краеведческие и научные очерки на осетинском языке из os.wikipedia.org
   (строго без списков/заготовок, с высокой плотностью осетинской кириллицы ӕ/Ӕ, по открытой лицензии CC BY-SA 4.0, ст. 1286.1 ГК РФ).
"""

import gzip
import html
import http.client
import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = BASE_DIR / "archive"
BOOKS_DIR = ARCHIVE_DIR / "books"
SHARD1_BOOKS_DIR = ARCHIVE_DIR / "shard-1" / "books"
CATALOG_DIR = ARCHIVE_DIR / "catalog"
PUBLIC_META_DIR = BASE_DIR / "public" / "archive-meta"
SHARDS_META_DIR = PUBLIC_META_DIR / "shards"

CHUNK_SIZE = 5000
SHARD_REPOS = [
    "https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books/main",
    "https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-2/main",
]
CAT_ORDER = ["history", "russian-classics", "caucasus", "foreign-classics", "science", "rare-editions"]
CAT_TO_IDX = {c: i for i, c in enumerate(CAT_ORDER)}
LANG_ORDER = ["ru", "os"]
LANG_TO_IDX = {l: i for i, l in enumerate(LANG_ORDER)}

CATEGORIES_META = [
    {"id": "history", "slug": "history", "title": "История России", "subtitle": "Летописи, исторические труды, Российская империя, мемуары и архивные памятники", "image": "/assets/images/categories/history.webp"},
    {"id": "russian-classics", "slug": "russian-classics", "title": "Русская классика", "subtitle": "Золотой фонд русской прозы, поэзии и драматургии XVIII – начала XX века", "image": "/assets/images/categories/russian-classics.webp"},
    {"id": "caucasus", "slug": "caucasus", "title": "Кавказ и Осетия", "subtitle": "Осетинская классика в оригинале (ӕ), Нартский эпос, хроники и этнография Кавказа", "image": "/assets/images/categories/caucasus.webp"},
    {"id": "foreign-classics", "slug": "foreign-classics", "title": "Зарубежная классика", "subtitle": "Мировая литература, приключения, фантастика и готика в классических переводах", "image": "/assets/images/categories/foreign-classics.webp"},
    {"id": "science", "slug": "science", "title": "Наука и философия", "subtitle": "Труды русских и мировых учёных, философия, география, психология и естествознание", "image": "/assets/images/categories/science.webp"},
    {"id": "rare-editions", "slug": "rare-editions", "title": "Редкие издания и учебники", "subtitle": "Старинные учебные курсы, педагогика, логика, публицистика и редкие дореволюционные книги", "image": "/assets/images/categories/rare-editions.webp"},
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

# Годы жизни классиков осетинской литературы (все перешли в общественное достояние по ст. 1281 ГК РФ)
OS_AUTHORS_META = {
    "Хетӕгкаты Къоста": ("1859–1906", "Къ. Хетӕгкаты", "khetagkaty", 94),
    "Гӕдиаты Секъа": ("1855–1915", "С. Гӕдиаты", "gaediaty", 91),
    "Коцойты Арсен": ("1872–1944", "А. Коцойты", "kotsoyty", 92),
    "Багъӕраты Созыр": ("1888–1928", "С. Багъӕраты", "baghaeraty", 86),
    "Тогуызты Газакк": ("1888–1938", "Г. Тогуызты (Илас Ӕрнигон)", "toguyzty", 85),
    "Малиты Геуӕрги": ("1886–1942", "Г. Малиты", "mality", 86),
    "Гуырдзыбеты Бласка": ("1868–1905", "Б. Гуырдзыбеты", "guyrdzybety", 85),
    "Калоты Хазби": ("1921–1943", "Х. Калоты", "kaloty", 82),
    "Кочысаты Мухарбег": ("1920–1944", "М. Кочысаты", "kochysaty", 82),
    "Елехъоты Мурат": ("1923–1943", "М. Елехъоты", "elekhoty", 80),
    "Кочысаты Розӕ": ("1888–1910", "Р. Кочысаты", "kochysaty-roza", 84),
}

TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ӕ": "ae", "æ": "ae",
}

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def norm_os(text: str) -> str:
    """Приводит латинскую æ/Æ к эталонной осетинской кириллической ӕ/Ӕ (U+04D5/U+04D4)."""
    return text.replace("æ", "ӕ").replace("Æ", "Ӕ")


def slugify(text: str, max_len: int = 64) -> str:
    t = norm_os(text).lower().strip()
    out = [TRANSLIT_MAP.get(ch, ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else "-") for ch in t]
    s = re.sub(r"-+", "-", "".join(out)).strip("-")
    return (s[:max_len].rstrip("-") if len(s) > max_len else s) or "iron-book"


def api_get(host: str, params: dict) -> dict:
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "RaritetBookOssetianHarvester/6.0 (https://raritetbook.ru)", "Accept-Encoding": "gzip"},
            )
            with urllib.request.urlopen(req, timeout=20, context=ssl_ctx) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except Exception:
            time.sleep(0.8 * (attempt + 1))
    return {}


def extract_balanced_templates(wt: str, names_pattern: str):
    """Извлекает вложенные шаблоны {{Poemx|...}} или {{header|...}} со сбалансированными скобками."""
    extracted = []
    out = []
    i = 0
    n = len(wt)
    rx = re.compile(r"^\{\{\s*(?:" + names_pattern + r")\b", re.I)
    while i < n:
        if wt[i : i + 2] == "{{" and rx.match(wt[i:]):
            depth = 0
            j = i
            while j < n - 1:
                two = wt[j : j + 2]
                if two == "{{":
                    depth += 1
                    j += 2
                    continue
                if two == "}}":
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                    continue
                j += 1
            inner = wt[i + 2 : j - 2]
            idx = len(extracted)
            extracted.append(inner)
            out.append(f"\n\n@@TMPL_{idx}@@\n\n")
            i = j
        else:
            out.append(wt[i])
            i += 1
    return "".join(out), extracted


def parse_ws_ossetian_work(title_raw: str, wt: str):
    wt = norm_os(wt)
    # 1. Вырезаем {{header|...}}
    wt_no_hdr, hdrs = extract_balanced_templates(wt, r"header")
    meta = {}
    if hdrs:
        for line in hdrs[0].split("\n"):
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.lstrip("| ").strip().lower()
                meta[k] = v.strip()

    # 2. Сохраняем стихотворные блоки {{Poemx|...}}, {{poem|...}} и <poem>...</poem>
    poems = []

    def save_poem_text(ptext: str) -> str:
        idx = len(poems)
        poems.append(ptext)
        return f"\n\n@@POEM_{idx}@@\n\n"

    wt_step, poem_tmpls = extract_balanced_templates(wt_no_hdr, r"poemx|poem")
    for idx_t, pbody in enumerate(poem_tmpls):
        parts = pbody.split("|")
        # {{Poemx|Заголовок|Строфы...}} или {{Poemx|Строфы...}}
        if len(parts) >= 3:
            poem_content = parts[2]
        elif len(parts) == 2:
            poem_content = parts[1]
        else:
            poem_content = pbody
        wt_step = wt_step.replace(f"@@TMPL_{idx_t}@@", save_poem_text(poem_content))

    wt_step = re.sub(r"<poem[^>]*>(.*?)</poem>", lambda m: save_poem_text(m.group(1)), wt_step, flags=re.I | re.S)

    # 3. Очищаем вики-разметку
    s = re.sub(r"<!--.*?-->", "", wt_step, flags=re.S)
    s = re.sub(r"\[\[\s*(?:Category|Категори|Категория|File|Файл|Image)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)
    s = re.sub(r"\{\{\s*h\s*\|\s*level=\d+\s*\|\s*([^{}|]+)\}\}", r"\n\n== \1 ==\n\n", s, flags=re.I)
    for _ in range(4):
        ns = re.sub(r"\{\{(?:center|right|small|smaller|larger)\|([^{}|]*?)\}\}", r"\1", s, flags=re.I | re.S)
        ns = re.sub(r"\{\{[^{}]*\}\}", "", ns, flags=re.S)
        if ns == s:
            break
        s = ns
    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "\n", s)
    s = html.unescape(s).replace("'''", "").replace("''", "")

    blocks = []
    for chunk in re.split(r"\n\s*\n+", s):
        chunk = chunk.strip()
        if not chunk:
            continue
        mp = re.fullmatch(r"@@POEM_(\d+)@@", chunk)
        if mp:
            praw = poems[int(mp.group(1))]
            praw = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", praw)
            praw = html.unescape(re.sub(r"<[^>]+>", "", praw)).replace("'''", "").replace("''", "")
            stanzas = [
                [vl.strip() for vl in st.splitlines() if vl.strip() and not vl.strip().startswith("{{")]
                for st in re.split(r"\n\s*\n+", praw.strip())
            ]
            stanzas = [st for st in stanzas if st]
            if stanzas:
                blocks.append({
                    "type": "poem",
                    "stanzas": stanzas,
                    "text": "\n\n".join("\n".join(st) for st in stanzas),
                })
            continue
        mh = re.match(r"^(=+)\s*(.+?)\s*\1$", chunk)
        if mh:
            blocks.append({"type": "subtitle", "text": mh.group(2).strip()})
            continue
        clean_p = re.sub(r"\s+", " ", chunk).strip()
        if clean_p and len(clean_p) >= 2:
            blocks.append({"type": "paragraph", "text": clean_p})

    full_txt = "\n".join(b["text"] for b in blocks)
    words = len(full_txt.split())
    if words < 28:  # Отсекаем пустые страницы-оглавления из 1–2 строк
        return None

    clean_title = norm_os(meta.get("title", "") or title_raw)
    clean_title = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", clean_title)
    clean_title = re.sub(r"\s*\([^)]+\)\s*$", "", clean_title).strip() or norm_os(title_raw)
    if "/" in title_raw:
        sub_part = norm_os(title_raw.split("/", 1)[1]).strip()
        clean_title = f"{clean_title} — {sub_part}"

    raw_author = norm_os(meta.get("author", "")).strip()
    raw_author = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", raw_author).strip()
    if not raw_author:
        m_par = re.search(r"\(([^),]+)", norm_os(title_raw))
        if m_par:
            cand = m_par.group(1).strip()
            for full_a in OS_AUTHORS_META:
                if full_a.startswith(cand):
                    raw_author = full_a
                    break
    if not raw_author:
        raw_author = "Ирон классикӕ"

    year = re.sub(r"[^\d–-]", "", meta.get("year", ""))[:12] or "XIX–XX ӕнус"
    notes = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", norm_os(meta.get("notes", "")))
    notes = re.sub(r"<[^>]+>|\[\[|\]\]", "", notes).strip()

    # Разбивка крупных поэм и пьес на главы
    chapters = []
    sub_count = sum(1 for b in blocks if b["type"] == "subtitle")
    if sub_count >= 2 and words > 400:
        cur_t, cur_c = "Сӕр 1", []
        for b in blocks:
            if b["type"] == "subtitle":
                if cur_c:
                    chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
                    cur_c = []
                cur_t = b["text"][:120]
            else:
                cur_c.append(b)
        if cur_c:
            chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
    elif len(blocks) > 65:
        for idx, off in enumerate(range(0, len(blocks), 45)):
            chapters.append({"id": f"chapter-{idx+1}", "title": f"Хай {idx+1}", "content": blocks[off : off + 45]})
    else:
        chapters = [{"id": "chapter-1", "title": clean_title, "content": blocks}]

    return {
        "title": clean_title,
        "author": raw_author,
        "year": year,
        "notes": notes,
        "chapters": chapters,
        "words": words,
        "chars": len(full_txt),
    }


def harvest_wikisource_ossetian() -> list:
    print("1/3 Сбор классики осетинской литературы из Wikisource (Category:Ирон)...", flush=True)
    results = []
    gcmcont = None
    while True:
        params = {
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": "Category:Ирон",
            "gcmnamespace": 0,
            "gcmlimit": 50,
            "prop": "revisions",
            "rvslots": "main",
            "rvprop": "content",
            "format": "json",
        }
        if gcmcont:
            params["gcmcontinue"] = gcmcont
        data = api_get("wikisource.org", params)
        pages = list(data.get("query", {}).get("pages", {}).values())
        for pg in pages:
            wtitle = pg.get("title", "")
            wt = pg.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "")
            if not wt:
                continue
            parsed = parse_ws_ossetian_work(wtitle, wt)
            if not parsed:
                continue
            au = parsed["author"]
            ayears, ashort, aslug, base_rank = OS_AUTHORS_META.get(
                au, ("XIX — нач. XX в.", au, slugify(au.split()[0], 24), 72)
            )
            src_url = f"https://wikisource.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
            first_preview = parsed["chapters"][0]["content"][0]["text"][:165].replace("\n", " / ")
            results.append({
                "title": parsed["title"],
                "author": au,
                "authorShort": ashort,
                "authorSlug": aslug,
                "authorYears": ayears,
                "category": "caucasus",
                "year": parsed["year"],
                "description": f"Ирон литературӕ ({au}): {first_preview}",
                "historicalNote": parsed["notes"][:220] or f"Оригинальное издание на осетинском языке ({au}, {parsed['year']}).",
                "legalStatus": f"Общественное достояние (ст. 1281 ГК РФ; классика осетинской литературы, {ayears})",
                "sourceUrl": src_url,
                "chapters": parsed["chapters"],
                "words": parsed["words"],
                "chars": parsed["chars"],
                "rank": base_rank if parsed["words"] >= 180 else max(60, base_rank - 15),
                "pageid": pg.get("pageid", 0),
            })
        gcmcont = data.get("continue", {}).get("gcmcontinue")
        if not gcmcont:
            break
    print(f"   -> Получено произведений осетинских классиков: {len(results)}", flush=True)
    return results


def harvest_ironau_nart_sagas() -> list:
    print("2/3 Сбор сказаний Нартского эпоса («Нарты кадджытӕ») в оригинале...", flush=True)
    nart_pages = [
        "narty5.html", "narty6.html", "narty8.html", "narty20.html",
        "narty21.html", "narty71.html", "narty78.html", "dz-shatana.html",
        "fyccag-chinyg.html", "kolyty-akso.html", "tlattyxox.html",
    ]
    results = []
    for page in nart_pages:
        url = f"https://ironau.ru/{page}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 RaritetBook/6.0"})
            raw = urllib.request.urlopen(req, timeout=12, context=ssl_ctx).read()
            txt = raw.decode("windows-1251", "ignore") if (b"1251" in raw[:800] or b"\xe6" in raw[:2500]) else raw.decode("utf-8", "ignore")
            txt = norm_os(txt)
            m_title = re.search(r"<h1[^>]*>(.*?)</h1>", txt, flags=re.I | re.S) or re.search(r"<title>(.*?)</title>", txt, flags=re.I | re.S)
            title = html.unescape(re.sub(r"<[^>]+>", "", m_title.group(1))).strip() if m_title else page
            title = norm_os(title.replace("ае", "ӕ").replace("Ае", "Ӕ"))

            body = re.sub(r"<script.*?</script>|<style.*?</style>", "", txt, flags=re.I | re.S)
            paras = []
            for pm in re.findall(r"<p[^>]*>(.*?)</p>", body, flags=re.I | re.S):
                clean_p = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", pm))).strip()
                if len(clean_p) >= 35 and ("ӕ" in clean_p or "Ӕ" in clean_p):
                    paras.append({"type": "paragraph", "text": clean_p})
            words = sum(len(x["text"].split()) for x in paras)
            if words < 120:
                continue
            chapters = [
                {"id": f"chapter-{idx+1}", "title": f"Кадӕг / Хай {idx+1}", "content": paras[off : off + 40]}
                for idx, off in enumerate(range(0, len(paras), 40))
            ]
            results.append({
                "title": title[:160],
                "author": "Ирон адӕмон сфӕлдыстад (Нарты кадджытӕ)",
                "authorShort": "Нарты кадджытӕ",
                "authorSlug": "narty-kaddzhytae",
                "authorYears": "Фольклор",
                "category": "caucasus",
                "year": "XIX ӕнус",
                "description": paras[0]["text"][:180],
                "historicalNote": "Памятник осетинского народного эпоса и словесности на осетинском языке.",
                "legalStatus": "Общественное достояние (ст. 1259 п. 6 ГК РФ — памятник народного фольклора)",
                "sourceUrl": url,
                "chapters": chapters,
                "words": words,
                "chars": sum(len(x["text"]) for x in paras),
                "rank": 88,
                "pageid": hash(page) & 0xFFFF,
            })
        except Exception:
            continue
    print(f"   -> Получено памятников Нартского эпоса и старинной словесности: {len(results)}", flush=True)
    return results


def parse_os_wiki_article(wtitle: str, wt: str):
    wt = norm_os(wt)
    low_t = wtitle.lower()
    if any(bad in low_t for bad in ("номхыгъд", "къалендар", "аз", "районты", "хъӕуты")) or re.match(r"^\d+", wtitle):
        return None

    # Убираем инфобоксы, таблицы и служебные шаблоны
    s = re.sub(r"<!--.*?-->", "", wt, flags=re.S)
    s = re.sub(r"\{\|.*?\|\}", "", s, flags=re.S)
    s = re.sub(r"\[\[\s*(?:Категори|Category|Файл|File|ныв|Image)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)

    # Сбалансированно вырезаем многострочные шаблоны-карточки {{...}}
    cleaned = []
    i = 0
    n = len(s)
    while i < n:
        if s[i : i + 2] == "{{":
            depth = 0
            j = i
            while j < n - 1:
                if s[j : j + 2] == "{{":
                    depth += 1
                    j += 2
                    continue
                if s[j : j + 2] == "}}":
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                    continue
                j += 1
            i = j
        else:
            cleaned.append(s[i])
            i += 1
    s = "".join(cleaned)

    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace("'''", "").replace("''", "")

    SKIP_SECS = {"фиппаинӕгтӕ", "литературӕ", "ӕрвитӕнтӕ", "кӕс ноджы", "источниктӕ", "ӕддаг ӕрвитӕнтӕ"}
    blocks = []
    skip_mode = False
    for chunk in re.split(r"\n\s*\n+|\n(?==+)", s):
        chunk = chunk.strip()
        if not chunk:
            continue
        mh = re.match(r"^(=+)\s*(.+?)\s*\1$", chunk)
        if mh:
            sec_name = mh.group(2).strip()
            if sec_name.lower() in SKIP_SECS:
                skip_mode = True
                continue
            skip_mode = False
            blocks.append({"type": "subtitle", "text": sec_name})
            continue
        if skip_mode:
            continue
        lines = [ln.lstrip("*#: ").strip() for ln in chunk.splitlines() if ln.strip() and not ln.strip().startswith("|")]
        para = re.sub(r"\s+", " ", " ".join(lines)).strip()
        if len(para) >= 45:
            blocks.append({"type": "paragraph", "text": para})

    content_paras = [b for b in blocks if b["type"] == "paragraph"]
    full_txt = " ".join(b["text"] for b in content_paras)
    words = len(full_txt.split())
    # Требуем содержательный текст на осетинском языке с реальными буквами ӕ/Ӕ
    ae_count = full_txt.count("ӕ") + full_txt.count("Ӕ")
    if words < 180 or ae_count < 8:
        return None

    # Классификация рубрики по тематике
    cat_id = "caucasus"
    hay = (norm_os(wtitle) + " " + full_txt[:500]).lower()
    if any(w in hay for w in ("ирыстон", "ирон", "кавказ", "алан", "скиф", "дзӕуджыхъӕу", "цхинвал", "нарт", "хетӕгкаты", "коцойты")):
        cat_id = "caucasus"
    elif any(w in hay for w in ("истори", "паддзахад", "импери", "хӕст", "ӕнус")):
        cat_id = "history"
    elif any(w in hay for w in ("наукӕ", "хими", "физикӕ", "математикӕ", "биолог", "ӕвзаг", "философи", "астрономи")):
        cat_id = "science"

    chapters = []
    sub_cnt = sum(1 for b in blocks if b["type"] == "subtitle")
    if sub_cnt >= 2 and words >= 450:
        cur_t, cur_c = norm_os(wtitle), []
        for b in blocks:
            if b["type"] == "subtitle":
                if cur_c:
                    chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
                    cur_c = []
                cur_t = b["text"][:120]
            else:
                cur_c.append(b)
        if cur_c:
            chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
    else:
        clean_b = [b for b in blocks if b["type"] != "subtitle"]
        chapters = [{"id": "chapter-1", "title": norm_os(wtitle), "content": clean_b}]

    chapters = [c for c in chapters if c["content"]]
    if not chapters:
        return None

    return {
        "title": norm_os(wtitle),
        "category": cat_id,
        "chapters": chapters,
        "words": words,
        "chars": len(full_txt),
        "preview": content_paras[0]["text"][:185],
    }


def harvest_os_historical_monographs(needed: int) -> list:
    print(f"3/3 Добор {needed} крупных исторических, краеведческих и научных очерков на осетинском языке...", flush=True)
    # Сначала собираем приоритетные категории об Осетии, Алании, литературе и истории, затем самые объёмные статьи (Longpages)
    priority_titles = []
    seen_t = set()

    prio_cats = [
        "Категори:Ирон литературæ", "Категори:Ирон фысджытæ", "Категори:Ирон поэттæ",
        "Категори:Нарты кадджытæ", "Категори:Ирыстоны истори", "Категори:Цæгат Ирыстон",
        "Категори:Хуссар Ирыстон", "Категори:Дзæуджыхъæу", "Категори:Алантæ",
        "Категори:Ирон культурæ", "Категори:Ирон æвзаг", "Категори:Ирæттæ Фыдыбæстæйы Стыр хæсты",
    ]
    for pc in prio_cats:
        d = api_get("os.wikipedia.org", {"action": "query", "list": "categorymembers", "cmtitle": pc, "cmnamespace": 0, "cmlimit": 500, "format": "json"})
        for m in d.get("query", {}).get("categorymembers", []):
            t = m["title"]
            if t not in seen_t and "номхыгъд" not in t.lower():
                seen_t.add(t)
                priority_titles.append(t)

    for offset in [0, 500, 1000, 1500]:
        d = api_get("os.wikipedia.org", {"action": "query", "list": "querypage", "qppage": "Longpages", "qplimit": 500, "qpoffset": offset, "format": "json"})
        for item in d.get("query", {}).get("querypage", {}).get("results", []):
            t = item["title"]
            if int(item.get("value", 0)) >= 2500 and t not in seen_t and "номхыгъд" not in t.lower() and ":" not in t:
                seen_t.add(t)
                priority_titles.append(t)

    results = []
    batches = [priority_titles[i : i + 40] for i in range(0, len(priority_titles), 40)]

    for batch in batches:
        if len(results) >= needed:
            break
        data = api_get("os.wikipedia.org", {
            "action": "query",
            "titles": "|".join(batch),
            "prop": "revisions",
            "rvslots": "main",
            "rvprop": "content",
            "format": "json",
        })
        for pg in data.get("query", {}).get("pages", {}).values():
            if len(results) >= needed:
                break
            wtitle = pg.get("title", "")
            wt = pg.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "")
            if not wt:
                continue
            parsed = parse_os_wiki_article(wtitle, wt)
            if not parsed:
                continue
            src_url = f"https://os.wikipedia.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
            results.append({
                "title": parsed["title"],
                "author": "Ирон энциклопедион фонд",
                "authorShort": "Ирон архив",
                "authorSlug": "iron-arkhiv",
                "authorYears": "",
                "category": parsed["category"],
                "year": "Ирон рауагъд",
                "description": parsed["preview"],
                "historicalNote": f"Справочно-исторический очерк на осетинском языке («{parsed['title']}»).",
                "legalStatus": "Открытая лицензия Creative Commons Attribution-ShareAlike 4.0 (ст. 1286.1 ГК РФ; источник: os.wikipedia.org)",
                "sourceUrl": src_url,
                "chapters": parsed["chapters"],
                "words": parsed["words"],
                "chars": parsed["chars"],
                "rank": 70 if parsed["category"] == "caucasus" else 55,
                "pageid": pg.get("pageid", 0),
            })
    print(f"   -> Собрано очерков на осетинском языке: {len(results)}", flush=True)
    return results


def build_sharded_indexes(catalog_books: list):
    PUBLIC_META_DIR.mkdir(parents=True, exist_ok=True)
    SHARDS_META_DIR.mkdir(parents=True, exist_ok=True)
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)

    for old_f in SHARDS_META_DIR.glob("idx-*.json"):
        old_f.unlink(missing_ok=True)

    cat_counts = {}
    lang_counts = {"ru": 0, "os": 0}
    total_words = 0
    for b in catalog_books:
        c = b.get("category", "russian-classics")
        cat_counts[c] = cat_counts.get(c, 0) + 1
        lg = b.get("language", "ru")
        lang_counts[lg] = lang_counts.get(lg, 0) + 1
        total_words += int(b.get("wordsCount", 0))

    cats_out = [{**cm, "booksCount": cat_counts.get(cm["id"], 0)} for cm in CATEGORIES_META]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    (CATALOG_DIR / "catalog.json").write_text(
        json.dumps({"version": f"4.1.{len(catalog_books)}", "generatedAt": now_iso, "totalBooks": len(catalog_books), "books": catalog_books}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (CATALOG_DIR / "categories.json").write_text(json.dumps(cats_out, ensure_ascii=False, indent=2), encoding="utf-8")
    (PUBLIC_META_DIR / "categories.json").write_text(json.dumps(cats_out, ensure_ascii=False, indent=2), encoding="utf-8")

    sorted_books = sorted(
        catalog_books,
        key=lambda b: (-max(FLAGSHIP_RANKS.get(b["slug"], 0), int(b.get("rank", 0))), b.get("title", "")),
    )

    chunk_files = []
    for chunk_idx, offset in enumerate(range(0, len(sorted_books), CHUNK_SIZE)):
        slice_books = sorted_books[offset : offset + CHUNK_SIZE]
        rows = []
        for b in slice_books:
            slug = b["slug"]
            rnk = max(FLAGSHIP_RANKS.get(slug, 0), int(b.get("rank", 0)))
            rows.append([
                slug,
                b.get("title", ""),
                b.get("authorShort", ""),
                b.get("author", ""),
                b.get("authorSlug", "author"),
                CAT_TO_IDX.get(b.get("category", "russian-classics"), 1),
                LANG_TO_IDX.get(b.get("language", "ru"), 0),
                b.get("editionYear", ""),
                int(b.get("wordsCount", 0)),
                int(b.get("readingMinutes", 5)),
                rnk,
                int(b.get("shard", 0)),
                int(b.get("chaptersCount", 1)),
                b.get("description", "")[:60],
            ])
        fname = f"idx-{chunk_idx}.json"
        (SHARDS_META_DIR / fname).write_text(
            json.dumps({"c": chunk_idx, "r": rows}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        chunk_files.append(fname)

    def to_lite_obj(b):
        slug = b["slug"]
        return {
            "id": slug, "slug": slug, "t": b.get("title", ""), "alt": b.get("altTitles", []),
            "a": b.get("author", ""), "as": b.get("authorShort", ""), "aslug": b.get("authorSlug", "author"),
            "ay": b.get("authorYears", ""), "tr": b.get("translator"), "lang": b.get("language", "ru"),
            "cat": b.get("category", "russian-classics"), "wy": b.get("writtenYear", ""),
            "ey": b.get("editionYear", ""), "d": b.get("description", "")[:65],
            "ch": int(b.get("chaptersCount", 1)), "w": int(b.get("wordsCount", 0)),
            "rm": int(b.get("readingMinutes", 5)),
            "rank": max(FLAGSHIP_RANKS.get(slug, 0), int(b.get("rank", 0))),
            "sh": int(b.get("shard", 0)),
        }

    flagships = [to_lite_obj(b) for b in sorted_books if FLAGSHIP_RANKS.get(b["slug"], 0) > 0][:12]
    ossetian_featured = [
        to_lite_obj(b)
        for b in sorted_books
        if b.get("language") == "os" and b.get("authorSlug") != "iron-arkhiv"
    ][:12]
    science_picks = [to_lite_obj(b) for b in sorted_books if b.get("category") in ("rare-editions", "science") and b.get("language") == "ru"][:6]
    recent = [to_lite_obj(b) for b in reversed(catalog_books) if b.get("language") == "ru"][:6]

    home_payload = {
        "version": f"4.1.{len(catalog_books)}",
        "totalBooks": len(catalog_books),
        "ossetianBooks": lang_counts.get("os", 0),
        "totalWords": total_words,
        "maxCapacity": 100000,
        "shardsCount": len(SHARD_REPOS),
        "flagships": flagships,
        "ossetian": ossetian_featured,
        "science": science_picks,
        "recent": recent,
    }
    (PUBLIC_META_DIR / "home-featured.json").write_text(
        json.dumps(home_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    manifest = {
        "version": f"4.1.{len(catalog_books)}",
        "generatedAt": now_iso,
        "totalBooks": len(catalog_books),
        "ossetianBooks": lang_counts.get("os", 0),
        "totalWords": total_words,
        "chunkSize": CHUNK_SIZE,
        "maxCapacity": 100000,
        "catMap": CAT_ORDER,
        "langMap": LANG_ORDER,
        "shardRepos": SHARD_REPOS,
        "chunks": chunk_files,
    }
    (PUBLIC_META_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main():
    cat_path = CATALOG_DIR / "catalog.json"
    master = json.loads(cat_path.read_text(encoding="utf-8"))
    catalog_books = master.get("books", [])
    seen_slugs = {b["slug"] for b in catalog_books}
    seen_urls = {b.get("sourceUrl", "") for b in catalog_books if b.get("sourceUrl")}

    # Помечаем уже существующий «Ирон фӕндыр» (если был в базе) как осетинский
    for b in catalog_books:
        if "iron-fandyr" in b["slug"]:
            b["language"] = "os"

    ws_items = harvest_wikisource_ossetian()
    nart_items = harvest_ironau_nart_sagas()
    target_new_os = 1050
    needed_wiki = max(0, target_new_os - len(ws_items) - len(nart_items))
    wiki_items = harvest_os_historical_monographs(needed_wiki)

    all_new = ws_items + nart_items + wiki_items
    added = 0

    for item in all_new:
        if item["sourceUrl"] in seen_urls:
            continue
        aslug = item["authorSlug"]
        bslug = slugify(f"{aslug}-{item['title']}", 62)
        if bslug in seen_slugs:
            bslug = f"{bslug}-{item['pageid']}"
        if bslug in seen_slugs:
            continue

        seen_slugs.add(bslug)
        seen_urls.add(item["sourceUrl"])

        rmin = max(2, round(item["words"] / 150))
        rel = f"/archive/books/{aslug}/{bslug}"
        payload = {
            "id": bslug,
            "slug": bslug,
            "shard": 1,
            "title": item["title"],
            "altTitles": [],
            "author": item["author"],
            "authorShort": item["authorShort"],
            "authorSlug": aslug,
            "authorYears": item["authorYears"],
            "translator": None,
            "language": "os",
            "category": item["category"],
            "writtenYear": item["year"],
            "editionYear": item["year"],
            "description": item["description"],
            "historicalNote": item["historicalNote"],
            "sourceUrl": item["sourceUrl"],
            "legalStatus": item["legalStatus"],
            "downloadAllowed": True,
            "fb2Url": f"{rel}/original.fb2",
            "coverUrl": f"{rel}/cover.webp",
            "stats": {
                "chaptersCount": len(item["chapters"]),
                "wordsCount": item["words"],
                "charsCount": item["chars"],
                "readingMinutes": rmin,
            },
            "toc": [{"id": c["id"], "title": c["title"]} for c in item["chapters"]],
            "chapters": item["chapters"],
        }

        json_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        for root_dir in (BOOKS_DIR, SHARD1_BOOKS_DIR):
            bdir = root_dir / aslug / bslug
            bdir.mkdir(parents=True, exist_ok=True)
            (bdir / "book.json").write_text(json_str, encoding="utf-8")

        catalog_books.append({
            "id": bslug,
            "slug": bslug,
            "shard": 1,
            "rank": item["rank"],
            "title": item["title"],
            "altTitles": [],
            "author": item["author"],
            "authorShort": item["authorShort"],
            "authorSlug": aslug,
            "authorYears": item["authorYears"],
            "translator": None,
            "language": "os",
            "category": item["category"],
            "writtenYear": item["year"],
            "editionYear": item["year"],
            "description": item["description"][:90],
            "historicalNote": item["historicalNote"][:120],
            "legalStatus": item["legalStatus"],
            "sourceUrl": item["sourceUrl"],
            "downloadAllowed": True,
            "bookUrl": f"{rel}/book.json",
            "fb2Url": f"{rel}/original.fb2",
            "coverUrl": f"{rel}/cover.webp",
            "chaptersCount": len(item["chapters"]),
            "wordsCount": item["words"],
            "charsCount": item["chars"],
            "readingMinutes": rmin,
        })
        added += 1

    build_sharded_indexes(catalog_books)
    os_total = sum(1 for b in catalog_books if b.get("language") == "os")
    print(f"\n=== ФИНИШ ИРОН ФОНД! Добавлено на осетинском языке: +{added}, всего на осетинском (lang='os'): {os_total}, общий фонд архива: {len(catalog_books)} ===", flush=True)


if __name__ == "__main__":
    main()
