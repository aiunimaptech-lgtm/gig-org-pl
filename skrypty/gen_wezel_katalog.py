# -*- coding: utf-8 -*-
"""Katalog pozycji cenowych do ankiety „Węzeł Jakości" (strona /wezel-jakosci/).

Źródłem jest arkusz SEKOCENBUD przygotowany w ZOPI (kolumny: kod WKI, SEK, nazwa,
jednostka, wskaźnik min / max / średni). Wiersze bez jednostki i cen to nagłówki grup.

Wynik: strona/_assets/js/wezel-katalog.js — stała `window.GIG_WEZEL_KATALOG`
(grupy z pozycjami). Wskaźniki z arkusza wędrują do pola `ref` i na stronie są
domyślnie ukryte, żeby nie sugerować odpowiedzi.

Użycie:
  python skrypty/gen_wezel_katalog.py "<ścieżka do xlsx>" [--kwartal "2 kw. 2025"]
"""
import argparse, io, json, os, re, sys

try:
    import openpyxl
except ImportError:
    sys.exit("Brak openpyxl: pip install openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
WYJSCIE = os.path.join(HERE, "..", "strona", "_assets", "js", "wezel-katalog.js")


def liczba(x):
    if x is None or str(x).strip() == "":
        return None
    try:
        return round(float(str(x).replace(",", ".").replace(" ", "")), 2)
    except ValueError:
        return None


def skroc(nazwa, grupa):
    """„Wytyczenie - wykopu pod budynek" w grupie „Wytyczenie" → „wykopu pod budynek"."""
    baza = grupa.rstrip(":").strip()
    if baza and nazwa.lower().startswith(baza.lower()):
        reszta = nazwa[len(baza):].lstrip(" -,:")
        if reszta:
            return reszta[0].upper() + reszta[1:]
    return nazwa


SEKCJE = [
    ("7.51", "Prace geodezyjne - obsługa bieżąca"),
    ("7.52", "Inwestycje drogowe - przygotowanie i ofertowanie"),
    ("7.53", "Inwestycje drogowe - realizacja"),
    ("7.54", "Inwestycje kolejowe"),
]


def sekcja(kod):
    """Sekcja z numeru WKI: 7.51x prace bieżące, 7.52x/7.53x drogi, 7.54x koleje.
    Dwie grupy mają w arkuszu tę samą nazwę (kadra na kontrakt, inwentaryzacja
    powykonawcza) raz przy drogach, raz przy kolei - sekcja je rozróżnia."""
    for prefiks, nazwa in SEKCJE:
        if prefiks in kod:
            return nazwa
    return "Pozostałe"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--kwartal", default="2 kw. 2025")
    args = ap.parse_args()

    ws = openpyxl.load_workbook(args.xlsx, data_only=True).active
    grupy, biezaca = [], None
    naglowek_pomijany = True

    for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
        kod = str(row[0].value or "").strip()
        nazwa = str(row[2].value or "").strip()
        jm = str(row[3].value or "").strip()
        mn, mx, sr = (liczba(row[4].value), liczba(row[5].value), liczba(row[6].value))
        if not kod or not nazwa:
            continue
        if naglowek_pomijany:                      # pierwszy wiersz to nazwy kolumn
            naglowek_pomijany = False
            continue

        if not jm and mn is None:                  # wiersz nagłówkowy grupy
            tytul = nazwa.rstrip(":").strip()
            # nagłówek zagnieżdżony (np. „Inwentaryzacja ogólna obiektów kubaturowych")
            # scalamy z nadrzędnym, żeby na stronie była jedna płaska lista grup
            grupy.append({"kod": kod, "tytul": tytul, "sekcja": sekcja(kod), "pozycje": []})
            biezaca = grupy[-1]
            continue

        if biezaca is None:
            grupy.append({"kod": kod, "tytul": "Pozostałe", "sekcja": sekcja(kod), "pozycje": []})
            biezaca = grupy[-1]
        biezaca["pozycje"].append({
            "kod": kod,
            "nazwa": nazwa,
            "krotka": skroc(nazwa, biezaca["tytul"]),
            "jm": jm,
            "ref": {"min": mn, "max": mx, "sr": sr},
        })

    grupy = [g for g in grupy if g["pozycje"]]     # nagłówki bez pozycji nie są potrzebne
    ile = sum(len(g["pozycje"]) for g in grupy)

    tresc = (
        "/* Katalog pozycji do ankiety „Wezel Jakosci” - generowany z arkusza SEKOCENBUD.\n"
        "   NIE edytuj ręcznie: python skrypty/gen_wezel_katalog.py \"<plik.xlsx>\"\n"
        "   Źródło wskaźników (pole `ref`): katalog SEKOCENBUD, %s, opracowanie ZOPI.\n"
        "   Na stronie `ref` jest domyślnie ukryte, żeby nie sugerować odpowiedzi. */\n"
        "window.GIG_WEZEL_KATALOG = %s;\n"
        "window.GIG_WEZEL_ZRODLO = %s;\n"
    ) % (args.kwartal, json.dumps(grupy, ensure_ascii=False, indent=1), json.dumps(args.kwartal, ensure_ascii=False))

    io.open(os.path.normpath(WYJSCIE), "w", encoding="utf-8", newline="\n").write(tresc)
    print("grup: %d, pozycji: %d -> %s" % (len(grupy), ile, os.path.normpath(WYJSCIE)))


if __name__ == "__main__":
    main()
