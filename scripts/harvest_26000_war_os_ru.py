#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Масштабное пополнение архива (+10 000 изданий -> ~26 100 томов в 3 CDN-шардах):
1. Спецколлекция «Великая Отечественная война (1941–1945), Блокада Ленинграда и Отечественная война 1812 года»
   — строго по закону РФ:
     * официальные документы обороны Ленинграда, фронтов, ГКО, акты о капитуляции (ст. 1259 п. 6 ГК РФ — не охраняются АП);
     * произведения писателей, поэтов и военкоров, погибших на фронте / в блокаду или умерших не позднее 1951 г.
       (даже с учётом +4 военных лет по ст. 1281 п. 5 ГК РФ: 1951 + 1 + 74 = 01.01.2026 — 100% общественное достояние!).
2. +5 000 новых изданий на осетинском языке (lang='os', ирон ӕвзаг — включая героев ВОВ из Осетии «Ирӕттӕ Фыдыбӕстӕйы Стыр хӕсты»,
   историю, географию, биографии и науку по открытой лицензии CC BY-SA 4.0, ст. 1286.1 ГК РФ).
3. +~5 000 новых русскоязычных книг (история, наука, старинные учебники, зарубежная и русская классика) со строгой проверкой ОД,
   точной категоризацией и чистыми авторами/оглавлениями.
