#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Высокоскоростной пакетный сборщик книжного фонда (~1 000+ полных книг на русском языке).
Использует пакетный MediaWiki API (по 50 страниц за 1 HTTP-запрос), проверяет общественное достояние
по ст. 1281–1282 ГК РФ, очищает вики-разметку с сохранением глав, стихов, эпиграфов, курсива и жирного текста,
формирует валидный FictionBook 2.0 (original.fb2), компактный book.json, meta.json и индексы каталога.
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = BASE_DIR / "archive"
BOOKS_DIR = ARCHIVE_DIR / "books"
CATALOG_DIR = ARCHIVE_DIR / "catalog"

HEADERS = {
    "User-Agent": "RaritetBookBatchHarvester/2.0 (https://raritetbook.ru; founder@omelchukdenis.ru) Python/3.11"
}

CATEGORIES_META = [
    {
        "id": "history",
        "slug": "history",
        "title": "История России",
        "subtitle": "Летописи, исторические труды, Российская империя, мемуары и архивные памятники",
        "image": "/assets/images/categories/history.webp",
    },
    {
        "id": "russian-classics",
        "slug": "russian-classics",
        "title": "Русская классика",
        "subtitle": "Золотой фонд русской прозы, поэзии и драматургии XVIII – начала XX века",
        "image": "/assets/images/categories/russian-classics.webp",
    },
    {
        "id": "caucasus",
        "slug": "caucasus",
        "title": "Кавказ и народы России",
        "subtitle": "Исторические хроники, этнография, предания и литература о Кавказе",
        "image": "/assets/images/categories/caucasus.webp",
    },
    {
        "id": "foreign-classics",
        "slug": "foreign-classics",
        "title": "Зарубежная классика",
        "subtitle": "Мировая литература, приключения, фантастика и готика в классических переводах",
        "image": "/assets/images/categories/foreign-classics.webp",
    },
    {
        "id": "science",
        "slug": "science",
        "title": "Наука и философия",
        "subtitle": "Труды русских и мировых учёных, философия, география, психология и естествознание",
        "image": "/assets/images/categories/science.webp",
    },
    {
        "id": "rare-editions",
        "slug": "rare-editions",
        "title": "Редкие издания и учебники",
        "subtitle": "Старинные учебные курсы, педагогика, логика, публицистика и редкие дореволюционные книги",
        "image": "/assets/images/categories/rare-editions.webp",
    },
]

# Сбалансированные источники по 6 рубрикам библиотеки (цель ~1000 новых книг)
CATEGORY_SOURCES = [
    # 1. Кавказ и народы России (на русском языке)
    ("caucasus", 110, [
        "Категория:Этнография",
        "Категория:Кавказские богатыри (Немирович-Данченко)",
        "Категория:Кавказские рассказы (Гнедич, 1894)",
        "Категория:Кавказские сказки, предания и легенды (Черский)",
    ], ["Кавказ", "Осетия", "Дагестан", "Черкес", "Тифлис", "Терская область", "Горцы Кавказа"]),

    # 2. Старинные учебники, педагогика и редкие дореволюционные издания
    ("rare-editions", 130, [
        "Категория:Педагогика",
        "Категория:Логика",
        "Категория:Образование",
        "Категория:Военное дело",
        "Категория:Публицистика XIX века",
        "Категория:Очерки",
    ], ["Учебник", "Гимназия", "Арифметика", "Грамматика", "Педагогика", "Дидактика", "Словесность"]),

    # 3. Наука и философия
    ("science", 160, [
        "Категория:Русская философия",
        "Категория:Философия",
        "Категория:География",
        "Категория:Психология",
        "Категория:Физика",
        "Категория:Астрономия",
        "Категория:Научная фантастика",
        "Категория:Биология",
        "Категория:Естествознание",
    ], ["Циолковский", "Менделеев", "Тимирязев", "Мечников", "Сеченов", "Перельман", "Пржевальский", "Миклухо-Маклай"]),

    # 4. История России и мемуары
    ("history", 210, [
        "Категория:Историческая литература",
        "Категория:Историческая проза",
        "Категория:Мемуары",
        "Категория:Древнерусская литература",
    ], ["История России", "Карамзин", "Костомаров", "Ключевский", "Соловьёв", "Пыляев"]),

    # 5. Зарубежная старинная, приключенческая и готическая классика
    ("foreign-classics", 210, [
        "Категория:Романы Вальтера Скотта",
        "Категория:Романы Жюля Верна",
        "Категория:Романы Герберта Уэллса",
        "Категория:Романы Джека Лондона",
        "Категория:Романы Генри Райдера Хаггарда",
        "Категория:Романы Джеймса Фенимора Купера",
        "Категория:Романы Виктора Гюго",
        "Категория:Рассказы Артура Конан Дойла",
        "Категория:Приключенческая литература",
        "Категория:Фантастика",
    ], ["Эдгар По Бальмонт", "Гофман", "Мопассан", "Диккенс", "Стивенсон", "Шекспир", "Сервантес"]),

    # 6. Русская классика (романы, повести, пьесы, поэмы, рассказы)
    ("russian-classics", 300, [
        "Категория:Романы",
        "Категория:Повести",
        "Категория:Пьесы",
        "Категория:Поэмы",
        "Категория:Рассказы Антона Павловича Чехова",
        "Категория:Рассказы Аркадия Тимофеевича Аверченко",
    ], []),
]

TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "ӕ": "ae", "æ": "ae",
}

