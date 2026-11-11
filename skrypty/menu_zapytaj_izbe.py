#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pozycja menu "Zapytaj Izbę" (między "Baza wiedzy" a "Szkolenia") na wszystkich stronach publicznych.

Podmenu: Pytania i odpowiedzi (/pytania/), Zadaj pytanie (/pytania/zadaj/), Głos Izby (/stanowiska/).

Dwa rodzaje stron:
  1. strony ręczne z <nav class="nav">: element span.nav-item z span.nav-sub, wstawiany przed
     linkiem "Szkolenia". Na stronach sekcji (strona/pytania/**, strona/stanowiska/**) pozycja
     dostaje class="active" (główna i właściwa pozycja podmenu), a "Baza wiedzy" traci active.
  2. strony z kopii WordPressa (ul#menu-main-menu, 3 kopie menu w pliku): statyczne <li> z podmenu,
     wstawiane przed <li> "Szkolenia" w każdej kopii. Tak samo (statycznie) dodano 9.11.2026
     "Z firm członkowskich"; gig-site.js (restructureMenu) szuka pozycji po adresach i tej nie rusza.
     Atrybut data-gig-dd="1" włącza regułę rozwijania z gig-site.js (jak "Baza wiedzy").

Skrypt jest idempotentny: usuwa swoją pozycję, jeśli już jest, i wstawia ją od nowa w kanonicznej
postaci; plik zapisuje tylko wtedy, gdy treść się zmieniła. Katalog admin/ pomija.

Uruchomienie:  python skrypty/menu_zapytaj_izbe.py          (zapis)
               python skrypty/menu_zapytaj_izbe.py --check  (tylko raport, kod 1 gdy są różnice)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "strona"
POMIN = {"admin", "wp-content", "wp-includes", "_assets"}

ETYKIETA = "Zapytaj Izbę"
PODMENU = [
    ("/pytania/", "Pytania i odpowiedzi"),
    ("/pytania/zadaj/", "Zadaj pytanie"),
    ("/stanowiska/", "Głos Izby"),
]

# ---------- strony ręczne ----------
NAV_RE = re.compile(r'(<nav class="nav">)(.*?)(</nav>)', re.S)
NAV_STARE_RE = re.compile(
    r'<span class="nav-item"><a href="/pytania/"[^>]*>' + re.escape(ETYKIETA) +
    r'</a><span class="nav-sub">.*?</span></span>', re.S)
NAV_SZKOLENIA_RE = re.compile(r'<a href="/szkolenia/"[^>]*>Szkolenia</a>')
NAV_BAZA_ACTIVE = '<a href="/baza-wiedzy/" class="active">Baza wiedzy</a>'
NAV_BAZA = '<a href="/baza-wiedzy/">Baza wiedzy</a>'


def aktywna(rel):
    """Adres aktywnej pozycji podmenu dla stron sekcji; None dla pozostałych."""
    czesci = rel.parts
    if czesci[0] == "stanowiska":
        return "/stanowiska/"
    if czesci[0] == "pytania":
        return "/pytania/zadaj/" if len(czesci) > 1 and czesci[1] == "zadaj" else "/pytania/"
    return None


def nav_pozycja(akt):
    a = ' class="active"'
    sub = "".join('<a href="%s"%s>%s</a>' % (h, a if h == akt else "", t) for h, t in PODMENU)
    return ('<span class="nav-item"><a href="/pytania/"%s>%s</a><span class="nav-sub">%s</span></span>'
            % (a if akt else "", ETYKIETA, sub))


def popraw_nav(html, rel):
    m = NAV_RE.search(html)
    if not m:
        return html, None
    srodek = NAV_STARE_RE.sub("", m.group(2))
    if len(NAV_SZKOLENIA_RE.findall(srodek)) != 1:
        return html, "nav.nav bez jednoznacznego linku Szkolenia"
    akt = aktywna(rel)
    if akt:
        srodek = srodek.replace(NAV_BAZA_ACTIVE, NAV_BAZA)
    srodek = NAV_SZKOLENIA_RE.sub(lambda s: nav_pozycja(akt) + s.group(0), srodek, count=1)
    return html[:m.start(2)] + srodek + html[m.end(2):], None


# ---------- strony z kopii WordPressa ----------
def wp_a(href, etykieta, ikona):
    return ('<a class="mfn-menu-link" href="%s"><span class="menu-item-helper mfn-menu-item-helper"></span>'
            '<span class="label-wrapper mfn-menu-label-wrapper"><span class="menu-label">%s</span></span>'
            '<span class="menu-sub %s"></i></span></a>' % (href, etykieta, ikona))


WP_POZYCJA = (
    '<li class="menu-item menu-item-type-custom menu-item-object-custom menu-item-has-children '
    'gig-menu-zapytaj mfn-menu-li" data-gig-dd="1">'
    + wp_a("/pytania/", ETYKIETA, 'mfn-menu-subicon"><i class="fas fa-arrow-down')
    + '<ul class="sub-menu mfn-submenu">'
    + "".join('<li class="menu-item menu-item-type-custom menu-item-object-custom mfn-menu-li">'
              + wp_a(h, t, 'mfn-menu-sub-subicon"><i class="fas fa-arrow-right') + "</li>"
              for h, t in PODMENU)
    + "</ul></li>")
WP_STARE_RE = re.compile(r'<li class="[^"]*\bgig-menu-zapytaj\b[^>]*>.*?</ul></li>\r?\n', re.S)
WP_SZKOLENIA_RE = re.compile(
    r'<li class="menu-item [^"]*\bmenu-item-17 mfn-menu-li"[^>]*><a [^>]*href="/szkolenia/"')


def popraw_wp(html):
    if "menu-main-menu" not in html:
        return html, None
    czyste = WP_STARE_RE.sub("", html)
    ile_menu = len(re.findall(r'<ul[^>]*\bid="menu-main-menu', czyste)) or \
        len(re.findall(r"<ul[^>]*\bmfn-header-menu\b", czyste))
    ile_szk = len(WP_SZKOLENIA_RE.findall(czyste))
    if ile_szk == 0:
        return html, "menu WordPressa bez pozycji Szkolenia"
    if ile_menu and ile_szk != ile_menu:
        return html, "liczba pozycji Szkolenia (%d) inna niż liczba kopii menu (%d)" % (ile_szk, ile_menu)
    nl = "\r\n" if "\r\n" in czyste else "\n"
    return WP_SZKOLENIA_RE.sub(lambda s: WP_POZYCJA + nl + s.group(0), czyste), None


def main():
    tylko_raport = "--check" in sys.argv
    zmienione, bez_zmian, uwagi = [], 0, []
    for p in sorted(ROOT.rglob("*.html")):
        rel = p.relative_to(ROOT)
        if rel.parts[0] in POMIN:
            continue
        with open(p, encoding="utf-8", newline="") as f:  # bez zamiany końców linii (część plików ma CRLF)
            stary = f.read()
        nowy, u1 = popraw_nav(stary, rel)
        nowy, u2 = popraw_wp(nowy)
        for u in (u1, u2):
            if u:
                uwagi.append("%s: %s" % (rel.as_posix(), u))
        if nowy != stary:
            zmienione.append(rel.as_posix())
            if not tylko_raport:
                with open(p, "w", encoding="utf-8", newline="") as f:
                    f.write(nowy)
        elif 'href="/pytania/"' in stary:
            bez_zmian += 1
    for z in zmienione:
        print(("do zmiany: " if tylko_raport else "zmieniono: ") + z)
    for u in uwagi:
        print("UWAGA " + u)
    print("Zmienione pliki: %d, już aktualne: %d, uwagi: %d" % (len(zmienione), bez_zmian, len(uwagi)))
    return 1 if (uwagi or (tylko_raport and zmienione)) else 0


if __name__ == "__main__":
    sys.exit(main())
