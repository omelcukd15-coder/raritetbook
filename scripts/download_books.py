#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaritetBook.ru — Загрузчик и сборщик проверенного фонда общественного достояния.
Скачивает ПОЛНЫЕ тексты произведений из открытых академических источников (Викитека / Wikisource),
сохраняет структуру глав, стихов, эпиграфов и выделений, генерирует валидный FictionBook 2.0 (original.fb2),
оптимизированный book.json для онлайн-читалки, юридический паспорт meta.json и индексы каталога.
"""

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = BASE_DIR / "archive"
BOOKS_DIR = ARCHIVE_DIR / "books"
CATALOG_DIR = ARCHIVE_DIR / "catalog"

HEADERS = {
    "User-Agent": "RaritetBookArchiveBuilder/1.0 (https://raritetbook.ru; founder@omelchukdenis.ru) Python/3.11"
}

CATEGORIES = [
    {
        "id": "history",
        "slug": "history",
        "title": "История России",
        "subtitle": "Летописи, исторические труды, Российская империя и архивные памятники",
        "image": "/assets/images/categories/history.webp",
    },
    {
        "id": "russian-classics",
        "slug": "russian-classics",
        "title": "Русская классика",
        "subtitle": "Золотой фонд русской прозы, поэзии и драматургии XVIII–XIX веков",
        "image": "/assets/images/categories/russian-classics.webp",
    },
    {
        "id": "caucasus",
        "slug": "caucasus",
        "title": "Кавказ и народы России",
        "subtitle": "Этнография, история Кавказа и осетинское литературное наследие",
        "image": "/assets/images/categories/caucasus.webp",
    },
    {
        "id": "foreign-classics",
        "slug": "foreign-classics",
        "title": "Зарубежная классика",
        "subtitle": "Мировая литература, античный эпос и готический роман в классических переводах",
        "image": "/assets/images/categories/foreign-classics.webp",
    },
    {
        "id": "science",
        "slug": "science",
        "title": "Наука и философия",
        "subtitle": "Основополагающие труды русских учёных, космонавтика, химия и естествознание",
        "image": "/assets/images/categories/science.webp",
    },
    {
        "id": "rare-editions",
        "slug": "rare-editions",
        "title": "Редкие издания и учебники",
        "subtitle": "Дореволюционные гимназические курсы, грамматики, логика и старинная педагогика",
        "image": "/assets/images/categories/rare-editions.webp",
    },
]


# 22 полных проверенных книги (ст. 1281 и ст. 1282 ГК РФ — 100% общественное достояние)
BOOKS_MANIFEST = [
    # --- 1. РЕДКИЕ ИЗДАНИЯ И РУССКИЕ СТАРИННЫЕ УЧЕБНИКИ ---
    {
        "slug": "lomonosov-rossiyskaya-grammatika",
        "author_slug": "lomonosov",
        "author": "Михаил Васильевич Ломоносов",
        "author_short": "М. В. Ломоносов",
        "author_years": "1711–1765",
        "title": "Российская грамматика",
        "alt_titles": ["Грамматика Ломоносова", "Старинный учебник русского языка"],
        "category": "rare-editions",
        "language": "ru",
        "written_year": "1755",
        "edition_year": "1757 (в совр. орфографии)",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1765 г.)",
        "historical_note": "Первая научная грамматика русского языка, составленная М. В. Ломоносовым в 1755 году и выдержавшая 14 изданий в XVIII веке. По ней учились поколения российских гимназистов, писателей и учёных.",
        "description": "Фундаментальный учебный свод правил русской фонетики, правописания, морфологии и синтаксиса в шести наставлениях, заложивший нормы литературного русского языка.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Российская грамматика (Ломоносов)/1952 (СО)",
    },
    {
        "slug": "chelpanov-uchebnik-logiki",
        "author_slug": "chelpanov",
        "author": "Георгий Иванович Челпанов",
        "author_short": "Г. И. Челпанов",
        "author_years": "1862–1936",
        "title": "Учебник логики",
        "alt_titles": ["Логика Челпанова", "Гимназический учебник логики"],
        "category": "rare-editions",
        "language": "ru",
        "written_year": "1897",
        "edition_year": "1917",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1936 г.)",
        "historical_note": "Классический гимназический учебник логики Российской империи, написанный профессором Императорского Московского университета Г. И. Челпановым и выдержавший 10 дореволюционных изданий.",
        "description": "Образцовый курс формальной и индуктивной логики: учение о понятии, суждении, умозаключении, силлогизмах, методах научного исследования, доказательствах и логических ошибках.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Учебник логики (Челпанов)",
    },
    {
        "slug": "ushinskiy-o-narodnosti-v-vospitanii",
        "author_slug": "ushinskiy",
        "author": "Константин Дмитриевич Ушинский",
        "author_short": "К. Д. Ушинский",
        "author_years": "1823–1871",
        "title": "О народности в общественном воспитании",
        "alt_titles": ["Педагогика Ушинского"],
        "category": "rare-editions",
        "language": "ru",
        "written_year": "1857",
        "edition_year": "1857",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1871 г.)",
        "historical_note": "Программный педагогический труд К. Д. Ушинского — основоположника научной педагогики в России и автора знаменитых учебных книг «Родное слово» и «Детский мир».",
        "description": "Сравнительное историко-педагогическое исследование систем школьного и университетского образования Европы, Америки и России с обоснованием самобытной русской школы.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "О народности в общественном воспитании (Ушинский)",
    },
    {
        "slug": "perelman-zhivaya-matematika",
        "author_slug": "perelman",
        "author": "Яков Исидорович Перельман",
        "author_short": "Я. И. Перельман",
        "author_years": "1882–1942",
        "title": "Живая математика",
        "alt_titles": ["Математические рассказы и смекалка", "Занимательный задачник Перельмана"],
        "category": "rare-editions",
        "language": "ru",
        "written_year": "1934",
        "edition_year": "1934",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1942 г., срок с учётом ст. 1281 п. 5 истёк 01.01.2017)",
        "historical_note": "Знаменитый учебный сборник математических рассказов и головоломок Я. И. Перельмана — создателя жанра русской занимательной науки и ленинградского «Дома занимательной науки».",
        "description": "Двенадцать глав увлекательных арифметических, геометрических и логических задач с подробными разборами и математическими расчётами из реальной жизни.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            (f"Живая математика (Перельман)/Глава {i}", f"Глава {i}") for i in range(1, 13)
        ],
    },

    # --- 2. НАУКА И ФИЛОСОФИЯ ---
    {
        "slug": "mendeleev-popytka-ponimaniya-efira",
        "author_slug": "mendeleev",
        "author": "Дмитрий Иванович Менделеев",
        "author_short": "Д. И. Менделеев",
        "author_years": "1834–1907",
        "title": "Попытка химического понимания мирового эфира",
        "alt_titles": ["Мировой эфир Менделеева"],
        "category": "science",
        "language": "ru",
        "written_year": "1902",
        "edition_year": "1905",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1907 г.)",
        "historical_note": "Оригинальный естественнонаучный очерк создателя Периодического закона химических элементов Д. И. Менделеева, изданный в Санкт-Петербурге в начале XX века.",
        "description": "Философско-химическое размышление великого русского учёного о строении вещества, инертных газах, природе тяготения и границах периодической системы элементов.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Попытка химического понимания мирового эфира (Менделеев)",
    },
    {
        "slug": "tsiolkovskiy-grezy-o-zemle-i-nebe",
        "author_slug": "tsiolkovskiy",
        "author": "Константин Эдуардович Циолковский",
        "author_short": "К. Э. Циолковский",
        "author_years": "1857–1935",
        "title": "Грёзы о Земле и небе",
        "alt_titles": ["Эффекты всемирного тяготения"],
        "category": "science",
        "language": "ru",
        "written_year": "1894",
        "edition_year": "1895",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1935 г.)",
        "historical_note": "Изданная в Москве в 1895 году книга калужского учёного-самоучки К. Э. Циолковского, в которой впервые выдвинута идея создания искусственного спутника Земли.",
        "description": "Научно-философский труд о законах всемирного тяготения, невесомости, устройстве Вселенной и перспективах выхода человечества в околоземное пространство.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Грёзы о Земле и небе (Циолковский)",
    },
    {
        "slug": "tsiolkovskiy-vne-zemli",
        "author_slug": "tsiolkovskiy",
        "author": "Константин Эдуардович Циолковский",
        "author_short": "К. Э. Циолковский",
        "author_years": "1857–1935",
        "title": "Вне Земли",
        "alt_titles": ["Межпланетное путешествие Циолковского"],
        "category": "science",
        "language": "ru",
        "written_year": "1918",
        "edition_year": "1920",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1935 г.)",
        "historical_note": "Классическая научно-техническая повесть К. Э. Циолковского, начатая ещё в 1896 году и полностью изданная Калужским обществом изучения природы в 1920 году.",
        "description": "Подробное научно обоснованное описание полёта международной экспедиции учёных на многоступенчатой ракете, выхода в открытый космос в скафандрах, оранжерей на орбите и высадки на Луну.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Вне Земли (Циолковский)",
    },
    {
        "slug": "sechenov-avtobiograficheskie-zapiski",
        "author_slug": "sechenov",
        "author": "Иван Михайлович Сеченов",
        "author_short": "И. М. Сеченов",
        "author_years": "1829–1905",
        "title": "Автобиографические записки",
        "alt_titles": ["Записки Ивана Михайловича Сеченова"],
        "category": "science",
        "language": "ru",
        "written_year": "1904",
        "edition_year": "1907",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1905 г.)",
        "historical_note": "Изданные в 1907 году издательством «Научная мысль» воспоминания «отца русской физиологии» И. М. Сеченова о становлении экспериментальной науки и университетской жизни XIX века.",
        "description": "Живое документальное повествование о годах учёбы в Инженерном училище и Московском университете, европейских лабораториях Гельмгольца и Бунзена и истории создания «Рефлексов головного мозга».",
        "domain": "ru.wikisource.org",
        "mode": "auto_prefix",
        "prefix": "Автобиографические записки (Сеченов)/1907 (ДО)",
        "fallback_page": "Автобиографические записки (Сеченов)/1907 (ДО)",
    },

    # --- 3. ИСТОРИЯ РОССИИ ---
    {
        "slug": "karamzin-istoriya-gosudarstva-rossiyskogo-tom-1",
        "author_slug": "karamzin",
        "author": "Николай Михайлович Карамзин",
        "author_short": "Н. М. Карамзин",
        "author_years": "1766–1826",
        "title": "История государства Российского. Том I",
        "alt_titles": ["История России Карамзина"],
        "category": "history",
        "language": "ru",
        "written_year": "1816",
        "edition_year": "1818 (в совр. орфографии)",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1826 г.)",
        "historical_note": "Первый том монументального исторического труда историографа Н. М. Карамзина, выход которого в 1818 году А. С. Пушкин назвал «открытием древней России, как Колумб открыл Америку».",
        "description": "Древнейшая история народов Восточной Европы, славянских племён, призвания варягов и становления Древнерусского государства от Рюрика и Олега до Владимира Святославича.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            ("История государства Российского (Карамзин)/Том I/Посвящение", "Посвящение"),
            ("История государства Российского (Карамзин)/Том I/Предисловие", "Предисловие"),
            ("История государства Российского (Карамзин)/Том I/Об источниках Российской Истории до XVII века", "Об источниках Российской Истории до XVII века"),
            ("История государства Российского (Карамзин)/Том I/Глава I", "Глава I. О народах, издревле обитавших в России"),
            ("История государства Российского (Карамзин)/Том I/Глава II", "Глава II. О славянах и других народах, составивших государство Российское"),
            ("История государства Российского (Карамзин)/Том I/Глава III", "Глава III. О физическом и нравственном характере славян древних"),
            ("История государства Российского (Карамзин)/Том I/Глава IV", "Глава IV. Рюрик, Синеус и Трувор. 862–879 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава V", "Глава V. Олег Правитель. 879–912 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава VI", "Глава VI. Князь Игорь. 912–945 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава VII", "Глава VII. Князь Святослав. 945–972 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава VIII", "Глава VIII. Великий князь Ярополк. 972–980 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава IX", "Глава IX. Великий князь Владимир, названный в крещении Василием. 980–1014 гг."),
            ("История государства Российского (Карамзин)/Том I/Глава X", "Глава X. О состоянии Древней России"),
        ],
    },
    {
        "slug": "slovo-o-polku-igoreve-zhukovskiy",
        "author_slug": "drevnerusskaya-literatura",
        "author": "Памятник древнерусской словесности XII века",
        "author_short": "Древнерусский эпос",
        "author_years": "ок. 1185 г.",
        "title": "Слово о полку Игореве",
        "alt_titles": ["Слово о полку Игореве, Игоря, сына Святославля, внука Ольгова"],
        "category": "history",
        "language": "ru",
        "written_year": "1185",
        "edition_year": "1819 (пер. В. А. Жуковского)",
        "translator": "Василий Андреевич Жуковский (1783–1852)",
        "legal_status": "Общественное достояние (памятник XII в.; переводчик В. А. Жуковский скончался в 1852 г. — ст. 1281, 1282 ГК РФ)",
        "historical_note": "Величайший памятник древнерусской литературы конца XII века о походе новгород-северского князя Игоря Святославича на половцев в классическом поэтическом переложении В. А. Жуковского.",
        "description": "Героическая песнь о ратном подвиге, плаче Ярославны и призыве русских князей к единству перед лицом внешней угрозы.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Слово о полку Игореве (Жуковский)",
    },
    {
        "slug": "potto-kavkazskaya-voyna-tom-5",
        "author_slug": "potto",
        "author": "Василий Александрович Потто",
        "author_short": "В. А. Потто",
        "author_years": "1836–1911",
        "title": "Кавказская война в отдельных очерках, эпизодах, легендах и биографиях. Том 5",
        "alt_titles": ["Время Паскевича, или Бунт Чечни", "Кавказская война Потто"],
        "category": "history",
        "language": "ru",
        "written_year": "1889",
        "edition_year": "1889",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1911 г.)",
        "historical_note": "Пятый том фундаментального свода генерал-лейтенанта и военного историка В. А. Потто, возглавлявшего военно-исторический отдел штаба Кавказского военного округа в Тифлисе.",
        "description": "Подробное документально-историческое исследование событий на Кавказе конца 1820-х — начала 1830-х годов, основанное на архивных рапортах, письмах и свидетельствах очевидцев.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Кавказская война. Том 5 (Потто)",
    },

    # --- 4. РУССКАЯ КЛАССИКА ---
    {
        "slug": "pushkin-kapitanskaya-dochka",
        "author_slug": "pushkin",
        "author": "Александр Сергеевич Пушкин",
        "author_short": "А. С. Пушкин",
        "author_years": "1799–1837",
        "title": "Капитанская дочка",
        "alt_titles": ["Записки Петра Андреевича Гринёва"],
        "category": "russian-classics",
        "language": "ru",
        "written_year": "1836",
        "edition_year": "1836 (в совр. орфографии)",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1837 г.)",
        "historical_note": "Исторический роман А. С. Пушкина, впервые напечатанный в четвёртом томе журнала «Современник» в конце 1836 года после архивной работы поэта над «Историей Пугачёва».",
        "description": "История чести, долга и любви молодого дворянина Петра Гринёва и Маши Мироновой на фоне грозных событий крестьянского восстания Емельяна Пугачёва.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава I", "Глава I. Сержант гвардии"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава II", "Глава II. Вожатый"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава III", "Глава III. Крепость"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава IV", "Глава IV. Поединок"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава V", "Глава V. Любовь"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава VI", "Глава VI. Пугачёвщина"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава VII", "Глава VII. Приступ"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава VIII", "Глава VIII. Незваный гость"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава IX", "Глава IX. Разлука"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава X", "Глава X. Осада города"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава XI", "Глава XI. Мятежная слобода"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава XII", "Глава XII. Сирота"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава XIII", "Глава XIII. Арест"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Глава XIV", "Глава XIV. Суд"),
            ("Капитанская дочка (Пушкин)/1960 (СО)/Приложение", "Приложение. Пропущенная глава"),
        ],
    },
    {
        "slug": "pushkin-evgeniy-onegin",
        "author_slug": "pushkin",
        "author": "Александр Сергеевич Пушкин",
        "author_short": "А. С. Пушкин",
        "author_years": "1799–1837",
        "title": "Евгений Онегин",
        "alt_titles": ["Роман в стихах"],
        "category": "russian-classics",
        "language": "ru",
        "written_year": "1823–1831",
        "edition_year": "1833 (в совр. орфографии)",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1837 г.)",
        "historical_note": "Центральное произведение А. С. Пушкина, создававшееся на протяжении более семи лет и названное В. Г. Белинским «энциклопедией русской жизни».",
        "description": "Полный текст романа в стихах с авторскими примечаниями и отрывками из путешествия Онегина.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Евгений Онегин (Пушкин)/СС 1959 (СО)",
    },
    {
        "slug": "lermontov-geroy-nashego-vremeni",
        "author_slug": "lermontov",
        "author": "Михаил Юрьевич Лермонтов",
        "author_short": "М. Ю. Лермонтов",
        "author_years": "1814–1841",
        "title": "Герой нашего времени",
        "alt_titles": ["Журнал Печорина"],
        "category": "russian-classics",
        "language": "ru",
        "written_year": "1838–1840",
        "edition_year": "1840 (в совр. орфографии)",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1841 г.)",
        "historical_note": "Первый русский социально-психологический и философский роман в прозе, вышедший отдельным изданием в Санкт-Петербурге в 1840 году.",
        "description": "Пять повестей («Бэла», «Максим Максимыч», «Тамань», «Княжна Мери», «Фаталист»), раскрывающих драматический образ офицера Григория Печорина на фоне природы и крепостей Кавказа.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Герой нашего времени (Лермонтов)/1969 (СО)",
    },
    {
        "slug": "lermontov-mtsyri",
        "author_slug": "lermontov",
        "author": "Михаил Юрьевич Лермонтов",
        "author_short": "М. Ю. Лермонтов",
        "author_years": "1814–1841",
        "title": "Мцыри",
        "alt_titles": ["Поэма Мцыри"],
        "category": "russian-classics",
        "language": "ru",
        "written_year": "1839",
        "edition_year": "1840",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1841 г.)",
        "historical_note": "Вершина кавказского романтизма М. Ю. Лермонтова, опубликованная в единственном прижизненном сборнике поэта в 1840 году.",
        "description": "Страстная исповедь юного монастырского послушника-горца о трёх днях желанной свободы среди величественных хребтов и ущелий Кавказа.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Мцыри (Лермонтов)",
    },
    {
        "slug": "tolstoy-hadzhi-murat",
        "author_slug": "tolstoy",
        "author": "Лев Николаевич Толстой",
        "author_short": "Л. Н. Толстой",
        "author_years": "1828–1910",
        "title": "Хаджи-Мурат",
        "alt_titles": ["Кавказская повесть Толстого"],
        "category": "russian-classics",
        "language": "ru",
        "written_year": "1896–1904",
        "edition_year": "1912",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1910 г.)",
        "historical_note": "Поздний шедевр Л. Н. Толстого, над которым писатель работал восемь лет и который был впервые опубликован посмертно в 1912 году.",
        "description": "Трагическая и исторически точная повесть о судьбе знаменитого аварского наиба Хаджи-Мурата, оказавшегося между властью имама Шамиля и Российской империей.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            (f"Хаджи-Мурат (Толстой)/{rom}", f"Глава {rom}")
            for rom in [
                "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
                "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
                "XXI", "XXII", "XXIII", "XXIV", "XXV"
            ]
        ],
    },

    # --- 5. ЗАРУБЕЖНАЯ СТАРИННАЯ И ГОТИЧЕСКАЯ КЛАССИКА ---
    {
        "slug": "homer-odisseya-zhukovskiy",
        "author_slug": "homer",
        "author": "Гомер",
        "author_short": "Гомер",
        "author_years": "VIII в. до н. э.",
        "title": "Одиссея",
        "alt_titles": ["Одиссея Гомера в переводе Жуковского"],
        "category": "foreign-classics",
        "language": "ru",
        "written_year": "VIII в. до н. э.",
        "edition_year": "1849 (пер. В. А. Жуковского)",
        "translator": "Василий Андреевич Жуковский (1783–1852)",
        "legal_status": "Общественное достояние (античный памятник; переводчик В. А. Жуковский скончался в 1852 г. — ст. 1281, 1282 ГК РФ)",
        "historical_note": "Классический русский гекзаметрический перевод гомеровского эпоса, завершённый В. А. Жуковским в 1849 году и ставший событием русской словесности XIX века.",
        "description": "Все двадцать четыре песни античной поэмы о десятилетних странствиях хитроумного царя Итаки Одиссея после падения Трои и его возвращении к Пенелопе.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            (f"Одиссея (Гомер; Жуковский)/{song}", song)
            for song in [
                "Песнь первая", "Песнь вторая", "Песнь третья", "Песнь четвёртая",
                "Песнь пятая", "Песнь шестая", "Песнь седьмая", "Песнь восьмая",
                "Песнь девятая", "Песнь десятая", "Песнь одиннадцатая", "Песнь двенадцатая",
                "Песнь тринадцатая", "Песнь четырнадцатая", "Песнь пятнадцатая", "Песнь шестнадцатая",
                "Песнь семнадцатая", "Песнь восемнадцатая", "Песнь девятнадцатая", "Песнь двадцатая",
                "Песнь двадцать первая", "Песнь двадцать вторая", "Песнь двадцать третья", "Песнь двадцать четвёртая"
            ]
        ],
    },
    {
        "slug": "shakespeare-gamlet-kroneberg",
        "author_slug": "shakespeare",
        "author": "Уильям Шекспир",
        "author_short": "У. Шекспир",
        "author_years": "1564–1616",
        "title": "Гамлет, принц Датский",
        "alt_titles": ["Трагедия о Гамлете", "Hamlet"],
        "category": "foreign-classics",
        "language": "ru",
        "written_year": "1601",
        "edition_year": "1902 (пер. А. И. Кронеберга, 1844)",
        "translator": "Андрей Иванович Кронеберг (1814–1855)",
        "legal_status": "Общественное достояние (автор скончался в 1616 г.; переводчик А. И. Кронеберг скончался в 1855 г. — ст. 1281, 1282 ГК РФ)",
        "historical_note": "Знаменитый перевод шекспировской трагедии, выполненный А. И. Кронебергом в 1844 году и царивший на русской императорской сцене на протяжении полувека.",
        "description": "Пять действий бессмертной трагедии о принце Датском, тени его отца, жажде истины и роковом столкновении со злом в замке Эльсинор.",
        "domain": "ru.wikisource.org",
        "mode": "chapters",
        "chapters_list": [
            ("Гамлет (Шекспир; Кронеберг)/ПСС 1902 (ВТ)/Действие I", "Действие I"),
            ("Гамлет (Шекспир; Кронеберг)/ПСС 1902 (ВТ)/Действие II", "Действие II"),
            ("Гамлет (Шекспир; Кронеберг)/ПСС 1902 (ВТ)/Действие III", "Действие III"),
            ("Гамлет (Шекспир; Кронеберг)/ПСС 1902 (ВТ)/Действие IV", "Действие IV"),
            ("Гамлет (Шекспир; Кронеберг)/ПСС 1902 (ВТ)/Действие V", "Действие V"),
        ],
    },
    {
        "slug": "goethe-faust-kholodkovskiy",
        "author_slug": "goethe",
        "author": "Иоганн Вольфганг фон Гёте",
        "author_short": "И. В. Гёте",
        "author_years": "1749–1832",
        "title": "Фауст",
        "alt_titles": ["Трагедия Фауст", "Faust"],
        "category": "foreign-classics",
        "language": "ru",
        "written_year": "1808–1831",
        "edition_year": "1914 (пер. Н. А. Холодковского)",
        "translator": "Николай Александрович Холодковский (1858–1921)",
        "legal_status": "Общественное достояние (автор скончался в 1832 г.; переводчик Н. А. Холодковский скончался в 1921 г. — ст. 1281, 1282 ГК РФ)",
        "historical_note": "Классический русский перевод «Фауста», выполненный выдающимся учёным-зоологом и поэтом Н. А. Холодковским и удостоенный Пушкинской премии Императорской Академии наук в 1917 году.",
        "description": "Философско-драматическая поэма о вечном искании смысла бытия доктором Фаустом и его договоре с Мефистофелем.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Фауст (Гёте; Холодковский)",
    },
    {
        "slug": "stoker-vampir-graf-drakula-1912",
        "author_slug": "stoker",
        "author": "Брэм Стокер",
        "author_short": "Брэм Стокер",
        "author_years": "1847–1912",
        "title": "Вампир (Граф Дракула)",
        "alt_titles": ["Дракула", "Dracula", "Готический роман Стокера"],
        "category": "foreign-classics",
        "language": "ru",
        "written_year": "1897",
        "edition_year": "1912 (дореволюционное издание)",
        "translator": "М. Сандрова (издание 1912 г.)",
        "legal_status": "Общественное достояние (автор скончался в 1912 г.; дореволюционный перевод опубликован в Российской империи в 1912 г. — ст. 1281, 1282 ГК РФ)",
        "historical_note": "Редкий дореволюционный русский перевод знаменитого готического романа Брэма Стокера, вышедший в Российской империи в 1912 году под заглавием «Вампир (Граф Дракула)».",
        "description": "Эпистолярный готический роман в дневниках и письмах Джонатана Харкера, Мины Мюррей и профессора Ван Хельсинга о противостоянии древнему трансильванскому графу.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Вампир (Граф Дракула) (Стокер)",
    },

    # --- 6. КАВКАЗ И ОСЕТИЯ ---
    {
        "slug": "khetagurov-iron-fandyr",
        "author_slug": "khetagurov",
        "author": "Коста Леванович Хетагуров (Къоста Хетӕгкаты)",
        "author_short": "Къоста Хетӕгкаты",
        "author_years": "1859–1906",
        "title": "Ирон фӕндыр (Осетинская лира)",
        "alt_titles": ["Ирон фæндыр", "Осетинская лира", "Стихотворения Коста Хетагурова на осетинском языке"],
        "category": "caucasus",
        "language": "os",
        "written_year": "1885–1898",
        "edition_year": "1899",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1906 г.)",
        "historical_note": "Исторический поэтический сборник «Ирон фӕндыр», впервые вышедший во Владикавказе в 1899 году и заложивший фундамент национальной осетинской художественной литературы.",
        "description": "Полное собрание лирических стихотворений, дум, песен, басен и поэм великого осетинского поэта-просветителя Къоста Хетӕгкаты на оригинальном осетинском языке.",
        "domain": "wikisource.org",
        "mode": "ossetian_search",
        "search_query": "(Хетæгкаты)",
    },
    {
        "slug": "khetagurov-osoba",
        "author_slug": "khetagurov",
        "author": "Коста Леванович Хетагуров",
        "author_short": "К. Л. Хетагуров",
        "author_years": "1859–1906",
        "title": "Особа (Этнографический очерк)",
        "alt_titles": ["Этнография Осетии", "Быт горцев Осетии"],
        "category": "caucasus",
        "language": "ru",
        "written_year": "1894",
        "edition_year": "1894",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1906 г.)",
        "historical_note": "Классический историко-этнографический труд Коста Хетагурова, впервые опубликованный в сборнике «Кавказский вестник» / «Северный Кавказ» в 1894 году.",
        "description": "Глубокое описание жизненного уклада, обычного права, семейных традиций, народных верований и сурового горного быта центральноосетинских обществ XIX века.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Особа (Хетагуров)",
    },
    {
        "slug": "khetagurov-neuryaditsy-severnogo-kavkaza",
        "author_slug": "khetagurov",
        "author": "Коста Леванович Хетагуров",
        "author_short": "К. Л. Хетагуров",
        "author_years": "1859–1906",
        "title": "Неурядицы Северного Кавказа",
        "alt_titles": ["Публицистика Коста Хетагурова"],
        "category": "caucasus",
        "language": "ru",
        "written_year": "1899",
        "edition_year": "1899",
        "translator": None,
        "legal_status": "Общественное достояние (ст. 1281, 1282 ГК РФ — автор скончался в 1906 г.)",
        "historical_note": "Знаменитая аналитическая статья-исследование Коста Хетагурова, напечатанная в петербургской газете «Санкт-Петербургские ведомости» в 1899 году.",
        "description": "Документально выверенный историко-публицистический очерк о земельном вопросе, управлении и социальной жизни народов Терской области в конце XIX столетия.",
        "domain": "ru.wikisource.org",
        "mode": "single",
        "page": "Неурядицы Северного Кавказа (Хетагуров)",
    },
]


def http_json(domain: str, params: dict, retries: int = 4) -> dict:
    url = f"https://{domain}/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 1.5 * (attempt + 1)
                time.sleep(wait)
                continue
            raise
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"Failed request to {url}")


def fetch_parsed_html(domain: str, page: str) -> str:
    time.sleep(0.25)
    data = http_json(
        domain,
        {
            "action": "parse",
            "page": page,
            "prop": "text",
            "disablelimitreport": "1",
            "disableeditsection": "1",
            "format": "json",
        },
    )
    if "error" in data:
        raise RuntimeError(f"MediaWiki error on {page}: {data['error']}")
    return data["parse"]["text"]["*"]


def normalize_ossetian(text: str) -> str:
    # Приводим латинскую æ/Æ к кириллической осетинской ӕ/Ӕ (U+04D5 / U+04D4)
    return text.replace("\u00e6", "\u04d5").replace("\u00c6", "\u04d4")


SKIP_CLASS_KEYWORDS = (
    "ws-noexport",
    "mw-editsection",
    "noprint",
    "headertemplate",
    "ws-header",
    "navbox",
    "infobox",
    "ambox",
    "sistersitebox",
    "toc",
    "catlinks",
    "printfooter",
    "mw-empty-elt",
)


class WikisourceHTMLToBlocks(HTMLParser):
    """
    Преобразует HTML-разметку Викитеки в последовательность структурных элементов:
    h2, h3, subtitle, epigraph, poem, quote, paragraph.
    Сохраняет курсив (<em>) и полужирный (<strong>) внутри текста.
    """

    def __init__(self, is_ossetian: bool = False):
        super().__init__(convert_charrefs=True)
        self.is_ossetian = is_ossetian
        self.skip_depth = 0
        self.stack = []
        self.items = []

        self.in_poem = 0
        self.poem_buf = []

        self.in_epigraph = 0
        self.epigraph_buf = []

        self.in_quote = 0
        self.quote_buf = []

        self.cur_block_tag = None
        self.cur_buf = []

    def _has_skip_class(self, attrs_dict: dict) -> bool:
        cls = (attrs_dict.get("class") or "").lower()
        el_id = (attrs_dict.get("id") or "").lower()
        for kw in SKIP_CLASS_KEYWORDS:
            if kw in cls or kw == el_id:
                return True
        style = (attrs_dict.get("style") or "").lower().replace(" ", "")
        if "display:none" in style:
            return True
        return False

    def _clean_text(self, raw: str) -> str:
        t = re.sub(r"[ \t\r\f\v]+", " ", raw)
        t = re.sub(r"\[\s*править\s*\]", "", t, flags=re.I)
        t = t.strip()
        if self.is_ossetian:
            t = normalize_ossetian(t)
        return t

    def _flush_block(self):
        if not self.cur_block_tag:
            return
        raw = "".join(self.cur_buf)
        self.cur_buf = []
        tag = self.cur_block_tag
        self.cur_block_tag = None

        txt = self._clean_text(re.sub(r"<[^>]+>", "", raw))
        if not txt:
            return
        # Пропускаем служебные плашки ГК РФ / ОД внизу страницы
        if "общественное достояние" in txt.lower() and len(txt) < 260:
            return
        if txt in ("▲", "↑", "* * *") and tag in ("h2", "h3", "h4"):
            return

        inline_html = self._clean_text(raw)
        if tag == "h2":
            self.items.append({"type": "h2", "text": txt})
        elif tag == "h3":
            self.items.append({"type": "h3", "text": txt})
        elif tag in ("h4", "h5"):
            self.items.append({"type": "subtitle", "text": txt})
        else:
            entry = {"type": "paragraph", "text": txt}
            if "<em>" in inline_html or "<strong>" in inline_html:
                entry["html"] = inline_html
            self.items.append(entry)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        ad = dict(attrs)

        if self.skip_depth > 0:
            if tag not in ("br", "img", "hr", "meta", "link", "input"):
                self.skip_depth += 1
            return

        if tag in ("script", "style", "noscript", "table") and "poem" not in (ad.get("class") or ""):
            # Некоторые стихи на старых страницах верстались таблицами центрирования — проверим:
            cls = (ad.get("class") or "").lower()
            if tag in ("script", "style", "noscript") or self._has_skip_class(ad):
                self.skip_depth = 1
                return

        if self._has_skip_class(ad):
            if tag not in ("br", "img", "hr", "meta", "link", "input"):
                self.skip_depth = 1
            return

        cls = (ad.get("class") or "").lower()

        # Стихотворный блок
        if tag == "poem" or ("poem" in cls.split() or "stanza" in cls.split()):
            self._flush_block()
            if self.in_poem == 0:
                self.poem_buf = []
            self.in_poem += 1
            self.stack.append(("poem", tag))
            return

        # Эпиграф
        if "epigraph" in cls:
            self._flush_block()
            if self.in_epigraph == 0:
                self.epigraph_buf = []
            self.in_epigraph += 1
            self.stack.append(("epigraph", tag))
            return

        # Цитата
        if tag == "blockquote" and self.in_epigraph == 0 and self.in_poem == 0:
            self._flush_block()
            if self.in_quote == 0:
                self.quote_buf = []
            self.in_quote += 1
            self.stack.append(("quote", tag))
            return

        if self.in_poem > 0:
            if tag in ("h2", "h3", "h4"):
                raw_poem = "".join(self.poem_buf)
                self.poem_buf = []
                self._emit_poem(raw_poem)
                self.cur_block_tag = tag
                self.cur_buf = []
                self.stack.append(("block", tag))
                return
            if tag == "br":
                self.poem_buf.append("\n")
            elif tag == "p":
                self.poem_buf.append("\n\n")
            self.stack.append(("in_poem", tag))
            return

        if self.in_epigraph > 0:
            if tag in ("br", "p", "div"):
                self.epigraph_buf.append("\n")
            self.stack.append(("in_epigraph", tag))
            return

        if self.in_quote > 0:
            if tag in ("br", "p", "div"):
                self.quote_buf.append("\n")
            self.stack.append(("in_quote", tag))
            return

        if tag in ("h2", "h3", "h4", "h5", "p", "li"):
            self._flush_block()
            self.cur_block_tag = tag
            self.cur_buf = []
            self.stack.append(("block", tag))
            return

        if tag == "br":
            if self.cur_block_tag:
                self.cur_buf.append("\n")
            return

        if tag in ("i", "em") and self.cur_block_tag:
            self.cur_buf.append("<em>")
        elif tag in ("b", "strong") and self.cur_block_tag:
            self.cur_buf.append("<strong>")

        if tag not in ("img", "hr", "meta", "link", "input"):
            self.stack.append(("other", tag))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.skip_depth > 0:
            if tag not in ("br", "img", "hr", "meta", "link", "input"):
                self.skip_depth -= 1
            return

        if tag in ("i", "em") and self.cur_block_tag:
            self.cur_buf.append("</em>")
        elif tag in ("b", "strong") and self.cur_block_tag:
            self.cur_buf.append("</strong>")

        # Закрываем стек
        for idx in range(len(self.stack) - 1, -1, -1):
            kind, stag = self.stack[idx]
            if stag == tag:
                self.stack.pop(idx)
                if kind == "poem":
                    self.in_poem = max(0, self.in_poem - 1)
                    if self.in_poem == 0:
                        raw_poem = "".join(self.poem_buf)
                        self.poem_buf = []
                        self._emit_poem(raw_poem)
                elif kind == "epigraph":
                    self.in_epigraph = max(0, self.in_epigraph - 1)
                    if self.in_epigraph == 0:
                        raw_ep = "".join(self.epigraph_buf)
                        self.epigraph_buf = []
                        txt = "\n".join(
                            self._clean_text(line)
                            for line in raw_ep.splitlines()
                            if self._clean_text(line)
                        )
                        if txt:
                            self.items.append({"type": "epigraph", "text": txt})
                elif kind == "quote":
                    self.in_quote = max(0, self.in_quote - 1)
                    if self.in_quote == 0:
                        raw_q = "".join(self.quote_buf)
                        self.quote_buf = []
                        txt = "\n".join(
                            self._clean_text(line)
                            for line in raw_q.splitlines()
                            if self._clean_text(line)
                        )
                        if txt:
                            self.items.append({"type": "quote", "text": txt})
                elif kind == "block":
                    self._flush_block()
                break

    def _emit_poem(self, raw_poem: str):
        if self.is_ossetian:
            raw_poem = normalize_ossetian(raw_poem)
        chunks = re.split(r"\n\s*\n+", raw_poem.strip())
        stanzas = []
        for ch in chunks:
            lines = [self._clean_text(l) for l in ch.splitlines() if self._clean_text(l)]
            if lines:
                stanzas.append(lines)
        if stanzas:
            flat_text = "\n\n".join("\n".join(st) for st in stanzas)
            self.items.append({"type": "poem", "stanzas": stanzas, "text": flat_text})

    def handle_data(self, data):
        if self.skip_depth > 0:
            return
        if self.in_poem > 0:
            self.poem_buf.append(data)
        elif self.in_epigraph > 0:
            self.epigraph_buf.append(data)
        elif self.in_quote > 0:
            self.quote_buf.append(data)
        elif self.cur_block_tag:
            self.cur_buf.append(html.escape(data, quote=False))
        else:
            # Текст внутри <div> без <p> (встречается на старых страницах Викитеки)
            cleaned = self._clean_text(data)
            if len(cleaned) > 25 and not cleaned.startswith("[["):
                self.items.append({"type": "paragraph", "text": cleaned})


def parse_html_to_items(raw_html: str, is_ossetian: bool = False) -> list:
    # Удаляем служебные блоки MediaWiki заранее для максимальной чистоты
    cleaned_html = re.sub(
        r'<div[^>]+class="[^"]*(?:ws-noexport|headertemplate|ws-header|navbox|catlinks|printfooter)[^"]*"[^>]*>.*?</div>',
        "",
        raw_html,
        flags=re.I | re.S,
    )
    parser = WikisourceHTMLToBlocks(is_ossetian=is_ossetian)
    parser.feed(cleaned_html)
    parser._flush_block()
    return parser.items


def split_items_into_chapters(items: list, fallback_title: str) -> list:
    """
    Если книга загружена одной большой страницей, разбивает её на логические главы
    по h2, h3, subtitle или нумерованным заголовкам глав.
    """
    h2_count = sum(1 for x in items if x["type"] == "h2")
    h3_count = sum(1 for x in items if x["type"] == "h3")
    sub_count = sum(1 for x in items if x["type"] == "subtitle")
    split_tag = (
        "h2" if h2_count >= 2 else ("h3" if h3_count >= 2 else ("subtitle" if sub_count >= 2 else None))
    )

    if not split_tag:
        # Проверка на нумерованные главы вида «1. Замок в Гималаях»
        num_pat = re.compile(r"^\d+\.\s+[А-ЯЁA-Z]")
        num_Count = sum(
            1 for x in items if x["type"] == "paragraph" and len(x["text"]) < 85 and num_pat.match(x["text"])
        )
        if num_Count >= 3:
            chapters = []
            cur_title = "Вступление"
            cur_content = []
            for x in items:
                if x["type"] == "paragraph" and len(x["text"]) < 85 and num_pat.match(x["text"]):
                    if cur_content:
                        chapters.append(
                            {"id": f"chapter-{len(chapters) + 1}", "title": cur_title, "content": cur_content}
                        )
                        cur_content = []
                    cur_title = x["text"]
                else:
                    cur_content.append(x)
            if cur_content:
                chapters.append(
                    {"id": f"chapter-{len(chapters) + 1}", "title": cur_title, "content": cur_content}
                )
            return chapters

        content = []
        for x in items:
            if x["type"] in ("h2", "h3"):
                content.append({"type": "subtitle", "text": x["text"]})
            else:
                content.append(x)
        # Для крупных сплошных произведений делим на удобные части чтения (~60 блоков)
        if len(content) > 120:
            chunk_size = 60
            return [
                {
                    "id": f"chapter-{idx + 1}",
                    "title": f"Часть {idx + 1}",
                    "content": content[i : i + chunk_size],
                }
                for idx, i in enumerate(range(0, len(content), chunk_size))
            ]
        return [{"id": "chapter-1", "title": fallback_title, "content": content}]

    chapters = []
    cur_title = "Вступление"
    cur_content = []

    for x in items:
        if x["type"] == split_tag:
            if cur_content:
                chapters.append(
                    {
                        "id": f"chapter-{len(chapters) + 1}",
                        "title": cur_title,
                        "content": cur_content,
                    }
                )
                cur_content = []
            cur_title = x["text"]
        elif x["type"] in ("h2", "h3"):
            cur_content.append({"type": "subtitle", "text": x["text"]})
        else:
            cur_content.append(x)

    if cur_content:
        chapters.append(
            {
                "id": f"chapter-{len(chapters) + 1}",
                "title": cur_title,
                "content": cur_content,
            }
        )
    return chapters


def xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def inline_html_to_fb2(block: dict) -> str:
    if "html" in block:
        s = block["html"]
        # Защищаем допустимые теги <em> и <strong>, остальное экранируем
        s = s.replace("<em>", "\x01EM_OPEN\x02").replace("</em>", "\x01EM_CLOSE\x02")
        s = s.replace("<strong>", "\x01ST_OPEN\x02").replace("</strong>", "\x01ST_CLOSE\x02")
        s = re.sub(r"<[^>]+>", "", s)
        s = xml_escape(html.unescape(s))
        s = (
            s.replace("\x01EM_OPEN\x02", "<emphasis>")
            .replace("\x01EM_CLOSE\x02", "</emphasis>")
            .replace("\x01ST_OPEN\x02", "<strong>")
            .replace("\x01ST_CLOSE\x02", "</strong>")
        )
        # Проверка баланса тегов, чтобы гарантировать 100% валидный XML
        if s.count("<emphasis>") == s.count("</emphasis>") and s.count("<strong>") == s.count("</strong>"):
            return s
    return xml_escape(block["text"])


def build_fb2(meta: dict, chapters: list, source_url: str) -> str:
    parts = re.split(r"\s+", meta["author"].replace("(", "").replace(")", ""))
    first_name = parts[0] if parts else meta["author"]
    last_name = parts[-1] if len(parts) > 1 else ""
    middle_name = parts[1] if len(parts) > 2 else ""

    genre_map = {
        "history": "sci_history",
        "russian-classics": "prose_rus_classic",
        "caucasus": "prose_history",
        "foreign-classics": "prose_classic",
        "science": "science",
        "rare-editions": "sci_educational",
    }
    fb2_genre = genre_map.get(meta["category"], "antique")

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
        "  <description>",
        "    <title-info>",
        f"      <genre>{fb2_genre}</genre>",
        "      <author>",
        f"        <first-name>{xml_escape(first_name)}</first-name>",
        f"        <middle-name>{xml_escape(middle_name)}</middle-name>",
        f"        <last-name>{xml_escape(last_name)}</last-name>",
        "      </author>",
        f"      <book-title>{xml_escape(meta['title'])}</book-title>",
        "      <annotation>",
        f"        <p>{xml_escape(meta['description'])}</p>",
        f"        <p>{xml_escape(meta['historical_note'])}</p>",
        f"        <p>Правовой статус: {xml_escape(meta['legal_status'])}</p>",
        "      </annotation>",
        f"      <date>{xml_escape(str(meta['written_year']))}</date>",
        f"      <lang>{xml_escape(meta['language'])}</lang>",
    ]
    if meta.get("translator"):
        lines.extend(
            [
                "      <translator>",
                f"        <nickname>{xml_escape(meta['translator'])}</nickname>",
                "      </translator>",
            ]
        )
    lines.extend(
        [
            "    </title-info>",
            "    <document-info>",
            "      <author><nickname>RaritetBook.ru Digital Archive</nickname></author>",
            f"      <src-url>{xml_escape(source_url)}</src-url>",
            f"      <id>{xml_escape(meta['slug'])}</id>",
            "      <version>1.0</version>",
            "    </document-info>",
            "    <publish-info>",
            f"      <book-name>{xml_escape(meta['title'])}</book-name>",
            "      <publisher>RaritetBook.ru — Открытая цифровая библиотека</publisher>",
            f"      <year>{xml_escape(str(meta['edition_year']))}</year>",
            "    </publish-info>",
            "  </description>",
            "  <body>",
            f"    <title><p>{xml_escape(meta['author_short'])}</p><p>{xml_escape(meta['title'])}</p></title>",
        ]
    )

    for ch in chapters:
        lines.append(f'    <section id="{xml_escape(ch["id"])}">')
        lines.append(f"      <title><p>{xml_escape(ch['title'])}</p></title>")
        for blk in ch["content"]:
            btype = blk["type"]
            if btype == "epigraph":
                lines.append("      <epigraph>")
                for ln in blk["text"].splitlines():
                    if ln.strip():
                        lines.append(f"        <p>{xml_escape(ln.strip())}</p>")
                lines.append("      </epigraph>")
            elif btype == "subtitle":
                lines.append(f"      <subtitle>{xml_escape(blk['text'])}</subtitle>")
            elif btype == "quote":
                lines.append("      <cite>")
                for ln in blk["text"].splitlines():
                    if ln.strip():
                        lines.append(f"        <p>{xml_escape(ln.strip())}</p>")
                lines.append("      </cite>")
            elif btype == "poem":
                lines.append("      <poem>")
                for st in blk.get("stanzas", []):
                    lines.append("        <stanza>")
                    for v in st:
                        lines.append(f"          <v>{xml_escape(v)}</v>")
                    lines.append("        </stanza>")
                lines.append("      </poem>")
            else:
                for sub_p in blk["text"].split("\n"):
                    sub_p = sub_p.strip()
                    if sub_p:
                        if "\n" not in blk["text"]:
                            lines.append(f"      <p>{inline_html_to_fb2(blk)}</p>")
                        else:
                            lines.append(f"      <p>{xml_escape(sub_p)}</p>")
        lines.append("    </section>")

    lines.extend(["  </body>", "</FictionBook>"])
    fb2_str = "\n".join(lines)
    # Строгая валидация XML!
    ET.fromstring(fb2_str.encode("utf-8"))
    return fb2_str


def process_book(entry: dict) -> dict:
    domain = entry["domain"]
    mode = entry["mode"]
    is_ossetian = entry["language"] == "os"
    chapters = []
    source_url = ""

    if mode == "single":
        page = entry["page"]
        source_url = f"https://{domain}/wiki/{urllib.parse.quote(page.replace(' ', '_'))}"
        raw_html = fetch_parsed_html(domain, page)
        items = parse_html_to_items(raw_html, is_ossetian=is_ossetian)
        chapters = split_items_into_chapters(items, entry["title"])

    elif mode == "chapters":
        first_page = entry["chapters_list"][0][0]
        root_page = first_page.rsplit("/", 1)[0]
        source_url = f"https://{domain}/wiki/{urllib.parse.quote(root_page.replace(' ', '_'))}"
        for idx, (ch_page, ch_title) in enumerate(entry["chapters_list"], start=1):
            try:
                raw_html = fetch_parsed_html(domain, ch_page)
            except Exception as exc:
                print(f"    [WARN] Пропуск отсутствующей подстраницы {ch_page}: {exc}")
                continue
            items = parse_html_to_items(raw_html, is_ossetian=is_ossetian)
            content = []
            for x in items:
                if x["type"] in ("h2", "h3"):
                    content.append({"type": "subtitle", "text": x["text"]})
                else:
                    content.append(x)
            if content:
                chapters.append({"id": f"chapter-{idx}", "title": ch_title, "content": content})

    elif mode == "auto_prefix":
        pref = entry["prefix"]
        source_url = f"https://{domain}/wiki/{urllib.parse.quote(pref.replace(' ', '_'))}"
        res = http_json(
            domain,
            {"action": "query", "list": "allpages", "apprefix": pref, "aplimit": 80, "format": "json"},
        )
        subpages = [p["title"] for p in res["query"]["allpages"] if p["title"] != pref]
        if not subpages:
            raw_html = fetch_parsed_html(domain, entry["fallback_page"])
            items = parse_html_to_items(raw_html, is_ossetian=is_ossetian)
            chapters = split_items_into_chapters(items, entry["title"])
        else:
            for idx, sp in enumerate(subpages, start=1):
                raw_html = fetch_parsed_html(domain, sp)
                items = parse_html_to_items(raw_html, is_ossetian=is_ossetian)
                ch_label = sp.split("/")[-1]
                content = [
                    ({"type": "subtitle", "text": x["text"]} if x["type"] in ("h2", "h3") else x)
                    for x in items
                ]
                if content:
                    chapters.append({"id": f"chapter-{idx}", "title": ch_label, "content": content})

    elif mode == "ossetian_search":
        source_url = "https://wikisource.org/wiki/Category:Kosta_Khetagurov"
        res = http_json(
            domain,
            {
                "action": "query",
                "list": "search",
                "srsearch": entry["search_query"],
                "srlimit": 60,
                "format": "json",
            },
        )
        poem_pages = [
            x["title"]
            for x in res["query"]["search"]
            if ("Хетæгкаты" in x["title"] or "Хетӕгкаты" in x["title"]) and "/" not in x["title"]
        ]
        # Стабильный порядок: открываем сборник программным «Ныстуан» («Завещание»), затем остальные по алфавиту
        poem_pages.sort(key=lambda t: (0 if t.startswith("Ныстуан") else 1, t))
        for idx, ptitle in enumerate(poem_pages, start=1):
            raw_html = fetch_parsed_html(domain, ptitle)
            items = parse_html_to_items(raw_html, is_ossetian=True)
            clean_name = normalize_ossetian(re.sub(r"\s*\(Хет[æӕ]гкаты\)\s*$", "", ptitle))
            content = []
            for x in items:
                if x["type"] in ("h2", "h3"):
                    if normalize_ossetian(x["text"]).lower() != clean_name.lower():
                        content.append({"type": "subtitle", "text": x["text"]})
                else:
                    content.append(x)
            if content:
                chapters.append({"id": f"poem-{idx}", "title": clean_name, "content": content})

    if not chapters:
        raise RuntimeError(f"Книга {entry['slug']} не содержит глав!")

    # Подсчёт реального объёма текста
    char_count = sum(
        len(blk.get("text", "")) for ch in chapters for blk in ch["content"]
    )
    word_count = sum(
        len(blk.get("text", "").split()) for ch in chapters for blk in ch["content"]
    )
    reading_minutes = max(3, round(word_count / 180))

    book_dir = BOOKS_DIR / entry["author_slug"] / entry["slug"]
    book_dir.mkdir(parents=True, exist_ok=True)

    archive_rel_base = f"/archive/books/{entry['author_slug']}/{entry['slug']}"

    book_json = {
        "id": entry["slug"],
        "slug": entry["slug"],
        "title": entry["title"],
        "altTitles": entry["alt_titles"],
        "author": entry["author"],
        "authorShort": entry["author_short"],
        "authorSlug": entry["author_slug"],
        "authorYears": entry["author_years"],
        "translator": entry["translator"],
        "language": entry["language"],
        "category": entry["category"],
        "writtenYear": entry["written_year"],
        "editionYear": entry["edition_year"],
        "description": entry["description"],
        "historicalNote": entry["historical_note"],
        "sourceUrl": source_url,
        "legalStatus": entry["legal_status"],
        "downloadAllowed": True,
        "fb2Url": f"{archive_rel_base}/original.fb2",
        "coverUrl": f"{archive_rel_base}/cover.webp",
        "stats": {
            "chaptersCount": len(chapters),
            "wordsCount": word_count,
            "charsCount": char_count,
            "readingMinutes": reading_minutes,
        },
        "toc": [{"id": ch["id"], "title": ch["title"]} for ch in chapters],
        "chapters": chapters,
    }

    fb2_xml = build_fb2(entry, chapters, source_url)

    (book_dir / "original.fb2").write_text(fb2_xml, encoding="utf-8")
    (book_dir / "book.json").write_text(
        json.dumps(book_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    meta_only = {k: v for k, v in book_json.items() if k != "chapters"}
    (book_dir / "meta.json").write_text(
        json.dumps(meta_only, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return meta_only


def main():
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)

    catalog_items = []
    errors = []

    print(f"=== Старт загрузки {len(BOOKS_MANIFEST)} полных книг в {BOOKS_DIR} ===")
    for idx, entry in enumerate(BOOKS_MANIFEST, start=1):
        print(f"[{idx:02d}/{len(BOOKS_MANIFEST):02d}] Загрузка: {entry['author_short']} — «{entry['title']}» ...", flush=True)
        try:
            meta = process_book(entry)
            st = meta["stats"]
            print(
                f"       OK: глав={st['chaptersCount']}, слов={st['wordsCount']:,}, знаков={st['charsCount']:,}",
                flush=True,
            )
            catalog_items.append(
                {
                    "id": meta["id"],
                    "slug": meta["slug"],
                    "title": meta["title"],
                    "altTitles": meta["altTitles"],
                    "author": meta["author"],
                    "authorShort": meta["authorShort"],
                    "authorSlug": meta["authorSlug"],
                    "authorYears": meta["authorYears"],
                    "translator": meta["translator"],
                    "language": meta["language"],
                    "category": meta["category"],
                    "writtenYear": meta["writtenYear"],
                    "editionYear": meta["editionYear"],
                    "description": meta["description"],
                    "historicalNote": meta["historicalNote"],
                    "legalStatus": meta["legalStatus"],
                    "sourceUrl": meta["sourceUrl"],
                    "downloadAllowed": meta["downloadAllowed"],
                    "bookUrl": f"/archive/books/{meta['authorSlug']}/{meta['slug']}/book.json",
                    "fb2Url": meta["fb2Url"],
                    "coverUrl": meta["coverUrl"],
                    "chaptersCount": st["chaptersCount"],
                    "wordsCount": st["wordsCount"],
                    "charsCount": st["charsCount"],
                    "readingMinutes": st["readingMinutes"],
                }
            )
        except Exception as exc:
            print(f"       [ERROR] {entry['slug']}: {exc}", flush=True)
            errors.append((entry["slug"], str(exc)))

    # Сборка categories.json с реальным количеством книг
    cat_counts = {}
    for item in catalog_items:
        cat_counts[item["category"]] = cat_counts.get(item["category"], 0) + 1

    categories_out = []
    for c in CATEGORIES:
        c_copy = dict(c)
        c_copy["booksCount"] = cat_counts.get(c["id"], 0)
        categories_out.append(c_copy)

    # Сборка authors.json
    authors_map = {}
    for item in catalog_items:
        aslug = item["authorSlug"]
        if aslug not in authors_map:
            authors_map[aslug] = {
                "slug": aslug,
                "name": item["author"],
                "shortName": item["authorShort"],
                "years": item["authorYears"],
                "booksCount": 0,
                "books": [],
            }
        authors_map[aslug]["booksCount"] += 1
        authors_map[aslug]["books"].append(item["slug"])

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    catalog_payload = {
        "version": f"1.0.{len(catalog_items)}",
        "generatedAt": now_iso,
        "totalBooks": len(catalog_items),
        "books": catalog_items,
    }

    (CATALOG_DIR / "catalog.json").write_text(
        json.dumps(catalog_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (CATALOG_DIR / "categories.json").write_text(
        json.dumps(categories_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (CATALOG_DIR / "authors.json").write_text(
        json.dumps(list(authors_map.values()), ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Формирование юридического реестра фонда (LEGAL_REGISTER.md)
    reg_lines = [
        "# Юридический реестр книжного фонда RaritetBook.ru",
        "",
        f"- **Дата сборки:** `{now_iso}`",
        f"- **Всего проверенных полных книг:** **{len(catalog_items)}**",
        "- **Правовое основание:** статьи 1281 и 1282 Гражданского кодекса РФ (переход произведений и переводов в общественное достояние).",
        "",
        "| № | Произведение | Автор (годы жизни) | Переводчик | Категория | Язык | Глав | Слов | Правовой статус |",
        "| :-: | :--- | :--- | :--- | :--- | :-: | --: | --: | :--- |",
    ]
    for i, b in enumerate(catalog_items, start=1):
        tr = b["translator"] or "Оригинал"
        reg_lines.append(
            f"| {i} | **{b['title']}** (`{b['slug']}`) | {b['authorShort']} ({b['authorYears']}) | {tr} | `{b['category']}` | `{b['language']}` | {b['chaptersCount']} | {b['wordsCount']:,} | {b['legalStatus']} |"
        )
    (ARCHIVE_DIR / "LEGAL_REGISTER.md").write_text("\n".join(reg_lines) + "\n", encoding="utf-8")

    print(f"\n=== Готово: успешно собрано {len(catalog_items)} книг, ошибок: {len(errors)} ===")
    if errors:
        for s, e in errors:
            print(f"  - {s}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