FORBIDDEN_TITLE_PREFIXES = (
    "ЭСБЕ/", "МЭСБЕ/", "РБС/", "ВЭ/", "БСЭ", "ЕЭБЕ/", "ПБЭ/", "НЭС/", "ТСД/", "Словарь",
    "Индекс:", "Страница:", "Автор:", "Викитека:", "Шаблон:", "Категория:",
    "Глава ", "Часть ", "Том ", "Песнь ", "Действие ", "Лекция ", "Примечания",
)

BAD_WIKITEXT_MARKERS = (
    "{{не окончено", "{{не завершено", "{{заготовка", "{{нет текста",
    "{{фрагмент", "{{отрывок", "{{уд-", "{{copyvio", "{{несвободн", "{{cc-by",
)


def slugify(text: str, max_len: int = 64) -> str:
    text = text.lower().strip()
    out = []
    for ch in text:
        if ch in TRANSLIT_MAP:
            out.append(TRANSLIT_MAP[ch])
        elif "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
        else:
            out.append("-")
    s = re.sub(r"-+", "-", "".join(out)).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rstrip("-")
    return s or "book"


def ws_api(params: dict, retries: int = 4) -> dict:
    url = "https://ru.wikisource.org/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"API failed: {url}")


def is_candidate_title(title: str, byte_len: int = 20000) -> bool:
    if not title or any(title.startswith(p) for p in FORBIDDEN_TITLE_PREFIXES):
        return False
    # Исключаем подстраницы отдельных глав и дореформенные дубли (/ДО)
    if "/" in title:
        return False
    if "(ДО)" in title or " ДО" in title:
        return False
    # Оптимальный размер полной книги/повести/монографии/пьесы/крупного рассказа: 12 КБ .. 850 КБ
    if byte_len < 12000 or byte_len > 850000:
        return False
    return True


def collect_candidates_from_category(cat_title: str, want: int, seen_titles: set) -> list:
    out = []
    cmcontinue = None
    while len(out) < want:
        params = {
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": cat_title,
            "gcmnamespace": 0,
            "gcmlimit": 500,
            "prop": "info",
            "format": "json",
        }
        if cmcontinue:
            params["gcmcontinue"] = cmcontinue
        time.sleep(0.18)
        data = ws_api(params)
        pages = list(data.get("query", {}).get("pages", {}).values())
        pages.sort(key=lambda p: p.get("title", ""))
        for p in pages:
            t = p.get("title", "")
            ln = p.get("length", 0)
            if t not in seen_titles and is_candidate_title(t, ln):
                seen_titles.add(t)
                out.append((p["pageid"], t, ln))
                if len(out) >= want:
                    break
        cont = data.get("continue", {})
        cmcontinue = cont.get("gcmcontinue")
        if not cmcontinue:
            break
    return out


def collect_candidates_from_search(query: str, want: int, seen_titles: set) -> list:
    out = []
    sroffset = 0
    while len(out) < want and sroffset < 200:
        params = {
            "action": "query",
            "list": "search",
            "srsearch": f'{query} insource:"Отексте"',
            "srnamespace": 0,
            "srlimit": 50,
            "sroffset": sroffset,
            "format": "json",
        }
        time.sleep(0.2)
        data = ws_api(params)
        hits = data.get("query", {}).get("search", [])
        if not hits:
            break
        for h in hits:
            t = h.get("title", "")
            ln = h.get("size", 0)
            if t not in seen_titles and is_candidate_title(t, ln):
                seen_titles.add(t)
                out.append((h["pageid"], t, ln))
                if len(out) >= want:
                    break
        if "continue" not in data:
            break
        sroffset = data["continue"].get("sroffset", sroffset + 50)
    return out


