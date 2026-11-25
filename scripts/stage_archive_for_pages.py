#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Подготовка витрины книжного хранилища (archive_deploy) через мгновенные жёсткие ссылки NTFS (0 байт копирования!)
для выгрузки всех 10 000 томов book.json в Cloudflare CDN (raritetbook-archive.pages.dev / archive.raritetbook.ru).
"""

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SRC_BOOKS = BASE_DIR / "archive" / "books"
SRC_CAT = BASE_DIR / "archive" / "catalog"
STAGE_DIR = BASE_DIR / "archive_deploy"


def main():
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    (STAGE_DIR / "archive" / "books").mkdir(parents=True, exist_ok=True)
    (STAGE_DIR / "archive" / "catalog").mkdir(parents=True, exist_ok=True)

    # CORS + Immutable кэширование на год по п. 13 ТЗ
    (STAGE_DIR / "_headers").write_text(
        "/archive/books/*\n"
        "  Access-Control-Allow-Origin: *\n"
        "  Access-Control-Allow-Methods: GET, HEAD, OPTIONS\n"
        "  Cache-Control: public, max-age=31536000, immutable\n\n"
        "/archive/catalog/*\n"
        "  Access-Control-Allow-Origin: *\n"
        "  Access-Control-Allow-Methods: GET, HEAD, OPTIONS\n"
        "  Cache-Control: public, max-age=3600, s-maxage=86400\n",
        encoding="utf-8",
    )

    count = 0
    for bj in SRC_BOOKS.glob("*/*/book.json"):
        rel = bj.relative_to(SRC_BOOKS)
        dst = STAGE_DIR / "archive" / "books" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(bj, dst)
        except OSError:
            shutil.copy2(bj, dst)
        count += 1

    for cf in ("catalog.json", "categories.json"):
        s = SRC_CAT / cf
        if s.exists():
            shutil.copy2(s, STAGE_DIR / "archive" / "catalog" / cf)

    print(f"Подготовлено к выгрузке в Cloudflare CDN: {count} книг в {STAGE_DIR}")


if __name__ == "__main__":
    main()
