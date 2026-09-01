#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generuje strona/sitemap.xml na podstawie zmirrorowanych stron.
Pomija panel /admin/, strony techniczne i demo-strony motywu. Idempotentny."""
import os, glob, datetime

BASE = "https://gig.org.pl"
STRONA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "strona")
# strony do pominięcia w sitemapie (demo/techniczne)
# /wpis/ to szablon wpisow dynamicznych (tresc z Supabase), nie samodzielna strona.
# /przyklad/, /about/, /blog/, /category/ usuniete z repo - zostaja tu jako zabezpieczenie,
# gdyby crawl.py kiedys sciagnal je ponownie z WordPressa.
# /aktualnosci/ i /artykuly/ to krotkie adresy z WordPressa - identyczne z wersjami
# spod /baza-wiedzy/, do ktorych prowadzi menu. Zostaja czynne, ale wskazuja
# canonicalem na wersje z menu, wiec w sitemapie ich nie ma.
BLOCK = {"/admin/", "/wpis/", "/aktualnosci/", "/artykuly/",
         "/przyklad/", "/about/", "/blog/", "/category/",
         "/newsletter-wypisano.html"}
PRIORITY = {"/": "1.0"}

def page_path(fp):
    rel = os.path.relpath(fp, STRONA).replace(os.sep, "/")
    if rel == "index.html": return "/"
    if rel.endswith("/index.html"): return "/" + rel[:-len("index.html")]
    return "/" + rel

def main():
    today = datetime.date.today().isoformat()
    urls = []
    for fp in glob.glob(os.path.join(STRONA, "**", "index.html"), recursive=True):
        p = page_path(fp)
        if any(p.startswith(b) or p == b for b in BLOCK): continue
        urls.append(p)
    urls = sorted(set(urls), key=lambda x: (x != "/", x))
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in urls:
        out.append(f"  <url><loc>{BASE}{p}</loc><lastmod>{today}</lastmod>"
                   f"<priority>{PRIORITY.get(p,'0.7')}</priority></url>")
    out.append("</urlset>\n")
    with open(os.path.join(STRONA, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"sitemap.xml: {len(urls)} URL-i")
    for p in urls: print("  ", p)

if __name__ == "__main__":
    main()