def extract_otekste_and_body(wikitext: str):
    """
    Извлекает поля шаблона {{Отексте ...}} с учётом вложенных фигурных скобок и возвращает (fields_dict, body_wikitext).
    """
    m = re.search(r"\{\{\s*(?:Отексте|отексте|О\s+тексте)\b", wikitext)
    if not m:
        return {}, wikitext

    start = m.start()
    depth = 0
    end = len(wikitext)
    i = start
    n = len(wikitext)
    while i < n - 1:
        two = wikitext[i : i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        elif two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                end = i
                break
            continue
        i += 1

    tmpl_raw = wikitext[start + 2 : end - 2]
    body = wikitext[:start] + "\n" + wikitext[end:]

    # Разбиваем по '|' верхнего уровня
    fields = {}
    cur = []
    d_brace = 0
    d_brack = 0
    j = 0
    tl = len(tmpl_raw)
    while j < tl:
        if tmpl_raw[j : j + 2] == "{{":
            d_brace += 1
            cur.append("{{")
            j += 2
            continue
        if tmpl_raw[j : j + 2] == "}}":
            d_brace = max(0, d_brace - 1)
            cur.append("}}")
            j += 2
            continue
        if tmpl_raw[j : j + 2] == "[[":
            d_brack += 1
            cur.append("[[")
            j += 2
            continue
        if tmpl_raw[j : j + 2] == "]]":
            d_brack = max(0, d_brack - 1)
            cur.append("]]")
            j += 2
            continue
        ch = tmpl_raw[j]
        if ch == "|" and d_brace == 0 and d_brack == 0:
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


def clean_wiki_inline(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)
    # Ссылки [[Страница|Текст]] -> Текст, [[Текст]] -> Текст
    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)
    # Полезные инлайн-шаблоны до удаления прочих шаблонов
    s = re.sub(r"\{\{(?:разрядка|р|курсив)\|([^{}|]+)\}\}", r"''\1''", s, flags=re.I)
    s = re.sub(r"\{\{(?:опечатка|оп)\|[^{}|]*\|([^{}|]+)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{(?:lang|lang-[a-z]+)\|[^{}|]*\|([^{}|]+)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{(?:nbsp|s)\}\}", " ", s, flags=re.I)
    s = re.sub(r"\{\{(?:---|—)\}\}", "—", s)
    # Удаляем оставшиеся шаблоны (до 4 уровней вложенности)
    for _ in range(4):
        ns = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if ns == s:
            break
        s = ns
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def verify_legal_and_russian(page_title: str, wt: str, fields: dict):
    """
    Строгая юридическая (ст. 1281–1282 ГК РФ) и языковая (русский язык, современная орфография) проверка.
    Возвращает (ok: bool, reason_or_info: dict|str).
    """
    wt_low = wt.lower()
    for bad in BAD_WIKITEXT_MARKERS:
        if bad in wt_low:
            return False, f"marker:{bad}"

    if not fields:
        return False, "no_otekste"

    # Если это отрывок с навигацией по главам без самостоятельного произведения
    if (fields.get("ПРЕДЫДУЩИЙ") or fields.get("СЛЕДУЮЩИЙ")) and not fields.get("ИЗСБОРНИКА") and not fields.get("ИЗЦИКЛА"):
        # Допускаем только если это самостоятельный том/книга (размер > 45 КБ)
        if len(wt) < 45000:
            return False, "part_of_sequence"

    lic = fields.get("ЛИЦЕНЗИЯ", "")
    raw_author = fields.get("АВТОР", "")
    raw_pub = " ".join([
        fields.get("ДАТАПУБЛИКАЦИИ", ""),
        fields.get("ПЕРВАЯПУБЛИКАЦИЯ", ""),
        fields.get("ДАТАСОЗДАНИЯ", ""),
        fields.get("ГОД", ""),
    ])
    raw_trans = fields.get("ПЕРЕВОДЧИК", "")

    # Извлекаем годы публикации
    years = [int(y) for y in re.findall(r"\b(1[5-9]\d{2}|20[0-2]\d)\b", raw_pub)]
    cat_years = [int(y) for y in re.findall(r"Категория:[^\]]*?\b(1[5-9]\d{2}|20[0-2]\d)\s+года", wt)]
    all_years = years + cat_years
    min_year = min(all_years) if all_years else None

    # Годы жизни автора/переводчика, если указаны в поле (напр. 1841—1905)
    author_deaths = [int(y) for y in re.findall(r"[—–-]\s*(1[6-9]\d{2}|20\d{2})", raw_author)]
    trans_deaths = [int(y) for y in re.findall(r"[—–-]\s*(1[6-9]\d{2}|20\d{2})", raw_trans)]

    if any(d > 1951 for d in author_deaths) or any(d > 1951 for d in trans_deaths):
        return False, "death_after_1951"

    is_pd_tag = ("pd" in lic.lower()) or ("од-" in lic.lower()) or ("общественное достояние" in wt_low) or ("pd-" in wt_low)

    if raw_trans:
        # Для переводов требуем особо строгий порог: либо публикация перевода <= 1938 г., либо смерть переводчика <= 1948 г.
        if trans_deaths and max(trans_deaths) <= 1948:
            pass
        elif min_year and min_year <= 1938:
            pass
        else:
            return False, "translation_year_unverified"
    else:
        if author_deaths and max(author_deaths) <= 1950:
            pass
        elif min_year and min_year <= 1942:
            pass
        elif is_pd_tag and (min_year is None or min_year <= 1945):
            pass
        else:
            return False, "pub_year_unverified"

    return True, {
        "min_year": str(min_year) if min_year else "XIX — нач. XX в.",
        "lic": lic or "PD-rus / ст. 1281–1282 ГК РФ",
    }


