# -*- coding: utf-8 -*-
"""Uzupełnia podstawy SEO na stronach z mapy strony (poza /wpis/, które robi prerender.mjs).

Dopisuje tylko to, czego brakuje: opis meta, tagi Open Graph / Twitter (z pełnymi
adresami obrazków), H1 dla czytników i robotów tam, gdzie strona z WordPressa go nie ma
(ukryty wizualnie, bo zamiana istniejącego nagłówka na H1 zmieniłaby wygląd),
JSON-LD Organization/WebSite na stronie głównej i Article na starszych artykułach.
Idempotentny: drugie uruchomienie niczego nie zmienia.

    python skrypty/seo_uzupelnij.py
"""
import html as H
import io
import json
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'strona')
SITE = 'https://gig.org.pl'
OG_DOMYSLNY = SITE + '/_assets/img/gig-og.png'
UKRYTY = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'

OPISY = {
    '': ('Geodezyjna Izba Gospodarcza zrzesza firmy geodezyjne w Polsce od 1994 roku. Reprezentujemy branżę wobec administracji, opiniujemy przepisy, prowadzimy szkolenia i katalog firm członkowskich.',
         'Geodezyjna Izba Gospodarcza: samorząd gospodarczy firm geodezyjnych'),
    'szkolenia/': ('Kalendarz szkoleń Geodezyjnej Izby Gospodarczej: warsztaty i szkolenia online dla geodetów, firm geodezyjnych i administracji, z ceną członkowską dla firm zrzeszonych w Izbie.',
                   'Szkolenia Geodezyjnej Izby Gospodarczej'),
    'baza-wiedzy/aktualnosci-gig/': ('Aktualności Geodezyjnej Izby Gospodarczej: wydarzenia, stanowiska Izby, szkolenia i sprawy branży geodezyjnej.', 'Aktualności GIG'),
    'baza-wiedzy/artykuly/': ('Artykuły eksperckie Geodezyjnej Izby Gospodarczej: prawo geodezyjne, planowanie przestrzenne, granice nieruchomości, detekcja sieci podziemnych i praktyka firm geodezyjnych.', 'Artykuły eksperckie GIG'),
    'biuletyn-gig/': ('Archiwum Biuletynu Informacyjnego Geodezyjnej Izby Gospodarczej.', 'Biuletyn Informacyjny GIG'),
    'dolacz-do-nas/': ('Dołącz do Geodezyjnej Izby Gospodarczej: korzyści członkostwa, składka od 40 zł miesięcznie, wpisowe 75 zł i formularz zgłoszeniowy.', 'Dołącz do Geodezyjnej Izby Gospodarczej'),
    'kontakt/': ('Kontakt z Geodezyjną Izbą Gospodarczą: ul. Czackiego 3/5, 00-043 Warszawa, tel. 22 827 38 43, biuro@gig.org.pl. Organy Izby i przedstawiciele regionalni.', 'Kontakt z Geodezyjną Izbą Gospodarczą'),
    'o-nas/': ('Geodezyjna Izba Gospodarcza od 1994 roku reprezentuje firmy geodezyjne. Poznaj historię, statut, organy Izby i jej działania.', 'O Geodezyjnej Izbie Gospodarczej'),
    'polityka-prywatnosci-rodo/': ('Polityka prywatności i zasady przetwarzania danych osobowych (RODO) w serwisie Geodezyjnej Izby Gospodarczej.', 'Polityka prywatności'),
}
MIES = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']


def meta(s, klucz, attr='property'):
    for pat in (r'<meta[^>]*%s="%s"[^>]*content="([^"]*)"' % (attr, re.escape(klucz)),
                r'<meta[^>]*content="([^"]*)"[^>]*%s="%s"' % (attr, re.escape(klucz))):
        m = re.search(pat, s)
        if m:
            return H.unescape(m.group(1))
    return None


def skroc(t, n=158):
    t = re.sub(r'\s+', ' ', t or '').strip()
    return t if len(t) <= n else re.sub(r'\s+\S*$', '', t[:n]) + '…'


def h1_widoczne(s):
    bez = re.sub(r'<script[\s\S]*?</script>', '', s)
    return len(re.findall(r'<h1[\s>]', bez))


