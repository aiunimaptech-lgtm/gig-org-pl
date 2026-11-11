/* =====================================================================
   GIG: słownik sekcji „Zapytaj Izbę” (Geodezja pyta, Izba odpowiada).

   Jedno miejsce na listy używane przez strony /pytania/, /pytania/zadaj/,
   /pytania/<slug>/, /stanowiska/ i przez panel /admin/pytania.html:
     TEMATY       tematy pytań i odpowiedzi (pytania.temat, opinie.temat),
     ROLE         kim jest pytający (pytania.rola),
     RODZAJE      rodzaj tekstu publikowanego (opinie.rodzaj -> etykieta),
     WOJEWODZTWA  16 województw małymi literami, jak w formularzu „Dołącz do nas”.

   Wartości TEMATY i ROLE zapisują się w bazie jako tekst. Zmiana brzmienia
   istniejącej pozycji nie zmienia starszych wierszy: trzeba je wtedy poprawić
   UPDATE-em, inaczej filtr po temacie ich nie znajdzie. Nową pozycję można
   dopisać bez zmian w bazie i w Edge Function `pytanie-zglos`.
   Klucze RODZAJE są ograniczone w bazie (CHECK na opinie.rodzaj), więc nowy
   rodzaj wymaga też zmiany w backend/supabase_pytania.sql.
   ===================================================================== */
window.GIG_PYTANIA = {
  TEMATY: [
    'Granice i wznowienia',
    'Podziały nieruchomości',
    'Weryfikacja i ośrodki dokumentacji',
    'Zgłoszenia prac i operat',
    'Narady koordynacyjne, GESUT, mapy',
    'EGiB, użytki, budynki',
    'Uprawnienia i wykonawca prac',
    'Nowelizacja Prawa geodezyjnego (UD60)',
    'Zamówienia publiczne i rynek',
    'Technologie i pomiary',
    'Inne'
  ],
  ROLE: [
    'geodeta wykonawca',
    'pracownik administracji',
    'inwestor lub właściciel nieruchomości',
    'inne'
  ],
  RODZAJE: {
    odpowiedz: 'Odpowiedź',
    opracowanie: 'Opracowanie',
    stanowisko: 'Stanowisko Izby'
  },
  WOJEWODZTWA: [
    'dolnośląskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie',
    'łódzkie', 'małopolskie', 'mazowieckie', 'opolskie',
    'podkarpackie', 'podlaskie', 'pomorskie', 'śląskie',
    'świętokrzyskie', 'warmińsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie'
  ]
};