def wikitext_to_chapters(body: str, fallback_title: str) -> tuple[list, int, int]:
    """
    Чистит корпус викитекста и преобразует его в список глав с блоками
    paragraph, poem, epigraph, subtitle, quote и инлайн-выделениями <em>/<strong>.
    Возвращает (chapters, total_words, cyrillic_count).
    """
    s = body
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    # Отрезаем служебный хвост категорий и примечаний в конце
    s = re.sub(r"\[\[\s*(?:Категория|Category)\s*:[^\]]+\]\]", "", s, flags=re.I)
    s = re.sub(r"__(?:NOTOC|TOC|NOEDITSECTION)__", "", s, flags=re.I)

    # Удаляем иллюстрации и служебные блоки файлов
    s = re.sub(r"\[\[\s*(?:Файл|File|Изображение|Image)\s*:[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]", "", s, flags=re.I)
    s = re.sub(r"\{\{(?:ifloat|иллюстрация|img| float)[^}]*\}\}", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)
    s = re.sub(r"<references\s*/?>", "", s, flags=re.I)

    # Эпиграфы и заголовки в шаблонах
    def repl_epigraph(m):
        inner = m.group(1)
        parts = [clean_wiki_inline(p) for p in inner.split("|") if clean_wiki_inline(p)]
        if not parts:
            return ""
        txt = "\n".join(parts[:2])
        return f"\n\n@@EPIGRAPH_START@@\n{txt}\n@@EPIGRAPH_END@@\n\n"

    s = re.sub(r"\{\{\s*(?:эпиграф|epigraph)\s*\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}", repl_epigraph, s, flags=re.I)
    s = re.sub(r"\{\{\s*heading\s*\|\s*\d+\s*\|([^{}|]+)(?:\|[^{}]*)?\}\}", r"\n== \1 ==\n", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:разрядка|р|курсив)\s*\|([^{}|]+)\}\}", r"''\1''", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:центрировать|center|right)\s*\|([^{}|]+)\}\}", r"\n\1\n", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:опечатка|оп)\s*\|[^{}|]*\|([^{}|]+)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:lang|lang-[a-z]+)\s*\|[^{}|]*\|([^{}|]+)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:nbsp|s)\s*\}\}", " ", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:---|—)\s*\}\}", "—", s)
    s = re.sub(r"\{\{\s*(?:asterism|\*\*\*|звёздочки|звездочки)\s*(?:\|[^{}]*)?\}\}", "\n\n* * *\n\n", s, flags=re.I)

    # Выделяем <poem>...</poem> в защищённые маркеры
    poems_store = []

    def save_poem(m):
        idx = len(poems_store)
        poems_store.append(m.group(1))
        return f"\n\n@@POEM_{idx}@@\n\n"

    s = re.sub(r"<poem[^>]*>(.*?)</poem>", save_poem, s, flags=re.I | re.S)

    # Удаляем остальные шаблоны {{...}} (до 5 уровней)
    for _ in range(5):
        ns = re.sub(r"\{\{[^{}]*\}\}", "", s)
        if ns == s:
            break
        s = ns

    # Вики-ссылки -> чистый текст
    s = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://[^\]]+\]", "", s)

    # Переводы строк <br>
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    # Снимаем прочие HTML-обёртки (div, span, center, table и т.п.)
    s = re.sub(r"</?(?:div|span|center|blockquote|section|pages|table|tr|td|th|small|big|font|sup|sub)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)

    def format_inline(line: str) -> tuple[str, str | None]:
        # Преобразуем '''bold''' и ''italic'' в <strong> / <em>, остальное экранируем
        plain = line.replace("'''", "").replace("''", "").strip()
        plain = re.sub(r"[ \t]+", " ", plain)
        if "''" not in line:
            return plain, None
        esc = html.escape(re.sub(r"[ \t]+", " ", line.strip()), quote=False)
        esc = re.sub(r"'''(.+?)'''", r"<strong>\1</strong>", esc)
        esc = re.sub(r"''(.+?)''", r"<em>\1</em>", esc)
        esc = esc.replace("'''", "").replace("''", "")
        if "<strong>" in esc or "<em>" in esc:
            return plain, esc
        return plain, None

    items = []
    in_epigraph = False
    ep_lines = []

    raw_blocks = re.split(r"\n\s*\n+", s)
    for rb in raw_blocks:
        rb_strip = rb.strip()
        if not rb_strip:
            continue

        if "@@EPIGRAPH_START@@" in rb_strip:
            ep_txt = rb_strip.replace("@@EPIGRAPH_START@@", "").replace("@@EPIGRAPH_END@@", "").strip()
            clean_ep = "\n".join(format_inline(l)[0] for l in ep_txt.splitlines() if format_inline(l)[0])
            if clean_ep:
                items.append({"type": "epigraph", "text": clean_ep})
            continue

        m_poem = re.fullmatch(r"@@POEM_(\d+)@@", rb_strip)
        if m_poem:
            p_raw = poems_store[int(m_poem.group(1))]
            p_raw = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", p_raw)
            p_raw = re.sub(r"\{\{[^{}]*\}\}", "", p_raw)
            p_raw = re.sub(r"<[^>]+>", "", html.unescape(p_raw))
            stanzas = []
            for chunk in re.split(r"\n\s*\n+", p_raw.strip()):
                vlines = [format_inline(vl)[0] for vl in chunk.splitlines() if format_inline(vl)[0]]
                if vlines:
                    stanzas.append(vlines)
            if stanzas:
                flat = "\n\n".join("\n".join(st) for st in stanzas)
                items.append({"type": "poem", "stanzas": stanzas, "text": flat})
            continue

        # Проверяем построчно на вики-заголовки == ... ==
        lines = [ln.strip() for ln in rb_strip.splitlines() if ln.strip()]
        buf_para = []

        def flush_para():
            nonlocal buf_para
            if not buf_para:
                return
            joined = " ".join(buf_para)
            buf_para = []
            plain, rich = format_inline(joined)
            if not plain or plain in ("Примечания", "Сноски"):
                return
            if "общественное достояние" in plain.lower() and len(plain) < 240:
                return
            # Римские цифры как подзаголовки глав, если короткая строка
            if re.fullmatch(r"(?:Глава\s+|Часть\s+)?[IVXLCDM]+\.?", plain) and len(plain) <= 20:
                items.append({"type": "h2", "text": plain.rstrip(".")})
                return
            blk = {"type": "paragraph", "text": plain}
            if rich:
                blk["html"] = rich
            items.append(blk)

        for ln in lines:
            mh = re.match(r"^(=+)\s*(.+?)\s*\1$", ln)
            if mh:
                flush_para()
                lvl = len(mh.group(1))
                htxt = format_inline(mh.group(2))[0]
                if htxt and htxt.lower() not in ("примечания", "сноски", "литература", "см. также"):
                    if lvl <= 2:
                        items.append({"type": "h2", "text": htxt})
                    elif lvl == 3:
                        items.append({"type": "h3", "text": htxt})
                    else:
                        items.append({"type": "subtitle", "text": htxt})
                continue

            mp = re.fullmatch(r"@@POEM_(\d+)@@", ln)
            if mp:
                flush_para()
                p_raw = poems_store[int(mp.group(1))]
                p_raw = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"\{\{[^{}]*\}\}", "", p_raw)))
                stanzas = [
                    [format_inline(vl)[0] for vl in ch.splitlines() if format_inline(vl)[0]]
                    for ch in re.split(r"\n\s*\n+", p_raw.strip())
                ]
                stanzas = [st for st in stanzas if st]
                if stanzas:
                    items.append({"type": "poem", "stanzas": stanzas, "text": "\n\n".join("\n".join(st) for st in stanzas)})
                continue

            # Диалоги с тире или списки начинаем новым абзацем
            if ln.startswith(("—", "–", "* ", "# ")):
                flush_para()
                ln = re.sub(r"^[*#]\s+", "", ln)
                buf_para.append(ln)
                flush_para()
            else:
                buf_para.append(ln)

        flush_para()

    if not items:
        return [], 0, 0

    all_text = " ".join(x.get("text", "") for x in items)
    words = len(all_text.split())
    cyr_chars = len(re.findall(r"[а-яёА-ЯЁ]", all_text))
    lat_chars = len(re.findall(r"[a-zA-Z]", all_text))
    old_yat = all_text.count("ѣ") + all_text.count("Ѣ")

    # Строгий контроль: чистый русский текст в современной орфографии, минимум 1 200 слов
    if words < 1200:
        return [], words, 0
    if cyr_chars < (cyr_chars + lat_chars) * 0.75:
        return [], words, 0
    if old_yat > len(all_text) * 0.002:
        return [], words, 0

    # Разбивка на главы
    h2_cnt = sum(1 for x in items if x["type"] == "h2")
    h3_cnt = sum(1 for x in items if x["type"] == "h3")
    sub_cnt = sum(1 for x in items if x["type"] == "subtitle")
    split_type = "h2" if h2_cnt >= 2 else ("h3" if h3_cnt >= 2 else ("subtitle" if sub_cnt >= 2 else None))

    chapters = []
    if split_type:
        cur_t = "Вступление"
        cur_c = []
        for x in items:
            if x["type"] == split_type:
                if cur_c:
                    chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
                    cur_c = []
                cur_t = x["text"]
            elif x["type"] in ("h2", "h3"):
                cur_c.append({"type": "subtitle", "text": x["text"]})
            else:
                cur_c.append(x)
        if cur_c:
            chapters.append({"id": f"chapter-{len(chapters)+1}", "title": cur_t, "content": cur_c})
    else:
        content = [
            ({"type": "subtitle", "text": x["text"]} if x["type"] in ("h2", "h3") else x)
            for x in items
        ]
        if len(content) > 100:
            chunk = 55
            chapters = [
                {"id": f"chapter-{idx+1}", "title": f"Часть {idx+1}", "content": content[i : i + chunk]}
                for idx, i in enumerate(range(0, len(content), chunk))
            ]
        else:
            chapters = [{"id": "chapter-1", "title": fallback_title, "content": content}]

    return chapters, words, len(all_text)


