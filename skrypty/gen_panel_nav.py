# -*- coding: utf-8 -*-
"""Jedno zrodlo prawdy dla menu panelu /admin/.

Menu bylo wklejone recznie w kazdej z kilkunastu stron, wiec dolozenie pozycji
znaczylo kilkanascie identycznych edycji i za kazdym razem ryzyko, ze gdzies
zostanie stara wersja. Ten skrypt przepisuje blok <nav class="sidebar-nav"> we
wszystkich plikach strona/admin/*.html i sam zaznacza aktywna pozycje.

Uruchom po kazdej zmianie MENU:
    python skrypty/gen_panel_nav.py
Idempotentny: powtorzone uruchomienie nic nie zmienia.
"""
import io
import os
import re
import sys

KATALOG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'strona', 'admin')

# (sekcja, plik, ikona, etykieta, id plakietki albo None)
# Sekcja None = pozycja bez naglowka (Pulpit na samej gorze).
# Kolejnosc odzwierciedla rytm pracy biura: najpierw to, co przyszlo ze strony,
# potem sprawy Izby, dalej tresci i wysylka maili.
MENU = [
    (None,                  'dashboard.html',             '\U0001f3e0', 'Pulpit',              None),
    ('Zgłoszenia ze strony', 'formularze.html#kontakt',   '\U0001f4e8', 'Kontakt',             'navBadgeKontakt'),
    ('Zgłoszenia ze strony', 'formularze.html#newsletter', '✉',    'Newsletter',          'navBadgeNewsletter'),
    ('Zgłoszenia ze strony', 'zapisy.html',                '\U0001f4dd', 'Zapisy na szkolenia', 'navBadgeZapisy'),
    ('Sprawy Izby',         'czlonkowie.html?status=oczekuje', '\U0001f3e2', 'Członkowie',     'navBadgeCzlonkowie'),
    ('Sprawy Izby',         'uchwaly.html',               '⚖',     'Uchwały Rady',        'navBadgeUchwaly'),
    ('Sprawy Izby',         'konsultacje.html',           '\U0001f5f3', 'Konsultacje',         'navBadgeKonsultacje'),
    ('Sprawy Izby',         'wezel.html',                 '\U0001f4ca', 'Węzeł Jakości',       'navBadgeWezel'),
    ('Treści na stronie',   'artykuly.html',              '\U0001f4f0', 'Artykuły',            None),
    ('Treści na stronie',   'szkolenia.html',             '\U0001f393', 'Szkolenia',           None),
    ('Wysyłka maili',       'baza-email.html',            '\U0001f4c7', 'Baza e-mail',         None),
    ('Wysyłka maili',       'wysylki.html',               '\U0001f4e3', 'Wysyłki',             None),
    ('Wysyłka maili',       'dmarc.html',                 '\U0001f6e1', 'DMARC',               None),
    ('Strona',              '/',                          '↗',     'Zobacz stronę',       None),
]

BLOK = re.compile(r'<nav class="sidebar-nav">.*?</nav>', re.S)


def nav(plik):
    """HTML menu z aktywna pozycja dopasowana do biezacego pliku."""
    linie, sekcja = [], ''
    for sek, href, ikona, etykieta, badge in MENU:
        if sek and sek != sekcja:
            linie.append('        <div class="nav-section">%s</div>' % sek)
        sekcja = sek or sekcja
        # formularze.html#kontakt i #newsletter to ta sama strona: obie podswietlamy
        aktywna = href.split('#')[0].split('?')[0] == plik
        atrybuty = ' class="active"' if aktywna else ''
        cel = ' target="_blank"' if href.startswith('/') else ''
        plakietka = (' <span class="nav-badge" id="%s" style="display:none">0</span>' % badge) if badge else ''
        linie.append('        <a href="%s"%s%s><span class="nav-icon">%s</span> %s%s</a>'
                     % (href, atrybuty, cel, ikona, etykieta, plakietka))
    return '<nav class="sidebar-nav">\n' + '\n'.join(linie) + '\n      </nav>'


def main():
    zmienione, bez_menu = [], []
    for nazwa in sorted(os.listdir(KATALOG)):
        if not nazwa.endswith('.html'):
            continue
        sciezka = os.path.join(KATALOG, nazwa)
        tekst = io.open(sciezka, encoding='utf-8').read()
        if not BLOK.search(tekst):
            bez_menu.append(nazwa)          # logowanie, ustaw-haslo itp. nie maja menu
            continue
        nowy = BLOK.sub(lambda _m: nav(nazwa), tekst, count=1)
        if nowy != tekst:
            io.open(sciezka, 'w', encoding='utf-8', newline='').write(nowy)
            zmienione.append(nazwa)
    print('menu odswiezone w: %s' % (', '.join(zmienione) or 'nic do zmiany'))
    if bez_menu:
        print('bez menu (pominiete): %s' % ', '.join(bez_menu))
    return 0


if __name__ == '__main__':
    sys.exit(main())