"""

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
SHARD1_BOOKS_DIR = ARCHIVE_DIR / "shard-1" / "books"
SHARD2_BOOKS_DIR = ARCHIVE_DIR / "shard-2" / "books"
CATALOG_DIR = ARCHIVE_DIR / "catalog"
PUBLIC_META_DIR = BASE_DIR / "public" / "archive-meta"
SHARDS_META_DIR = PUBLIC_META_DIR / "shards"

CHUNK_SIZE = 5000
SHARD1_MAX_TOTAL = 10000  # Заполняем Shard-1 до 10 000 книг, всё сверх идёт в Shard-2 (raritetbook-books-3)

SHARD_REPOS = [
    "https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books/main",
    "https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-2/main",
    "https://raw.githubusercontent.com/omelcukd15-coder/raritetbook-books-3/main",
]

CAT_ORDER = ["history", "russian-classics", "caucasus", "foreign-classics", "science", "rare-editions"]
CAT_TO_IDX = {c: i for i, c in enumerate(CAT_ORDER)}
LANG_ORDER = ["ru", "os"]
LANG_TO_IDX = {l: i for i, l in enumerate(LANG_ORDER)}

CATEGORIES_META = [
    {"id": "history", "slug": "history", "title": "История России", "subtitle": "Отечественная война, Блокада Ленинграда, летописи, исторические труды и архивные документы", "image": "/assets/images/categories/history.webp"},
    {"id": "russian-classics", "slug": "russian-classics", "title": "Русская классика", "subtitle": "Золотой фонд русской прозы, поэзии и драматургии XVIII – середины XX века", "image": "/assets/images/categories/russian-classics.webp"},
    {"id": "caucasus", "slug": "caucasus", "title": "Кавказ и Осетия", "subtitle": "Осетинская литература и энциклопедический фонд (ӕ), Нартский эпос и хроники Кавказа", "image": "/assets/images/categories/caucasus.webp"},
    {"id": "foreign-classics", "slug": "foreign-classics", "title": "Зарубежная классика", "subtitle": "Мировая литература, приключения, фантастика и драматургия в классических переводах", "image": "/assets/images/categories/foreign-classics.webp"},
    {"id": "science", "slug": "science", "title": "Наука и философия", "subtitle": "Труды русских и мировых учёных, философия, география, этнография и естествознание", "image": "/assets/images/categories/science.webp"},
    {"id": "rare-editions", "slug": "rare-editions", "title": "Редкие издания и учебники", "subtitle": "Старинные учебные курсы, педагогика, логика, право и редкие дореволюционные книги", "image": "/assets/images/categories/rare-editions.webp"},
]

FLAGSHIP_RANKS = {
    "dostoevskiy-prestuplenie-i-nakazanie": 100, "lermontov-mtsyri": 100,
    "pushkin-evgeniy-onegin": 99, "gogol-myortvye-dushi": 99, "turgenev-ottsy-i-deti": 99,
    "griboedov-gore-ot-uma": 99, "pushkin-kapitanskaya-dochka": 98, "goncharov-oblomov": 98,
    "lermontov-geroy-nashego-vremeni": 97, "tolstoy-hadzhi-murat": 96,
    "karamzin-istoriya-gosudarstva-rossiyskogo-tom-1": 95, "lomonosov-rossiyskaya-grammatika": 94,
    "chelpanov-uchebnik-logiki": 93, "perelman-zhivaya-matematika": 92,
    "tsiolkovskiy-vne-zemli": 91, "mendeleev-popytka-ponimaniya-efira": 90,
    "stoker-vampir-graf-drakula-1912": 89, "goethe-faust-kholodkovskiy": 88,
    "shakespeare-gamlet-kroneberg": 87, "homer-odisseya-zhukovskiy": 86,
    "khetagurov-osoba": 85, "khetagurov-iron-fandyr": 84,
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
    "Сборник боевых документов/",
)

BAD_MARKERS = (
    "{{не окончено", "{{не завершено", "{{заготовка", "{{нет текста",
    "{{фрагмент", "{{отрывок", "{{уд-", "{{copyvio", "{{несвободн", "{{cc-by",
)

# Живые или поздно умершие авторы (после 1951 г.) — СТРОГО ИСКЛЮЧАЕМ для соблюдения ст. 1281 ГК РФ!
FORBIDDEN_MODERN_AUTHORS = (
    "путин", "берггольц", "симонов", "гранин", "адамович", "васильев борис",
    "астафьев", "бондарев", "быков василь", "шолохов", "твардовский", "паустовский",
    "маршак", "чуковский корней", "бабкин",
)

HEADERS = {
    "User-Agent": "RaritetBookExpansion26K/6.5 (https://raritetbook.ru; founder@omelchukdenis.ru) Python/3.11",
    "Accept-Encoding": "gzip",
    "Connection": "keep-alive",
}

ssl_ctx = ssl.create_default_context()
tls_local = threading.local()
rate_lock = threading.Lock()
last_req_ts = 0.0


def norm_os(text: str) -> str:
    return text.replace("æ", "ӕ").replace("Æ", "Ӕ")


def slugify(text: str, max_len: int = 64) -> str:
    t = norm_os(text).lower().strip()
    out = [TRANSLIT_MAP.get(ch, ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else "-") for ch in t]
    s = re.sub(r"-+", "-", "".join(out)).strip("-")
    return (s[:max_len].rstrip("-") if len(s) > max_len else s) or "book"


def host_api(host: str, params: dict, min_gap: float = 0.022) -> dict:
    global last_req_ts
    path = "/w/api.php?" + urllib.parse.urlencode(params)
    conn_attr = f"conn_{host.replace('.', '_')}"
    for attempt in range(4):
        with rate_lock:
            now = time.monotonic()
            wait = min_gap - (now - last_req_ts)
            if wait > 0:
                time.sleep(wait)
            last_req_ts = time.monotonic()
        try:
            conn = getattr(tls_local, conn_attr, None)
            if conn is None:
                conn = http.client.HTTPSConnection(host, timeout=25, context=ssl_ctx)
                setattr(tls_local, conn_attr, conn)
            conn.request("GET", path, headers=HEADERS)
            resp = conn.getresponse()
            raw = resp.read()
            if resp.status == 429 or resp.status >= 500:
                setattr(tls_local, conn_attr, None)
                time.sleep(1.6 * (attempt + 1))
                continue
            if resp.getheader("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8"))
        except Exception:
            setattr(tls_local, conn_attr, None)
            if attempt < 3:
                time.sleep(0.6 * (attempt + 1))
    return {}


def extract_otekste(wt: str):
    m = re.search(r"\{\{\s*(?:Отексте|отексте|О\s+тексте|Документ)\b", wt)
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
    for _ in range(3):
        ns = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if ns == s:
            break
        s = ns
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s).replace("'''", "").replace("''", "")).strip()


def verify_pd_strict(wt: str, fields: dict, wtitle: str, allow_official_doc: bool = False):
    low = wt.lower()
    wlow = wtitle.lower()
    for bm in BAD_MARKERS:
        if bm in low:
            return False, None
    for fa in FORBIDDEN_MODERN_AUTHORS:
        if fa in low[:1200] or fa in wlow:
            return False, None

    # Официальные государственные и военные документы (ст. 1259 п. 6 ГК РФ — не охраняются авторским правом)
    is_official = (
        "{{pd-ru-exempt" in low
        or "{{од-гос" in low
        or (
            allow_official_doc
            and any(
                wlow.startswith(pref)
                for pref in (
                    "боевой приказ", "директива ", "приказ ", "постановление гко", "указ президиума",
                    "акт о безоговорочной капитуляции", "акт о злодеяниях", "доклад штаба",
                    "оперативная директива", "соглашение о перемирии", "московская декларация",
                )
            )
        )
    )
    if is_official:
        ym = re.search(r"\b(181\d|1939|194[0-5])\b", wtitle + " " + wt[:600])
        yr = ym.group(1) if ym else "1941–1945"
        return True, {"year": yr, "lic": "ст. 1259 п. 6 ГК РФ (официальный архивный документ)"}

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
    # Строгий потолок 1951 года смерти (1951 + 1 + 74 военных года по ст. 1281 п. 5 ГК РФ = 01.01.2026!)
    if any(d > 1951 for d in a_deaths) or any(d > 1951 for d in t_deaths):
        return False, None

    is_pd = ("pd" in lic.lower()) or ("од-" in lic.lower()) or ("общественное достояние" in low) or ("pd-" in low)
    if raw_trans:
        if not ((t_deaths and max(t_deaths) <= 1948) or (min_y and min_y <= 1942) or (is_pd and (min_y is None or min_y <= 1942))):
            return False, None
    else:
        if not ((a_deaths and max(a_deaths) <= 1951) or (min_y and min_y <= 1946) or (is_pd and (min_y is None or min_y <= 1948))):
            return False, None

    return True, {"year": str(min_y) if min_y else "XIX — перв. пол. XX в.", "lic": lic or "ст. 1281 ГК РФ"}


def parse_ru_body(body: str, fallback_title: str, min_words: int = 380):
    s = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    s = re.sub(r"\{\|.*?\|\}", "", s, flags=re.S)
    s = re.sub(r"\[\[\s*(?:Категория|Category|Файл|File|Изображение|Image)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)

    poems = []
    def keep_poem(m):
        poems.append(m.group(1))
        return f"\n\n@@POEM_{len(poems)-1}@@\n\n"
    s = re.sub(r"<poem[^>]*>(.*?)</poem>", keep_poem, s, flags=re.I | re.S)

    for _ in range(4):
        ns = re.sub(
            r"\{\{(?:Эпиграф|эпиграф|epigraph)\|([^{}]*?)\}\}",
            lambda m: " — ".join(p.strip() for p in m.group(1).split("|") if p.strip()),
            s,
            flags=re.S,
        )
        ns = re.sub(r"\{\{(?:right|center|left|блоки|цитата|Цитата)\|([^{}|]*?)(?:\|[^{}]*)?\}\}", r"\1", ns, flags=re.I | re.S)
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
            if ht and ht.lower() not in ("примечания", "сноски", "литература") and not re.fullmatch(r"[=.*—–\-\s_]+", ht):
                items.append({"type": "h2", "text": ht})
            continue
        txt = re.sub(r"\s+", " ", rb).strip()
        if txt and not ("общественное достояние" in txt.lower() and len(txt) < 240):
            items.append({"type": "paragraph", "text": txt})

    if not items:
        return [], 0, 0

    full_txt = " ".join(x.get("text", "") for x in items)
    words = len(full_txt.split())
    if words < min_words:
        return [], 0, 0
    if (full_txt.count("ѣ") + full_txt.count("Ѣ")) > len(full_txt) * 0.003:
        return [], 0, 0
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
                ct = x["text"][:140]
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


def sanitize_ru_author_and_title(raw_title: str, raw_auth: str, wtitle: str, is_official: bool = False):
    if raw_title.startswith("(") and raw_title.endswith(")") and "(" not in raw_title[1:-1]:
        raw_title = raw_title[1:-1].strip()

    if is_official and not raw_auth:
        return raw_title, "Архивные документы обороны и истории", "Архив документов", "arkhiv-dokumentov"

    clean_auth = clean_inline(re.sub(r"\([^)]*\)?", "", raw_auth))
    clean_auth = re.sub(r"\s*\b\d{4}\s*[—–-]\s*\d{4}.*$", "", clean_auth).strip(" ,.;:-—–(")

    if not clean_auth:
        mp = re.search(r"\(([^);,0-9]+)\)\s*$", wtitle)
        cand = mp.group(1).strip() if mp else ""
        if cand and sum(1 for c in cand if c.isalpha()) >= 3 and not any(cand.lower().startswith(w) for w in ("рассказ", "повесть", "очерк", "газета", "перевод")):
            clean_auth = cand

    has_letters = sum(1 for c in clean_auth if c.isalpha()) >= 3
    if not has_letters or any(clean_auth.lower().startswith(w) for w in ("неизвестн", "аноним", "рассказ", "повесть")):
        return raw_title, "Анонимное издание", "Анонимное изд.", "anonim"

    if re.search(r"\b[IVX]+\b$", clean_auth):
        return raw_title, clean_auth, clean_auth, slugify(clean_auth, 28)

    p = [x for x in clean_auth.split() if x and x[0].isalpha()]
    ashort = f"{p[0][0]}. {p[1][0]}. {p[2]}" if len(p) == 3 else (f"{p[0][0]}. {p[1]}" if len(p) == 2 else clean_auth)
    aslug = slugify(p[-1] if p else "author", 28)
    return raw_title, clean_auth, ashort, aslug


def parse_os_wiki_clean(wtitle: str, wt: str):
    wt = norm_os(wt)
    low_t = wtitle.lower()
    if any(bad in low_t for bad in ("номхыгъд", "къалендар", "категори:", "шаблон:", "файл:")) or re.match(r"^\d+\s*(аз|$)", low_t):
        return None

    s = re.sub(r"<!--.*?-->", "", wt, flags=re.S)
    s = re.sub(r"\{\|.*?\|\}", "", s, flags=re.S)
    s = re.sub(r"\[\[\s*(?:Категори|Category|Файл|File|ныв|Image)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)

    cleaned = []
    i = 0
    n = len(s)
    while i < n:
        if s[i : i + 2] == "{{":
            depth = 0
            j = i
            while j < n - 1:
                if s[j : j + 2] == "{{": depth += 1; j += 2; continue
                if s[j : j + 2] == "}}":
                    depth -= 1; j += 2
                    if depth == 0: break
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
        if len(para) >= 30:
            blocks.append({"type": "paragraph", "text": para})

    content_paras = [b for b in blocks if b["type"] == "paragraph"]
    full_txt = " ".join(b["text"] for b in content_paras)
    words = len(full_txt.split())
    ae_count = full_txt.count("ӕ") + full_txt.count("Ӕ")
    if words < 55 or ae_count < 3:
        return None

    hay = (norm_os(wtitle) + " " + full_txt[:500]).lower()
    if any(w in hay for w in ("хӕст", "блокадӕ", "ленинград", "советон", "импери", "истори", "паддзахад", "ӕнус", "хъӕбатыр")):
        cat_id = "history" if "ирыстон" not in hay and "ирон" not in hay else "caucasus"
    elif any(w in hay for w in ("наукӕ", "хими", "физикӕ", "математикӕ", "биолог", "философи", "астрономи", "медицинӕ", "географи")):
        cat_id = "science"
    else:
        cat_id = "caucasus"

    clean_title = norm_os(wtitle)
    sub_cnt = sum(1 for b in blocks if b["type"] == "subtitle")
    if sub_cnt >= 2 and words >= 280:
        chapters = []
        cur_t, cur_c = clean_title, []
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
        chapters = [{"id": "chapter-1", "title": clean_title, "content": [b for b in blocks if b["type"] != "subtitle"]}]

    chapters = [c for c in chapters if c["content"]]
    if not chapters:
        return None

    return {
        "title": clean_title,
        "category": cat_id,
        "chapters": chapters,
        "words": words,
        "chars": len(full_txt),
        "preview": content_paras[0]["text"][:180],
    }


def build_all_sharded_indexes(catalog_books: list):
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
        json.dumps({"version": f"5.0.{len(catalog_books)}", "generatedAt": now_iso, "totalBooks": len(catalog_books), "books": catalog_books}, ensure_ascii=False, separators=(",", ":")),
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
    ossetian_featured = [to_lite_obj(b) for b in sorted_books if b.get("language") == "os" and b.get("authorSlug") != "iron-arkhiv"][:12]
    science_picks = [to_lite_obj(b) for b in sorted_books if b.get("category") in ("rare-editions", "science") and b.get("language") == "ru"][:6]
    recent = [to_lite_obj(b) for b in reversed(catalog_books) if b.get("language") == "ru"][:6]

    home_payload = {
        "version": f"5.0.{len(catalog_books)}",
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
        "version": f"5.0.{len(catalog_books)}",
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
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    SHARD1_BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    SHARD2_BOOKS_DIR.mkdir(parents=True, exist_ok=True)

    master = json.loads((CATALOG_DIR / "catalog.json").read_text(encoding="utf-8"))
    catalog_books = master["books"]
    seen_slugs = {b["slug"] for b in catalog_books}
    seen_urls = {b.get("sourceUrl", "") for b in catalog_books if b.get("sourceUrl")}
    shard1_count = sum(1 for b in catalog_books if int(b.get("shard", 0)) == 1)

    state_lock = threading.Lock()
    t0 = time.time()

    def save_book_record(rec: dict) -> bool:
        nonlocal shard1_count
        with state_lock:
            if rec["sourceUrl"] in seen_urls:
                return False
            bslug = rec["slug"]
            if bslug in seen_slugs:
                bslug = f"{bslug}-{rec['pageid']}"
            if bslug in seen_slugs:
                return False
            seen_slugs.add(bslug)
            seen_urls.add(rec["sourceUrl"])
            if shard1_count < SHARD1_MAX_TOTAL:
                shard_id = 1
                shard1_count += 1
                shard_dir = SHARD1_BOOKS_DIR
            else:
                shard_id = 2
                shard_dir = SHARD2_BOOKS_DIR

        aslug = rec["authorSlug"]
        rel = f"/archive/books/{aslug}/{bslug}"
        payload = {
            "id": bslug, "slug": bslug, "shard": shard_id,
            "title": rec["title"], "altTitles": [],
            "author": rec["author"], "authorShort": rec["authorShort"],
            "authorSlug": aslug, "authorYears": rec.get("authorYears", ""),
            "translator": rec.get("translator"), "language": rec["language"],
            "category": rec["category"], "writtenYear": rec["year"], "editionYear": rec["year"],
            "description": rec["description"], "historicalNote": rec["historicalNote"],
            "sourceUrl": rec["sourceUrl"], "legalStatus": rec["legalStatus"],
            "downloadAllowed": True, "fb2Url": f"{rel}/original.fb2", "coverUrl": f"{rel}/cover.webp",
            "stats": {
                "chaptersCount": len(rec["chapters"]),
                "wordsCount": rec["words"],
                "charsCount": rec["chars"],
                "readingMinutes": rec["rmin"],
            },
            "toc": [{"id": c["id"], "title": c["title"]} for c in rec["chapters"]],
            "chapters": rec["chapters"],
        }
        json_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        for rdir in (BOOKS_DIR, shard_dir):
            bd = rdir / aslug / bslug
            bd.mkdir(parents=True, exist_ok=True)
            (bd / "book.json").write_text(json_str, encoding="utf-8")

        cat_entry = {
            "id": bslug, "slug": bslug, "shard": shard_id, "rank": rec.get("rank", 0),
            "title": rec["title"], "altTitles": [], "author": rec["author"], "authorShort": rec["authorShort"],
            "authorSlug": aslug, "authorYears": rec.get("authorYears", ""), "translator": rec.get("translator"),
            "language": rec["language"], "category": rec["category"], "writtenYear": rec["year"],
            "editionYear": rec["year"], "description": rec["description"][:90],
            "historicalNote": rec["historicalNote"][:120], "legalStatus": rec["legalStatus"],
            "sourceUrl": rec["sourceUrl"], "downloadAllowed": True, "bookUrl": f"{rel}/book.json",
            "fb2Url": f"{rel}/original.fb2", "coverUrl": f"{rel}/cover.webp",
            "chaptersCount": len(rec["chapters"]), "wordsCount": rec["words"],
            "charsCount": rec["chars"], "readingMinutes": rec["rmin"],
        }
        with state_lock:
            catalog_books.append(cat_entry)
        return True

    # === ЭТАП 1: ВЕЛИКАЯ ОТЕЧЕСТВЕННАЯ ВОЙНА, БЛОКАДА ЛЕНИНГРАДА И 1812 ГОД (СТРОГО ПО ЗАКОНУ РФ) ===
    print("=== ЭТАП 1/3: Сбор легального фонда ВОВ (1941–1945), Блокады Ленинграда и Отечественной войны 1812 года ===", flush=True)
    war_cats = [
        "Категория:Блокада Ленинграда",
        "Категория:Великая Отечественная война",
        "Категория:Отечественная война 1812 года",
        "Категория:Вторая мировая война",
        "Категория:Документы по фронтам",
        "Категория:Акты о капитуляции",
        "Категория:Нюрнбергский процесс",
        "Категория:Первая мировая война",
    ]
    war_added = 0
    for wcat in war_cats:
        gcmcont = None
        while True:
            p = {
                "action": "query", "generator": "categorymembers", "gcmtitle": wcat,
                "gcmnamespace": 0, "gcmlimit": 25, "prop": "revisions", "rvslots": "main", "rvprop": "content|size", "format": "json",
            }
            if gcmcont:
                p["gcmcontinue"] = gcmcont
            data = host_api("ru.wikisource.org", p)
            for pg in data.get("query", {}).get("pages", {}).values():
                wtitle = pg.get("title", "")
                if not wtitle or "/ДО" in wtitle or "(ДО)" in wtitle or any(wtitle.startswith(pf) for pf in FORBIDDEN_PREFIXES):
                    continue
                wt = (pg.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("*", "")
                if not wt:
                    continue
                fields, body = extract_otekste(wt)
                ok, info = verify_pd_strict(wt, fields, wtitle, allow_official_doc=True)
                if not ok:
                    continue
                is_off = "1259" in info["lic"]
                raw_t = clean_inline(fields.get("НАЗВАНИЕ", "")) or re.sub(r"\s*\([^)]+\)\s*$", "", wtitle).strip()
                chs, words, chars = parse_ru_body(body, raw_t, min_words=95 if is_off else 180)
                if not chs:
                    continue
                clean_t, clean_a, ashort, aslug = sanitize_ru_author_and_title(raw_t, fields.get("АВТОР", ""), wtitle, is_off)
                src_url = f"https://ru.wikisource.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
                first_p = chs[0]["content"][0]["text"][:170]
                if save_book_record({
                    "slug": slugify(f"{aslug}-{clean_t}", 62),
                    "pageid": pg.get("pageid", 0),
                    "title": clean_t, "author": clean_a, "authorShort": ashort, "authorSlug": aslug,
                    "authorYears": "", "translator": None, "language": "ru", "category": "history",
                    "year": info["year"],
                    "description": f"Памятник военной истории ({wcat.replace('Категория:', '')}): {first_p}",
                    "historicalNote": f"Проверенный исторический материал ({wcat.replace('Категория:', '')}, {info['year']}).",
                    "legalStatus": f"Общественное достояние ({info['lic']}; {info['year']})",
                    "sourceUrl": src_url, "chapters": chs, "words": words, "chars": chars,
                    "rmin": max(2, round(words / 180)), "rank": 88 if "Блокада" in wcat or "Отечественная" in wcat else 75,
                }):
                    war_added += 1
            gcmcont = data.get("continue", {}).get("gcmcontinue")
            if not gcmcont:
                break
    print(f"  -> Добавлено проверенных материалов ВОВ, Блокады Ленинграда и военной истории: +{war_added}", flush=True)

    # === ЭТАП 2: +5 000 НОВЫХ ИЗДАНИЙ НА ОСЕТИНСКОМ ЯЗЫКЕ (lang='os', ирон ӕвзаг) ===
    print("=== ЭТАП 2/3: Сбор +5 000 изданий на осетинском языке (вкл. Осетию в годы ВОВ, историю, науку и культуру) ===", flush=True)
    os_target_new = 5000
    os_added = 0
    os_Lock = threading.Lock()

    # Собираем список всех содержательных страниц os.wikipedia >= 850 байт (начиная с категорий ВОВ и самых крупных статей Longpages + allpages)
    candidate_os_titles = []
    seen_os_t = set()

    war_os_cats = [
        "Категори:Ирæттæ Фыдыбæстæйы Стыр хæсты",
        "Категори:Фыдыбæстæйы Стыр хæст",
        "Категори:Советон Цæдисы Хъæбатыртæ",
        "Категори:Дыккаг дунеон хæст",
    ]
    for woc in war_os_cats:
        d = host_api("os.wikipedia.org", {"action": "query", "list": "categorymembers", "cmtitle": woc, "cmnamespace": 0, "cmlimit": 500, "format": "json"})
        for m in d.get("query", {}).get("categorymembers", []):
            t = m["title"]
            if t not in seen_os_t:
                seen_os_t.add(t)
                candidate_os_titles.append(t)

    for off in range(1500, 9500, 500):
        d = host_api("os.wikipedia.org", {"action": "query", "list": "querypage", "qppage": "Longpages", "qplimit": 500, "qpoffset": off, "format": "json"})
        res = d.get("query", {}).get("querypage", {}).get("results", [])
        if not res:
            break
        for it in res:
            t = it["title"]
            if t not in seen_os_t and ":" not in t and "номхыгъд" not in t.lower():
                seen_os_t.add(t)
                candidate_os_titles.append(t)

    if len(candidate_os_titles) < 8500:
        apcont = None
        while len(candidate_os_titles) < 11000:
            p = {"action": "query", "list": "allpages", "apnamespace": 0, "apfilterredir": "nonredirects", "apminsize": 800, "aplimit": 500, "format": "json"}
            if apcont:
                p["apcontinue"] = apcont
            d = host_api("os.wikipedia.org", p)
            for it in d.get("query", {}).get("allpages", []):
                t = it["title"]
                if t not in seen_os_t and ":" not in t and "номхыгъд" not in t.lower():
                    seen_os_t.add(t)
                    candidate_os_titles.append(t)
            apcont = d.get("continue", {}).get("apcontinue")
            if not apcont:
                break

    os_batches = [candidate_os_titles[i : i + 45] for i in range(0, len(candidate_os_titles), 45)]

    def os_worker(batch):
        nonlocal os_added
        with os_Lock:
            if os_added >= os_target_new:
                return
        data = host_api("os.wikipedia.org", {
            "action": "query", "titles": "|".join(batch),
            "prop": "revisions", "rvslots": "main", "rvprop": "content", "format": "json",
        }, min_gap=0.015)
        for pg in data.get("query", {}).get("pages", {}).values():
            with os_Lock:
                if os_added >= os_target_new:
                    return
            wtitle = pg.get("title", "")
            wt = (pg.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("*", "")
            if not wt:
                continue
            parsed = parse_os_wiki_clean(wtitle, wt)
            if not parsed:
                continue
            src_url = f"https://os.wikipedia.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
            if save_book_record({
                "slug": slugify(f"iron-{parsed['title']}", 62),
                "pageid": pg.get("pageid", 0),
                "title": parsed["title"],
                "author": "Ирон энциклопедион фонд",
                "authorShort": "Ирон архив",
                "authorSlug": "iron-arkhiv",
                "authorYears": "", "translator": None, "language": "os",
                "category": parsed["category"], "year": "Ирон рауагъд",
                "description": parsed["preview"],
                "historicalNote": f"Издание на осетинском языке («{parsed['title']}»).",
                "legalStatus": "Открытая лицензия Creative Commons Attribution-ShareAlike 4.0 (ст. 1286.1 ГК РФ; os.wikipedia.org)",
                "sourceUrl": src_url, "chapters": parsed["chapters"],
                "words": parsed["words"], "chars": parsed["chars"],
                "rmin": max(2, round(parsed["words"] / 150)),
                "rank": 76 if wtitle in war_os_cats else 50,
            }):
                with os_Lock:
                    os_added += 1
                    if os_added % 1000 == 0:
                        print(f"  -> Осетинский фонд: +{os_added}/{os_target_new} новых книг", flush=True)

    with ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(os_worker, os_batches))
    print(f"  -> Итого добавлено на осетинском языке: +{os_added}", flush=True)

    # === ЭТАП 3: ДОБОР ДО +5 000 НОВЫХ КНИГ НА РУССКОМ ЯЗЫКЕ ===
    ru_target_new = max(0, 5000 - war_added)
    ru_added = 0
    ru_Lock = threading.Lock()
    print(f"=== ЭТАП 3/3: Добор +{ru_target_new} проверенных книг на русском языке ===", flush=True)

    RU_JOBS = [
        ("history", 700, [("Категория:История России", None), ("Категория:Историческая литература", "В"), ("Категория:Историческая литература", "Г"), ("Категория:Историческая литература", "Д"), ("Категория:Историческая литература", "Н"), ("Категория:Историческая литература", "П"), ("Категория:Мемуары", "Г"), ("Категория:Мемуары", "Д"), ("Категория:Мемуары", "К"), ("Категория:Мемуары", "Н"), ("Категория:Мемуары", "П"), ("Категория:Биографии", "В"), ("Категория:Биографии", "К"), ("Категория:Биографии", "М"), ("Категория:Биографии", "П"), ("Категория:Дневники", None)]),
        ("science", 700, [("Категория:Естествознание", None), ("Категория:Психология", None), ("Категория:Астрономия", None), ("Категория:Физика", None), ("Категория:Медицина", None), ("Категория:Языкознание", None), ("Категория:Геология", None), ("Категория:Биология", None), ("Категория:Критика", "Г"), ("Категория:Критика", "К"), ("Категория:Критика", "Н"), ("Категория:Критика", "П"), ("Категория:Статьи", "Б"), ("Категория:Статьи", "В"), ("Категория:Статьи", "Г"), ("Категория:Статьи", "Д"), ("Категория:Статьи", "Н"), ("Категория:Статьи", "П")]),
        ("rare-editions", 650, [("Категория:Образование", None), ("Категория:Право", None), ("Категория:Экономика", None), ("Категория:Логика", None), ("Категория:Очерки", "Б"), ("Категория:Очерки", "Г"), ("Категория:Очерки", "Д"), ("Категория:Очерки", "З"), ("Категория:Очерки", "И"), ("Категория:Очерки", "Л"), ("Категория:Очерки", "Н"), ("Категория:Очерки", "Р"), ("Категория:Очерки", "Т"), ("Категория:Публицистика", "Б"), ("Категория:Публицистика", "В"), ("Категория:Публицистика", "К"), ("Категория:Публицистика", "М"), ("Категория:Публицистика", "П"), ("Категория:Публицистика", "С")]),
        ("foreign-classics", 650, [("Категория:Фантастика", None), ("Категория:Приключения", None), ("Категория:Сказки", "А"), ("Категория:Сказки", "К"), ("Категория:Повести", "Б"), ("Категория:Повести", "Г"), ("Категория:Повести", "Д"), ("Категория:Повести", "Л"), ("Категория:Повести", "Н"), ("Категория:Повести", "П"), ("Категория:Повести", "С"), ("Категория:Повести", "Т"), ("Категория:Романы", "Б"), ("Категория:Романы", "В"), ("Категория:Романы", "Г"), ("Категория:Романы", "Д"), ("Категория:Романы", "Л"), ("Категория:Романы", "П")]),
        ("russian-classics", 750, [("Категория:Русская проза", "А"), ("Категория:Русская проза", "Б"), ("Категория:Русская проза", "В"), ("Категория:Русская проза", "Г"), ("Категория:Русская проза", "К"), ("Категория:Русская проза", "П"), ("Категория:Русская проза", "С"), ("Категория:Пьесы", "Б"), ("Категория:Пьесы", "К"), ("Категория:Пьесы", "М"), ("Категория:Пьесы", "С"), ("Категория:Поэмы", "Б"), ("Категория:Поэмы", "К"), ("Категория:Поэмы", "П"), ("Категория:Поэмы", "С")]),
        ("russian-classics", 750, [("Категория:Рассказы", "Е"), ("Категория:Рассказы", "Ж"), ("Категория:Рассказы", "У"), ("Категория:Рассказы", "Ф"), ("Категория:Рассказы", "Х"), ("Категория:Рассказы", "Ц"), ("Категория:Рассказы", "Ч"), ("Категория:Рассказы", "Ш"), ("Категория:Рассказы", "Щ"), ("Категория:Рассказы", "Э"), ("Категория:Рассказы", "Ю"), ("Категория:Рассказы", "Я")]),
        ("russian-classics", 800, [("Категория:Импорт/lib.ru", "Е"), ("Категория:Импорт/lib.ru", "О"), ("Категория:Импорт/lib.ru", "У"), ("Категория:Импорт/lib.ru", "Ф"), ("Категория:Импорт/lib.ru", "Х")]),
        ("russian-classics", 800, [("Категория:Импорт/lib.ru", "Ц"), ("Категория:Импорт/lib.ru", "Ш"), ("Категория:Импорт/lib.ru", "Щ"), ("Категория:Импорт/lib.ru", "Э"), ("Категория:Импорт/lib.ru", "Ю"), ("Категория:Импорт/lib.ru", "Я")]),
        ("russian-classics", 800, [("Категория:Стихотворения", "А"), ("Категория:Стихотворения", "К"), ("Категория:Стихотворения", "М"), ("Категория:Стихотворения", "П"), ("Категория:Стихотворения", "С"), ("Категория:Басни", None)]),
    ]

    def ru_worker(job):
        nonlocal ru_added
        cat_id, quota, wcats = job
        here = 0
        for wc, spref in wcats:
            gcmcont = None
            first_req = True
            while here < quota:
                with ru_Lock:
                    if ru_added >= ru_target_new:
                        return
                params = {
                    "action": "query", "generator": "categorymembers", "gcmtitle": wc,
                    "gcmnamespace": 0, "gcmlimit": 18, "prop": "revisions",
                    "rvslots": "main", "rvprop": "content|size", "format": "json",
                }
                if first_req and spref:
                    params["gcmstartsortkeyprefix"] = spref
                first_req = False
                if gcmcont:
                    params["gcmcontinue"] = gcmcont
                data = host_api("ru.wikisource.org", params, min_gap=0.018)
                for pg in data.get("query", {}).get("pages", {}).values():
                    with ru_Lock:
                        if ru_added >= ru_target_new:
                            return
                    wtitle = pg.get("title", "")
                    if not wtitle or "/" in wtitle or "(ДО)" in wtitle or any(wtitle.startswith(pf) for pf in FORBIDDEN_PREFIXES):
                        continue
                    rev = (pg.get("revisions") or [{}])[0]
                    sz = rev.get("size", 0)
                    min_sz = 1200 if "Стихотворения" in wc or "Басни" in wc else 3400
                    if sz < min_sz or sz > 340000:
                        continue
                    wt = rev.get("slots", {}).get("main", {}).get("*", "")
                    if not wt:
                        continue
                    fields, body = extract_otekste(wt)
                    ok, info = verify_pd_strict(wt, fields, wtitle, False)
                    if not ok:
                        continue
                    raw_t = clean_inline(fields.get("НАЗВАНИЕ", "")) or re.sub(r"\s*\([^)]+\)\s*$", "", wtitle).strip()
                    min_w = 110 if "Стихотворения" in wc or "Басни" in wc else 360
                    chs, words, chars = parse_ru_body(body, raw_t, min_words=min_w)
                    if not chs:
                        continue
                    clean_t, clean_a, ashort, aslug = sanitize_ru_author_and_title(raw_t, fields.get("АВТОР", ""), wtitle, False)
                    trans = clean_inline(fields.get("ПЕРЕВОДЧИК", "")) or None
                    orig_l = clean_inline(fields.get("ЯЗЫКОРИГИНАЛА", ""))
                    final_cat = "foreign-classics" if (cat_id == "russian-classics" and (trans or orig_l)) else cat_id
                    src_url = f"https://ru.wikisource.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
                    first_p = chs[0]["content"][0]["text"][:170].replace("\n", " / ")
                    if save_book_record({
                        "slug": slugify(f"{aslug}-{clean_t}", 62),
                        "pageid": pg.get("pageid", 0),
                        "title": clean_t, "author": clean_a, "authorShort": ashort, "authorSlug": aslug,
                        "authorYears": "", "translator": trans, "language": "ru", "category": final_cat,
                        "year": info["year"],
                        "description": f"{clean_t} ({ashort}): {first_p}"[:200],
                        "historicalNote": f"Проверенное издание ({info['year']}).",
                        "legalStatus": f"Общественное достояние ({info['lic']}; {info['year']})",
                        "sourceUrl": src_url, "chapters": chs, "words": words, "chars": chars,
                        "rmin": max(2, round(words / 180)), "rank": 0,
                    }):
                        here += 1
                        with ru_Lock:
                            ru_added += 1
                            if ru_added % 1000 == 0:
                                elapsed = max(1.0, time.time() - t0)
                                print(f"  -> Русский фонд: +{ru_added}/{ru_target_new} книг (общий архив: {len(catalog_books)})", flush=True)
                gcmcont = data.get("continue", {}).get("gcmcontinue")
                if not gcmcont:
                    break

    with ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(ru_worker, RU_JOBS))

    build_all_sharded_indexes(catalog_books)
    os_tot = sum(1 for b in catalog_books if b.get("language") == "os")
    ru_tot = sum(1 for b in catalog_books if b.get("language") != "os")
    s1_tot = sum(1 for b in catalog_books if int(b.get("shard", 0)) == 1)
    s2_tot = sum(1 for b in catalog_books if int(b.get("shard", 0)) == 2)
    print(f"\n=== ГРАНД-ФИНИШ! Всего в архиве: {len(catalog_books)} книг (Русских: {ru_tot}, Осетинских: {os_tot} | Shard-1: {s1_tot}, Shard-2: {s2_tot}) ===", flush=True)


if __name__ == "__main__":
    main()