def xml_escape(s: str) -> str:
    # Удаляем недопустимые в XML 1.0 управляющие символы
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def inline_to_fb2(blk: dict) -> str:
    if "html" in blk:
        s = blk["html"]
        s = s.replace("<em>", "\x01EO\x02").replace("</em>", "\x01EC\x02")
        s = s.replace("<strong>", "\x01SO\x02").replace("</strong>", "\x01SC\x02")
        s = re.sub(r"<[^>]+>", "", s)
        s = xml_escape(html.unescape(s))
        s = (
            s.replace("\x01EO\x02", "<emphasis>")
            .replace("\x01EC\x02", "</emphasis>")
            .replace("\x01SO\x02", "<strong>")
            .replace("\x01SC\x02", "</strong>")
        )
        if s.count("<emphasis>") == s.count("</emphasis>") and s.count("<strong>") == s.count("</strong>"):
            return s
    return xml_escape(blk["text"])


def build_fb2_fast(meta: dict, chapters: list) -> str:
    parts = [p for p in re.split(r"\s+", meta["author"]) if p]
    first_name = parts[0] if parts else meta["author"]
    last_name = parts[-1] if len(parts) > 1 else ""
    middle_name = " ".join(parts[1:-1]) if len(parts) > 2 else ""

    genre_map = {
        "history": "sci_history",
        "russian-classics": "prose_rus_classic",
        "caucasus": "prose_history",
        "foreign-classics": "prose_classic",
        "science": "science",
        "rare-editions": "sci_educational",
    }
    fb2_genre = genre_map.get(meta["category"], "antique")

    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
        "<description><title-info>",
        f"<genre>{fb2_genre}</genre>",
        f"<author><first-name>{xml_escape(first_name)}</first-name><middle-name>{xml_escape(middle_name)}</middle-name><last-name>{xml_escape(last_name)}</last-name></author>",
        f"<book-title>{xml_escape(meta['title'])}</book-title>",
        f"<annotation><p>{xml_escape(meta['description'])}</p><p>{xml_escape(meta['legalStatus'])}</p></annotation>",
        f"<date>{xml_escape(str(meta['writtenYear']))}</date>",
        "<lang>ru</lang>",
    ]
    if meta.get("translator"):
        out.append(f"<translator><nickname>{xml_escape(meta['translator'])}</nickname></translator>")
    out.extend([
        "</title-info><document-info>",
        "<author><nickname>RaritetBook.ru Digital Archive</nickname></author>",
        f"<src-url>{xml_escape(meta['sourceUrl'])}</src-url>",
        f"<id>{xml_escape(meta['slug'])}</id><version>1.0</version>",
        "</document-info><publish-info>",
        f"<book-name>{xml_escape(meta['title'])}</book-name>",
        "<publisher>RaritetBook.ru</publisher>",
        f"<year>{xml_escape(str(meta['editionYear']))}</year>",
        "</publish-info></description><body>",
        f"<title><p>{xml_escape(meta['authorShort'])}</p><p>{xml_escape(meta['title'])}</p></title>",
    ])

    for ch in chapters:
        out.append(f'<section id="{xml_escape(ch["id"])}"><title><p>{xml_escape(ch["title"])}</p></title>')
        for blk in ch["content"]:
            bt = blk["type"]
            if bt == "epigraph":
                out.append("<epigraph>")
                for ln in blk["text"].splitlines():
                    if ln.strip():
                        out.append(f"<p>{xml_escape(ln.strip())}</p>")
                out.append("</epigraph>")
            elif bt == "subtitle":
                out.append(f"<subtitle>{xml_escape(blk['text'])}</subtitle>")
            elif bt == "poem":
                out.append("<poem>")
                for st in blk.get("stanzas", []):
                    out.append("<stanza>")
                    for v in st:
                        out.append(f"<v>{xml_escape(v)}</v>")
                    out.append("</stanza>")
                out.append("</poem>")
            else:
                out.append(f"<p>{inline_to_fb2(blk)}</p>")
        out.append("</section>")

    out.append("</body></FictionBook>")
    xml_str = "\n".join(out)
    ET.fromstring(xml_str.encode("utf-8"))
    return xml_str


