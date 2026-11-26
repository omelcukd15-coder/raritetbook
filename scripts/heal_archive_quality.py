#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Глубокая ревизия и исправление качества всех 16 050 книг архива:
1. Точная переклассификация рубрик (убираем Миклухо-Маклая, Арсеньева, Бичурина, сказки и др. из «Кавказа» в профильные разделы;
   разводим учёных -> science, историков -> history, педагогов -> rare-editions, зарубежных классиков -> foreign-classics).
2. Исправление битых авторов (незакрытые скобки дат вроде «Тынянов (1894—1943(», годы вместо автора «1804»/«1907»,
   очерки с криптонимами вроде «Н. Р. Н.Н. Миклуха-Маклай», монархи «Екатерина II», лишние внешние скобки в названиях).
3. Академическая зачистка оглавлений (TOC):
   - В «Евгении Онегине» и других классических изданиях сворачиваем подразделы внутри «Примечаний»/«Комментариев»,
     чтобы главы примечаний не дублировали главы основного текста в оглавлении.
   - Убираем мусорные заголовки («=», «. . .», случайные числа таблиц).
   - Различаем повторяющиеся нумерации глав в многочастных романах и пьесах («Часть 2 • Глава I»).
4. Пересобирает шардированный индекс (manifest.json, home-featured.json, categories.json, shards/idx-*.json).
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from harvest_ossetian_1000 import build_sharded_indexes

BASE_DIR = Path(__file__).resolve().parent.parent
BOOKS_DIR = BASE_DIR / "archive" / "books"
SHARD1_BOOKS_DIR = BASE_DIR / "archive" / "shard-1" / "books"
CATALOG_PATH = BASE_DIR / "archive" / "catalog" / "catalog.json"

# Строгие маркеры принадлежности к Кавказу и Осетии
CAUCASUS_STRICT_RE = re.compile(
    r"\b(кавказ\w*|осети\w*|ирон\w*|ирыстон\w*|черкес\w*|адыг\w*|дагестан\w*|чечен\w*|ингуш\w*|"
    r"кабард\w*|балкар\w*|грузи\w*|тифлис\w*|тбилис\w*|армени\w*|армян\w*|кубан\w*|терск\w*|терек\w*|"
    r"эльбрус\w*|казбек\w*|дарьял\w*|пятигорск\w*|кисловодск\w*|владикавказ\w*|шамил\w*|мюрид\w*|"
    r"абхаз\w*|карача\w*|хевсур\w*|сванет\w*|имерет\w*|мингрел\w*|лезгин\w*|авар\w*|кумык\w*|калмык\w*|"
    r"хаджи-мурат|мцыри|коста|хетагуров\w*|гадиев\w*|коцоев\w*|потто|ермолов\w*|кюхельбекер\w*|"
    r"бестужев-марлинск\w*|аммалат-бек|измаил-бей|аул\w*|джигит\w*|черноморск\w*\s+казак\w*)\b",
    re.I,
)

# Авторы — учёные, географы, путешественники, философы -> science
SCIENCE_AUTHORS_RE = re.compile(
    r"\b(миклухо-макла\w*|пржевальск\w*|арсеньев\w*|бичурин\w*|менделеев\w*|циолковск\w*|сеченов\w*|"
    r"павлов\s+иван|бехтерев\w*|мечников\w*|тимирязев\w*|вернадск\w*|перельман\w*|обручев\w*|"
    r"козлов\s+петр|крашенинников\w*|бердяев\w*|шестов\w*|соловьев\s+владимир|лопатин\w*|флоренск\w*|"
    r"булгаков\s+сергей|франк\s+семен|лосский|розанов\s+василий|чаадаев\w*|хомяков\w*|леонтьев\s+константин|"
    r"ницше|шопенгауэр|кант\b|гегель|декарт|спиноза|эпиктет|августин|кьеркегор|керкегор|бергсон|"
    r"дарвин|фарадей|паскаль|ньютон|галилей|лаплас|пуанкаре|фрейд)\b",
    re.I,
)

# Авторы — историки -> history
HISTORY_AUTHORS_RE = re.compile(
    r"\b(карамзин|ключевск\w*|соловьев\s+сергей|костомаров\w*|татищев\w*|погодин\w*|платонов\s+сергей|"
    r"тарле|иловайск\w*|бестужев-рюмин\w*|милюков\w*|покровск\w*\s+михаил|шубинск\w*|ваалишевск\w*|валишевск\w*|"
    r"грановск\w*|кавелин\w*|щ[её]голев\w*|богословск\w*|корнилович\w*)\b",
    re.I,
)

# Авторы — педагоги, авторы учебников -> rare-editions
PEDAGOGY_AUTHORS_RE = re.compile(
    r"\b(ушинск\w*|макаренко|челпанов\w*|рачинск\w*|вахтеров\w*|песталоцци|коменск\w*|фребель)\b",
    re.I,
)

# Зарубежные классики -> foreign-classics
FOREIGN_AUTHORS_RE = re.compile(
    r"\b(жюль\s+верн|\bверн\b|конан\s+дойл|\bдойл\b|джек\s+лондон|герберт\s+уэллс|\bуэллс\b|"
    r"стивенсон|хаггард|майн\s+рид|\bэмар\b|сальгари|фенимор\s+купер|эдгар\s+берроуз|берроуз|"
    r"эдгар\s+уоллес|эдгар\s+по|ги\s+де\s+мопассан|мопассан|эмиль\s+золя|\bзоля\b|виктор\s+гюго|"
    r"александр\s+дюма|бальзак|стендаль|флобер|анатоль\s+франс|ромен\s+роллан|метерлинк|"
    r"чарльз\s+диккенс|диккенс|вальтер\s+скотт|оскар\s+уайльд|уайльд|киплинг|джозеф\s+конрад|"
    r"честертон|гоalsуорси|шекспир|байрон|\bг[её]те\b|шиллер|гейне|гофман|гауф|братья\s+гримм|"
    r"андерсен|ибсен|стриндберг|гамсун|сенкевич|реймонт|пруст|кафка|сервантес|данте|гомер|"
    r"софокл|еврипид|эсхил|аристофан|плутарх|тацит|цицерон|сенека|овидий|вергилий|"
    r"брэм\s+стокер|буссенар|жаколио|леблан|гастон\s+леру|мерримен|коррелли|корелли|ронни|рони-старший)\b",
    re.I,
)

SCIENCE_TITLE_RE = re.compile(
    r"\b(этнограф\w*|антрополог\w*|географ\w*|экспедици\w*|путешестви\w*\s+в\s+|океани\w*|папуас\w*|"
    r"австрали\w*|чукот\w*|тибет\w*|монгол\w*|япони\w*|африк\w*|философи\w*|психологи\w*|логик\w*|"
    r"математик\w*|физик\w*|астрономи\w*|хими\w*|биологи\w*|физиологи\w*|лингвистик\w*|языкознани\w*)\b",
    re.I,
)

HISTORY_TITLE_RE = re.compile(
    r"\b(летопис\w*|хроник\w*|восстани\w*|революци\w*|отечественн\w+\s+войн\w*|декабрист\w*|"
    r"крепостн\w+\s+прав\w*|императриц\w*|император\w*|царствовани\w*|конвенци\w*|манифест\b|"
    r"рескрипт\w*|воспоминани\w+\s+о\s+войне|осада\s+|битва\s+при|сражени\w+\s+при)\b",
    re.I,
)

TEXTBOOK_TITLE_RE = re.compile(
    r"\b(учебник\w*|грамматик\w*|курс\s+лекций|хрестомати\w*|руководство\s+к|педагогик\w*|"
    r"воспитани\w+\s+в\s+школе|начальн\w+\s+обучени\w*|арифметик\w*|задачник\w*)\b",
    re.I,
)


def make_short_author(full: str) -> str:
    clean = re.sub(r"\([^)]*\)", "", full).strip()
    if re.search(r"\b[IVX]+\b$", clean):
        return clean
    parts = [x for x in clean.split() if x]
    if len(parts) == 3 and all(p[0].isalpha() for p in parts):
        return f"{parts[0][0]}. {parts[1][0]}. {parts[2]}"
    if len(parts) == 2 and all(p[0].isalpha() for p in parts):
        return f"{parts[0][0]}. {parts[1]}"
    return clean or "Анонимное издание"


def fix_author_and_title(title: str, author: str):
    orig_t, orig_a = title, author

    # 1. Снимаем внешние круглые скобки вокруг всего заголовка: "(О Маяковском)" -> "О Маяковском"
    if title.startswith("(") and title.endswith(")") and "(" not in title[1:-1]:
        title = title[1:-1].strip()

    # 2. Исправляем опечатки в классических заголовках
    title = title.replace("Пушнине", "Пушкине")

    # 3. Убираем оборванные скобки и годы из имени автора: "Юрий Николаевич Тынянов (1894—1943(" -> "Юрий Николаевич Тынянов"
    author = re.sub(r"\s*\([^)]*\)?", "", author)
    author = re.sub(r"\s*\b\d{4}\s*[—–-]\s*\d{4}.*$", "", author).strip(" ,.;:-—–(")

    # 4. Проверяем случай криптонима в начале заголовка: "Н. Р. Н.Н. Миклуха-Маклай"
    m_crypt = re.match(r"^((?:[А-ЯЁ]\.\s*){1,3})([А-ЯЁ]\.\s*[А-ЯЁ]\.\s*.+)$", title)
    if m_crypt:
        crypt_initials = m_crypt.group(1).strip()
        real_subject = m_crypt.group(2).strip().replace("Миклуха-Маклай", "Миклухо-Маклай")
        title = f"{real_subject} (биографический очерк)"
        author = f"{crypt_initials} (автор очерка)"
        return title, author, f"{crypt_initials} (очерк)"

    # 5. Если вместо автора попали цифры года, жанр ("рассказ, 1804", "1907", "1947", "Неизвестные")
    low_a = author.lower()
    has_letters = sum(1 for c in author if c.isalpha()) >= 3
    is_junk_author = (
        not has_letters
        or re.fullmatch(r"[\d\s—–-]+", author) is not None
        or any(low_a.startswith(w) for w in ("рассказ", "повесть", "очерк", "комедия", "драма", "стихотворени", "неизвестн", "аноним"))
    )
    if is_junk_author:
        if any(w in title.lower() for w in ("конвенция", "договор", "манифест", "указ", "устав", "грамота")):
            author = "Исторический документ"
            return title, author, "Историч. док."
        if any(w in title.lower() for w in ("белоснежка", "бременские", "госпожа метелица", "сказка")):
            author = "Народные и классические сказки"
            return title, author, "Сказки"
        author = "Анонимное издание"
        return title, author, "Анонимное изд."

    # 6. Если инициалы без фамилии ("Н. Р.", "А. Б.")
    if re.fullmatch(r"(?:[А-ЯЁA-Z]\.\s*){1,3}", author):
        disp = f"{author} (подпись автора)"
        return title, disp, author

    return title, author, make_short_author(author)


def determine_best_category(book: dict) -> str:
    if book.get("language") == "os":
        return "caucasus"

    cur = book.get("category", "russian-classics")
    title = book.get("title", "")
    author = book.get("author", "")
    desc = book.get("description", "")
    trans = book.get("translator")
    hay = f"{title} {author} {desc}"

    # 1. Сначала чистим ошибочно попавшие в Кавказ русскоязычные книги
    if cur == "caucasus":
        if CAUCASUS_STRICT_RE.search(hay):
            return "caucasus"
        # Иначе перераспределяем точно по смыслу
        if PEDAGOGY_AUTHORS_RE.search(author) or TEXTBOOK_TITLE_RE.search(title):
            return "rare-editions"
        if SCIENCE_AUTHORS_RE.search(author) or SCIENCE_TITLE_RE.search(hay):
            return "science"
        if HISTORY_AUTHORS_RE.search(author) or HISTORY_TITLE_RE.search(hay):
            return "history"
        if trans or FOREIGN_AUTHORS_RE.search(author):
            return "foreign-classics"
        return "russian-classics"

    # 2. Точечная коррекция очевидных авторов в остальных рубриках (Миклухо-Маклай и др.)
    if "миклухо-макла" in hay.lower() or "миклуха-макла" in hay.lower():
        return "science"
    if PEDAGOGY_AUTHORS_RE.search(author) and cur == "russian-classics":
        return "rare-editions"
    if SCIENCE_AUTHORS_RE.search(author) and cur == "russian-classics":
        return "science"
    if HISTORY_AUTHORS_RE.search(author) and cur == "russian-classics":
        return "history"
    if FOREIGN_AUTHORS_RE.search(author) and cur == "russian-classics":
        return "foreign-classics"

    return cur


NOTES_BOUNDARY_RE = re.compile(
    r"^(примечани\w*|комментари\w*|варианты\b|приложени\w*|отрывки из путешествия онегина)",
    re.I,
)
GARBAGE_CH_TITLE_RE = re.compile(
    r"^([=.*—–\-\s_]+|\d{3,}|тур\.\s*пиастры)$",
    re.I,
)


def clean_book_chapters(chapters: list) -> tuple[list, bool]:
    if not chapters or len(chapters) <= 1:
        return chapters, False

    changed = False

    # Шаг 1: Убираем мусорные заголовки («=», «. . .», случайные числа из таблиц), сливая в предыдущую главу
    step1 = []
    for ch in chapters:
        t = (ch.get("title") or "").strip()
        if step1 and (not t or GARBAGE_CH_TITLE_RE.match(t)):
            step1[-1]["content"].extend(ch.get("content", []))
            changed = True
        else:
            step1.append(ch)

    # Шаг 2: Сворачиваем дублирующиеся главы внутри блока «Примечаний / Комментариев / Приложений» (кейс «Евгения Онегина»!)
    main_titles_seen = set()
    step2 = []
    in_notes_zone = False

    for ch in step1:
        t = (ch.get("title") or "").strip()
        t_norm = re.sub(r"\s+", " ", t).lower()

        if NOTES_BOUNDARY_RE.match(t_norm):
            in_notes_zone = True
            # Если уже есть глава с точно таким же названием (например второй «ОТРЫВКИ ИЗ ПУТЕШЕСТВИЯ ОНЕГИНА») — вливаем внутрь
            if step2 and t_norm in {re.sub(r"\s+", " ", x["title"]).lower() for x in step2}:
                step2[-1]["content"].append({"type": "subtitle", "text": t})
                step2[-1]["content"].extend(ch.get("content", []))
                changed = True
            else:
                step2.append(ch)
            continue

        if in_notes_zone and step2:
            # Любые подглавы внутри примечаний, повторяющие названия основных глав («ГЛАВА ПЕРВАЯ»..«ГЛАВА ВОСЬМАЯ») или мелкие сноски,
            # превращаем в аккуратный подзаголовок внутри главы Примечаний!
            if t_norm in main_titles_seen or re.match(r"^(глава\s+|песнь\s+|[ivxlcdm]+$|\d+\.?$)", t_norm):
                step2[-1]["content"].append({"type": "subtitle", "text": t})
                step2[-1]["content"].extend(ch.get("content", []))
                changed = True
                continue

        main_titles_seen.add(t_norm)
        step2.append(ch)

    # Шаг 3: Если в многочастном романе или пьесе всё ещё остались одинаковые названия глав (Часть 1: Глава I..V, Часть 2: Глава I..V),
    # добавляем номер цикла («Часть 2 • Глава I»), чтобы в оглавлении не было слепых дублей!
    norm_counts = Counter(re.sub(r"\s+", " ", c["title"].strip()).lower() for c in step2)
    has_dups = any(v > 1 for k, v in norm_counts.items() if not k.startswith("часть "))
    if has_dups:
        occ_tracker = Counter()
        for c in step2:
            key = re.sub(r"\s+", " ", c["title"].strip()).lower()
            if norm_counts[key] > 1:
                occ_tracker[key] += 1
                cycle = occ_tracker[key]
                if cycle >= 2:
                    c["title"] = f"Часть {cycle} • {c['title'].strip()}"
                    changed = True

    if changed:
        for idx, c in enumerate(step2):
            c["id"] = f"chapter-{idx + 1}"

    return step2, changed


def main():
    cat_data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    books = cat_data["books"]

    cat_fixed = 0
    author_fixed = 0
    toc_fixed = 0
    shard0_dirty = []
    shard1_dirty = []

    for b in books:
        slug = b["slug"]
        aslug = b["authorSlug"]
        shard = int(b.get("shard", 0))
        bj_path = BOOKS_DIR / aslug / slug / "book.json"
        if not bj_path.exists():
            continue

        new_cat = determine_best_category(b)
        new_title, new_author, new_ashort = fix_author_and_title(b.get("title", ""), b.get("author", ""))

        meta_changed = (
            new_cat != b.get("category")
            or new_title != b.get("title")
            or new_author != b.get("author")
            or new_ashort != b.get("authorShort")
        )
        need_toc_check = int(b.get("chaptersCount", 1)) >= 2

        if not meta_changed and not need_toc_check:
            continue

        d = json.loads(bj_path.read_text(encoding="utf-8"))
        file_changed = False

        if new_cat != b.get("category"):
            b["category"] = new_cat
            d["category"] = new_cat
            cat_fixed += 1
            file_changed = True

        if new_title != b.get("title") or new_author != b.get("author") or new_ashort != b.get("authorShort"):
            b["title"] = new_title
            b["author"] = new_author
            b["authorShort"] = new_ashort
            d["title"] = new_title
            d["author"] = new_author
            d["authorShort"] = new_ashort
            if len(d.get("chapters", [])) == 1:
                d["chapters"][0]["title"] = new_title
                d["toc"] = [{"id": "chapter-1", "title": new_title}]
            author_fixed += 1
            file_changed = True

        if need_toc_check:
            cleaned_chs, ch_changed = clean_book_chapters(d.get("chapters", []))
            if ch_changed:
                d["chapters"] = cleaned_chs
                d["toc"] = [{"id": c["id"], "title": c["title"]} for c in cleaned_chs]
                d["stats"]["chaptersCount"] = len(cleaned_chs)
                b["chaptersCount"] = len(cleaned_chs)
                toc_fixed += 1
                file_changed = True

        if file_changed:
            serialized = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
            bj_path.write_text(serialized, encoding="utf-8")
            if shard == 1:
                s1_p = SHARD1_BOOKS_DIR / aslug / slug / "book.json"
                if s1_p.exists():
                    s1_p.write_text(serialized, encoding="utf-8")
                shard1_dirty.append((aslug, slug))
            else:
                shard0_dirty.append((aslug, slug))

    build_sharded_indexes(books)
    (BASE_DIR / "archive" / "dirty_shards_manifest.json").write_text(
        json.dumps({"shard0": shard0_dirty, "shard1": shard1_dirty}, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"=== АУДИТ И ЛЕЧЕНИЕ БАЗЫ ЗАВЕРШЕНЫ ===")
    print(f"Исправлено категорий: {cat_fixed}")
    print(f"Исправлено авторов/заголовков: {author_fixed}")
    print(f"Очищено оглавлений (TOC): {toc_fixed}")
    print(f"Обновлено JSON файлов -> Shard-0: {len(shard0_dirty)}, Shard-1: {len(shard1_dirty)}")


if __name__ == "__main__":
    main()