def daty_z_list():
    """Adres wpisu -> data ISO z list /aktualnosci/ i /artykuly/ (kopia WordPressa)."""
    wynik = {}
    for lista in ('aktualnosci', 'artykuly'):
        s = io.open(os.path.join(ROOT, lista, 'index.html'), encoding='utf-8').read()
        for a in re.findall(r'<article[^>]*post-item[\s\S]*?</article>', s):
            h = re.search(r'entry-title[^>]*>\s*<a href="([^"]+)"', a)
            d = re.search(r'class="date_label">(\d{1,2}) (\S+?),? (\d{4})', a)
            if h and d and d.group(2) in MIES:
                wynik[h.group(1)] = '%s-%02d-%02d' % (d.group(3), MIES.index(d.group(2)) + 1, int(d.group(1)))
    return wynik


DATY = {}


def main():
    DATY.update(daty_z_list())
    locs = re.findall(r'<loc>%s/([^<]*)</loc>' % re.escape(SITE), io.open(os.path.join(ROOT, 'sitemap.xml'), encoding='utf-8').read())
    for loc in locs:
        if loc.startswith('wpis/'):
            continue
        p = os.path.join(ROOT, loc.replace('/', os.sep), 'index.html')
        if not os.path.exists(p):
            continue
        s0 = s = io.open(p, encoding='utf-8').read()
        url = SITE + '/' + loc
        tytul = H.unescape(re.search(r'<title>([^<]*)</title>', s).group(1)).strip()
        opis_def, h1_def = OPISY.get(loc, (None, None))
        dodaj = []

        opis = meta(s, 'description', 'name')
        if not opis:
            opis = opis_def or skroc(meta(s, 'og:description') or '')
            if opis:
                dodaj.append('<meta name="description" content="%s">' % H.escape(skroc(opis, 300)))

        # obrazek do udostępniania: względny adres z WordPressa → pełny
        img = meta(s, 'og:image')
        if img and img.startswith('/'):
            s = re.sub(r'(<meta[^>]*content=")%s("[^>]*property="og:image")' % re.escape(img), r'\g<1>%s\2' % (SITE + img), s)
            s = re.sub(r'(<meta[^>]*property="og:image"[^>]*content=")%s(")' % re.escape(img), r'\g<1>%s\2' % (SITE + img), s)
            img = SITE + img
        if not meta(s, 'og:title'):
            og_t = re.sub(r'\s*[–|-]\s*Geodezyjna Izba Gospodarcza$', '', tytul) if loc else 'Geodezyjna Izba Gospodarcza'
            dodaj += ['<meta property="og:type" content="website">', '<meta property="og:site_name" content="Geodezyjna Izba Gospodarcza">',
                      '<meta property="og:title" content="%s">' % H.escape(og_t), '<meta property="og:url" content="%s">' % url,
                      '<meta property="og:locale" content="pl_PL">']
            if opis:
                dodaj.append('<meta property="og:description" content="%s">' % H.escape(skroc(opis, 300)))
        if not img:
            dodaj.append('<meta property="og:image" content="%s">' % OG_DOMYSLNY)
        if not meta(s, 'twitter:card', 'name'):
            dodaj.append('<meta name="twitter:card" content="summary_large_image">')

        # dane strukturalne
        if loc == '' and '"@type":"Organization"' not in s:
            org = {'@context': 'https://schema.org', '@graph': [
                {'@type': 'Organization', '@id': SITE + '/#organizacja', 'name': 'Geodezyjna Izba Gospodarcza', 'alternateName': 'GIG',
                 'url': SITE + '/', 'logo': SITE + '/_assets/img/gig-logo-email.png', 'image': OG_DOMYSLNY,
                 'description': OPISY[''][0], 'foundingDate': '1994', 'slogan': 'Silni wiedzą, zjednoczeni działaniem',
                 'email': 'biuro@gig.org.pl', 'telephone': '+48 22 827 38 43', 'taxID': '5252034024', 'identifier': ['KRS 0000090356', 'REGON 010753536'],
                 'address': {'@type': 'PostalAddress', 'streetAddress': 'ul. Czackiego 3/5', 'postalCode': '00-043', 'addressLocality': 'Warszawa', 'addressCountry': 'PL'},
                 'areaServed': 'PL', 'knowsAbout': ['geodezja', 'prawo geodezyjne i kartograficzne', 'ewidencja gruntów i budynków', 'GESUT', 'granice nieruchomości', 'szkolenia geodezyjne'],
                 'sameAs': ['https://www.facebook.com/gigorgpl', 'https://www.linkedin.com/company/gig-geodezyjna-izba-gospodarcza']},
                {'@type': 'WebSite', '@id': SITE + '/#witryna', 'url': SITE + '/', 'name': 'Geodezyjna Izba Gospodarcza', 'inLanguage': 'pl',
                 'publisher': {'@id': SITE + '/#organizacja'}}]}
            dodaj.append('<script type="application/ld+json">%s</script>' % json.dumps(org, ensure_ascii=False, separators=(',', ':')))
        autor = re.search(r'class="a-byline"><span>Autor: <b>([^<]+)</b>([^<]*)</span><span class="dot"></span><span>(\d{1,2}) (\S+) (\d{4})', s)
        if autor and '"@type":"Article"' not in s:
            d, mies, rok = int(autor.group(3)), autor.group(4), autor.group(5)
            data = '%s-%02d-%02d' % (rok, MIES.index(mies) + 1, d) if mies in MIES else None
            art = {'@context': 'https://schema.org', '@type': 'Article', 'headline': skroc(meta(s, 'og:title') or tytul, 110),
                   'description': skroc(opis or '', 300), 'url': url, 'mainEntityOfPage': url, 'inLanguage': 'pl',
                   'author': {'@type': 'Person', 'name': autor.group(1).strip(), 'description': (autor.group(1) + autor.group(2)).strip(' ,')},
                   'publisher': {'@type': 'Organization', 'name': 'Geodezyjna Izba Gospodarcza', 'url': SITE,
                                 'logo': {'@type': 'ImageObject', 'url': SITE + '/_assets/img/gig-logo-email.png'}}}
            if data:
                art['datePublished'] = data
            if img:
                art['image'] = [img]
            dodaj.append('<script type="application/ld+json">%s</script>' % json.dumps(art, ensure_ascii=False, separators=(',', ':')))

        # wpisy bez podpisu autora: data z list Aktualności/Artykułów, autorem jest Izba
        if not autor and '/' + loc in DATY and '"@type":"Article"' not in s and '"@type":"NewsArticle"' not in s \
                and '"@type":"Article"' not in ''.join(dodaj):
            art = {'@context': 'https://schema.org', '@type': 'NewsArticle', 'headline': skroc(meta(s, 'og:title') or tytul, 110),
                   'description': skroc(opis or '', 300), 'url': url, 'mainEntityOfPage': url, 'inLanguage': 'pl',
                   'datePublished': DATY['/' + loc],
                   'author': {'@type': 'Organization', 'name': 'Geodezyjna Izba Gospodarcza', 'url': SITE},
                   'publisher': {'@type': 'Organization', 'name': 'Geodezyjna Izba Gospodarcza', 'url': SITE,
                                 'logo': {'@type': 'ImageObject', 'url': SITE + '/_assets/img/gig-logo-email.png'}}}
            if img:
                art['image'] = [img]
            dodaj.append('<script type="application/ld+json">%s</script>' % json.dumps(art, ensure_ascii=False, separators=(',', ':')))

        if dodaj and '<!--GIG-SEO-->' in s:
            s = s.replace('<!--/GIG-SEO-->', '\n' + '\n'.join(dodaj) + '<!--/GIG-SEO-->', 1)
        elif dodaj:
            s = s.replace('</head>', '<!--GIG-SEO-->' + '\n'.join(dodaj) + '<!--/GIG-SEO-->\n</head>', 1)

        if h1_widoczne(s) == 0:
            tekst = h1_def or meta(s, 'og:title') or tytul
            s = re.sub(r'(<body[^>]*>)', r'\1<h1 class="gig-h1" style="%s">%s</h1>' % (UKRYTY, H.escape(tekst).replace('\\', '\\\\')), s, count=1)

        if s != s0:
            io.open(p, 'w', encoding='utf-8', newline='').write(s)
            print('uzupełniono:', loc or '/')


if __name__ == '__main__':
    main()