def format_short_author(full_name: str) -> str:
    clean = re.sub(r"\([^)]*\)", "", full_name).strip()
    parts = [p for p in clean.split() if p]
    if len(parts) == 3:
        return f"{parts[0][0]}. {parts[1][0]}. {parts[2]}"
    if len(parts) == 2:
        return f"{parts[0][0]}. {parts[1]}"
    return clean or "Неизвестный автор"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=1000, help="Целевое общее число книг в архиве")
    args = ap.parse_args()

    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)

    # Сканируем ВСЕ уже сохранённые книги на диске (включая прерванные батчи), чтобы ничего не потерять
    catalog_books = []
    seen_slugs = set()
    seen_source_urls = set()
    seen_titles = set()
    existing_by_cat = {}

    for meta_file in sorted(BOOKS_DIR.glob("*/*/meta.json")):
        try:
            m = json.loads(meta_file.read_text(encoding="utf-8"))
            st = m.get("stats", {})
            rel_base = f"/archive/books/{m['authorSlug']}/{m['slug']}"
            catalog_books.append({
                "id": m["id"],
                "slug": m["slug"],
                "title": m["title"],
                "altTitles": m.get("altTitles", []),
                "author": m["author"],
                "authorShort": m["authorShort"],
                "authorSlug": m["authorSlug"],
                "authorYears": m.get("authorYears", ""),
                "translator": m.get("translator"),
                "language": m.get("language", "ru"),
                "category": m["category"],
                "writtenYear": m.get("writtenYear", ""),
                "editionYear": m.get("editionYear", ""),
                "description": m.get("description", "")[:240],
                "historicalNote": m.get("historicalNote", "")[:240],
                "legalStatus": m.get("legalStatus", ""),
                "sourceUrl": m.get("sourceUrl", ""),
                "downloadAllowed": m.get("downloadAllowed", True),
                "bookUrl": f"{rel_base}/book.json",
                "fb2Url": m.get("fb2Url", f"{rel_base}/original.fb2"),
                "coverUrl": m.get("coverUrl", f"{rel_base}/cover.webp"),
                "chaptersCount": st.get("chaptersCount", 1),
                "wordsCount": st.get("wordsCount", 0),
                "charsCount": st.get("charsCount", 0),
                "readingMinutes": st.get("readingMinutes", 5),
            })
            seen_slugs.add(m["slug"])
            seen_source_urls.add(m.get("sourceUrl", ""))
            seen_titles.add(m["title"].lower())
            existing_by_cat[m["category"]] = existing_by_cat.get(m["category"], 0) + 1
        except Exception:
            continue

    print(f"Уже на диске полных книг: {len(catalog_books)} ({existing_by_cat}). Цель: {args.target}.", flush=True)

    # 1. Собираем пул кандидатов только для тех рубрик, где ещё не набрана целевая квота
    candidates_by_cat = []
    global_seen_wiki_titles = set()

    for cat_id, base_quota, wiki_cats, search_terms in CATEGORY_SOURCES:
        already = existing_by_cat.get(cat_id, 0)
        rem_goal = max(0, base_quota - already)
        if cat_id == "russian-classics":
            rem_goal = max(rem_goal, args.target - len(catalog_books))
        if rem_goal <= 0:
            print(f"Категория [{cat_id}]: квота уже выполнена ({already} книг), пропуск сканирования.", flush=True)
            continue
        quota_needed = max(20, int(round(rem_goal * 3.5)))
        bucket = []
        for wc in wiki_cats:
            if len(bucket) >= quota_needed:
                break
            got = collect_candidates_from_category(wc, quota_needed - len(bucket), global_seen_wiki_titles)
            bucket.extend(got)
        for st in search_terms:
            if len(bucket) >= quota_needed:
                break
            got = collect_candidates_from_search(st, min(50, quota_needed - len(bucket)), global_seen_wiki_titles)
            bucket.extend(got)
        print(f"Категория [{cat_id}]: найдено кандидатов = {len(bucket)} (нужно добрать ~{rem_goal})", flush=True)
        candidates_by_cat.append((cat_id, rem_goal, bucket))

    # 2. Пакетная загрузка по 20 страниц за 1 HTTP-запрос (чтобы крупные романы не упирались в лимит ответа API)
    added_total = 0
    stats_rejected = {}

    for cat_id, cat_goal, bucket in candidates_by_cat:
        if len(catalog_books) >= args.target:
            break
        cat_added = 0
        effective_goal = cat_goal if cat_id != "russian-classics" else (args.target - len(catalog_books))

        for b_start in range(0, len(bucket), 20):
            if cat_added >= effective_goal or len(catalog_books) >= args.target:
                break
            batch = bucket[b_start : b_start + 20]
            pids = "|".join(str(x[0]) for x in batch)
            time.sleep(0.22)
            try:
                res = ws_api({
                    "action": "query",
                    "pageids": pids,
                    "prop": "revisions",
                    "rvslots": "main",
                    "rvprop": "content",
                    "format": "json",
                })
            except Exception as exc:
                print(f"  [WARN] Ошибка батча API: {exc}", flush=True)
                continue

            pages_map = res.get("query", {}).get("pages", {})
            for pid, wtitle, _ in batch:
                if cat_added >= effective_goal or len(catalog_books) >= args.target:
                    break
                pobj = pages_map.get(str(pid))
                if not pobj or not pobj.get("revisions"):
                    continue
                slots = pobj["revisions"][0].get("slots", {})
                wt = slots.get("main", {}).get("*", "")
                if not wt:
                    continue

                fields, body = extract_otekste_and_body(wt)
                ok, info = verify_legal_and_russian(wtitle, wt, fields)
                if not ok:
                    stats_rejected[info] = stats_rejected.get(info, 0) + 1
                    continue

                raw_title = clean_wiki_inline(fields.get("НАЗВАНИЕ", "")) or re.sub(r"\s*\([^)]+\)\s*$", "", wtitle).strip()
                raw_sub = clean_wiki_inline(fields.get("ПОДЗАГОЛОВОК", ""))
                raw_author_field = fields.get("АВТОР", "")
                years_match = re.search(r"\((\d{4}\s*[—–-]\s*\d{4})\)", raw_author_field)
                author_years = years_match.group(1).replace("-", "–").replace("—", "–") if years_match else ""
                clean_author = clean_wiki_inline(re.sub(r"\([^)]*\)", "", raw_author_field)).strip()
                if not clean_author:
                    m_paren = re.search(r"\(([^);]+)\)\s*$", wtitle)
                    clean_author = m_paren.group(1).strip() if m_paren else "Неизвестный автор"

                translator = clean_wiki_inline(fields.get("ПЕРЕВОДЧИК", "")) or None
                orig_lang = clean_wiki_inline(fields.get("ЯЗЫКОРИГИНАЛА", ""))

                # Автоуточнение рубрики: если в русской классике попался переводной роман -> в зарубежную классику!
                final_cat = cat_id
                if final_cat == "russian-classics" and (translator or orig_lang):
                    final_cat = "foreign-classics"

                author_slug = slugify(clean_author.split()[-1] if clean_author != "Неизвестный автор" else "anonim", 32)
                book_slug = slugify(f"{author_slug}-{raw_title}", 72)
                if book_slug in seen_slugs or raw_title.lower() in seen_titles:
                    continue

                src_url = f"https://ru.wikisource.org/wiki/{urllib.parse.quote(wtitle.replace(' ', '_'))}"
                if src_url in seen_source_urls:
                    continue

                chapters, word_count, char_count = wikitext_to_chapters(body, raw_title)
                if not chapters:
                    stats_rejected["body_filter"] = stats_rejected.get("body_filter", 0) + 1
                    continue

                source_bib = clean_wiki_inline(fields.get("ИСТОЧНИК", ""))
                other_note = clean_wiki_inline(fields.get("ДРУГОЕ", ""))
                first_para = ""
                for ch in chapters:
                    for blk in ch["content"]:
                        if blk["type"] == "paragraph" and len(blk["text"]) > 80:
                            first_para = blk["text"][:260].rsplit(" ", 1)[0] + "…"
                            break
                    if first_para:
                        break

                desc_parts = [p for p in [raw_sub, other_note] if p]
                description = ". ".join(desc_parts)[:320] if desc_parts else (
                    first_para or f"Полное издание произведения «{raw_title}» ({clean_author})."
                )
                hist_note = (
                    f"Издание из открытого цифрового архива. Источник текста: {source_bib[:280]}."
                    if source_bib
                    else f"Произведение «{raw_title}» ({info['min_year']}), проверенное на переход в общественное достояние."
                )

                pub_year = info["min_year"]
                legal_str = (
                    f"Общественное достояние (ст. 1281, 1282 ГК РФ; {info['lic']}; публикация: {pub_year})"
                )
                reading_min = max(4, round(word_count / 180))
                author_short = format_short_author(clean_author)
                rel_base = f"/archive/books/{author_slug}/{book_slug}"

                book_payload = {
                    "id": book_slug,
                    "slug": book_slug,
                    "title": raw_title,
                    "altTitles": [raw_sub] if raw_sub else [],
                    "author": clean_author,
                    "authorShort": author_short,
                    "authorSlug": author_slug,
                    "authorYears": author_years,
                    "translator": translator,
                    "language": "ru",
                    "category": final_cat,
                    "writtenYear": clean_wiki_inline(fields.get("ДАТАСОЗДАНИЯ", "")) or pub_year,
                    "editionYear": pub_year,
                    "description": description,
                    "historicalNote": hist_note,
                    "sourceUrl": src_url,
                    "legalStatus": legal_str,
                    "downloadAllowed": True,
                    "fb2Url": f"{rel_base}/original.fb2",
                    "coverUrl": f"{rel_base}/cover.webp",
                    "stats": {
                        "chaptersCount": len(chapters),
                        "wordsCount": word_count,
                        "charsCount": char_count,
                        "readingMinutes": reading_min,
                    },
                    "toc": [{"id": c["id"], "title": c["title"]} for c in chapters],
                    "chapters": chapters,
                }

                try:
                    fb2_xml = build_fb2_fast(book_payload, chapters)
                except Exception:
                    stats_rejected["xml_err"] = stats_rejected.get("xml_err", 0) + 1
                    continue

                bdir = BOOKS_DIR / author_slug / book_slug
                bdir.mkdir(parents=True, exist_ok=True)
                (bdir / "original.fb2").write_text(fb2_xml, encoding="utf-8")
                (bdir / "book.json").write_text(
                    json.dumps(book_payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                meta_only = {k: v for k, v in book_payload.items() if k != "chapters"}
                (bdir / "meta.json").write_text(
                    json.dumps(meta_only, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

                catalog_books.append({
                    "id": book_slug,
                    "slug": book_slug,
                    "title": raw_title,
                    "altTitles": book_payload["altTitles"],
                    "author": clean_author,
                    "authorShort": author_short,
                    "authorSlug": author_slug,
                    "authorYears": author_years,
                    "translator": translator,
                    "language": "ru",
                    "category": final_cat,
                    "writtenYear": book_payload["writtenYear"],
                    "editionYear": pub_year,
                    "description": description[:240],
                    "historicalNote": hist_note[:240],
                    "legalStatus": legal_str,
                    "sourceUrl": src_url,
                    "downloadAllowed": True,
                    "bookUrl": f"{rel_base}/book.json",
                    "fb2Url": f"{rel_base}/original.fb2",
                    "coverUrl": f"{rel_base}/cover.webp",
                    "chaptersCount": len(chapters),
                    "wordsCount": word_count,
                    "charsCount": char_count,
                    "readingMinutes": reading_min,
                })

                seen_slugs.add(book_slug)
                seen_titles.add(raw_title.lower())
                seen_source_urls.add(src_url)
                cat_added += 1
                added_total += 1

                if len(catalog_books) % 50 == 0:
                    print(
                        f"  --> Собрано книг: {len(catalog_books)}/{args.target} (последняя: {author_short} — «{raw_title}», {word_count:,} слов)",
                        flush=True,
                    )

        print(f"Завершена рубрика [{cat_id}]: +{cat_added} новых книг (всего в фонде: {len(catalog_books)})", flush=True)

    # Сохраняем обновлённые индексы каталога
    cat_counts = {}
    for b in catalog_books:
        cat_counts[b["category"]] = cat_counts.get(b["category"], 0) + 1

    categories_out = []
    for cm in CATEGORIES_META:
        c_copy = dict(cm)
        c_copy["booksCount"] = cat_counts.get(cm["id"], 0)
        categories_out.append(c_copy)

    authors_map = {}
    for b in catalog_books:
        aslug = b["authorSlug"]
        if aslug not in authors_map:
            authors_map[aslug] = {
                "slug": aslug,
                "name": b["author"],
                "shortName": b["authorShort"],
                "years": b.get("authorYears", ""),
                "booksCount": 0,
            }
        authors_map[aslug]["booksCount"] += 1

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    catalog_payload = {
        "version": f"2.0.{len(catalog_books)}",
        "generatedAt": now_iso,
        "totalBooks": len(catalog_books),
        "books": catalog_books,
    }

    (CATALOG_DIR / "catalog.json").write_text(
        json.dumps(catalog_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (CATALOG_DIR / "categories.json").write_text(
        json.dumps(categories_out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (CATALOG_DIR / "authors.json").write_text(
        json.dumps(list(authors_map.values()), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    total_words = sum(b.get("wordsCount", 0) for b in catalog_books)
    reg_lines = [
        "# Юридический реестр книжного фонда RaritetBook.ru",
        "",
        f"- **Дата обновления:** `{now_iso}`",
        f"- **Всего полных книг в архиве:** **{len(catalog_books)}**",
        f"- **Суммарный объём фонда:** **{total_words:,} слов**",
        "- **Правовое основание:** статьи 1281 и 1282 Гражданского кодекса РФ (общественное достояние).",
        "",
        "## Сводка по рубрикам",
        "",
        "| Категория | Код | Количество книг |",
        "| :--- | :--- | --: |",
    ]
    for c in categories_out:
        reg_lines.append(f"| {c['title']} | `{c['id']}` | **{c['booksCount']}** |")

    reg_lines.extend([
        "",
        "## Полный реестр произведений",
        "",
        "| № | Произведение | Автор | Переводчик | Рубрика | Год | Глав | Слов |",
        "| --: | :--- | :--- | :--- | :--- | :--- | --: | --: |",
    ])
    for idx, b in enumerate(catalog_books, start=1):
        tr = b.get("translator") or "Оригинал"
        reg_lines.append(
            f"| {idx} | {b['title']} (`{b['slug']}`) | {b['authorShort']} | {tr} | `{b['category']}` | {b['editionYear']} | {b['chaptersCount']} | {b['wordsCount']:,} |"
        )
    (ARCHIVE_DIR / "LEGAL_REGISTER.md").write_text("\n".join(reg_lines) + "\n", encoding="utf-8")

    print(
        f"\n=== УСПЕХ! В архиве {len(catalog_books)} книг (+{added_total} новых), всего слов: {total_words:,} ===",
        flush=True,
    )
    print(f"Статистика отсева фильтрами качества/прав: {stats_rejected}", flush=True)


if __name__ == "__main__":
    main()
