/* Geodezyjna Izba Gospodarcza — dane wydarzeń (nadchodzące wydarzenia).
   Edytuj tę tablicę, aby dodać/usunąć wydarzenia. Przeszłe (date < dziś) znikają automatycznie.
   Pola:
     date      — data ISO "YYYY-MM-DD" (sortowalna; gdy znany tylko miesiąc, użyj 1. dnia miesiąca)
     dateLabel — ładny zapis daty po polsku, np. "30 czerwca 2026" lub "Wrzesień 2026"
     title     — tytuł wydarzenia
     place     — miejsce (może być "")
     teaser    — krótka zajawka (1–2 zdania); widoczna na stronie głównej i jako wstęp na podstronie
     agendaTitle — (opcjonalne) nagłówek listy tematów, np. "Tematy spotkania:"
     agenda    — (opcjonalne) tablica punktów programu; lista wyświetlana TYLKO na podstronie wydarzeń
     note      — (opcjonalne) dopisek pod listą, np. "Link zostanie wysłany mailem."
     link      — URL do szczegółów lub "" (brak)
*/
window.GIG_WYDARZENIA = [
  {
    date: "2026-06-30",
    dateLabel: "30 czerwca 2026",
    title: "Spotkanie online członków GIG",
    place: "Online",
    teaser: "Zapraszamy na przedwakacyjne spotkanie członków GIG. Termin: 30 czerwca, godz. 19:00.",
    agendaTitle: "Tematy spotkania:",
    agenda: [
      "Omówienie XXXIII Walnego Zebrania GIG",
      "Omówienie wniosków z XXXIII Walnego Zebrania GIG",
      "Prezentacja i funkcjonalność nowej strony GIG",
      "Omówienie pracy zespołu ds. samorządu",
      "Omówienie prac Państwowej Rady Geodezyjnej i Kartograficznej"
    ],
    note: "Link do spotkania zostanie wysłany drogą mailową.",
    link: ""
  },
  {
    date: "2026-10-08",
    dateLabel: "8 października 2026",
    title: "Szkolenie online: procedury geodezyjno-prawne określania granic gruntów",
    place: "Online, godz. 09:00–14:00",
    teaser: "Warsztaty dla geodetów i pracowników administracji geodezyjnej — od analizy materiałów źródłowych, przez ustalanie przebiegu granic działek, po dokumentację i sytuacje sporne. Część wykładowa i część warsztatowa oparta na pytaniach uczestników.",
    note: "Prowadzi dr hab. inż. Paweł Hanus, prof. AGH \u00b7 400 zł, dla członków GIG 250 zł",
    links: [
      { label: "Program i zapisy", url: "/szkolenia/" }
    ]
  },
  {
    date: "2026-10-22",
    dateLabel: "22 października 2026",
    title: "Szkolenie online dla gmin: modernizacja EGiB a dochody i bezpieczeństwo prawne",
    place: "Online",
    teaser: "Szkolenie dla wójtów, burmistrzów, skarbników oraz pracowników referatów podatkowych, gospodarki nieruchomościami i planowania przestrzennego. Modernizacja ewidencji gruntów i budynków jako inwestycja przynosząca gminie wpływy podatkowe, oszczędności i bezpieczeństwo decyzji.",
    note: "Prowadzi mgr inż. Marzena Danecka",
    links: [
      { label: "Program i zapisy", url: "/szkolenia/" }
    ]
  },
  {
    date: "2026-10-15",
    dateLabel: "15–16 października 2026",
    title: "29. Konferencja Naukowo-Techniczna SEKOCENBUD — pod patronatem GIG",
    place: "Ciechocinek, Hotel Austeria Conference & SPA",
    teaser: "Geodezyjna Izba Gospodarcza objęła patronatem 29. Konferencję Naukowo-Techniczną „Aktywne zarządzanie kosztami. Koszty pod kontrolą z perspektywy inwestora i wykonawcy”. Zapraszamy członków Izby do udziału.",
    agendaTitle: "W imieniu Izby wystąpi:",
    agenda: [
      "Dariusz Tomaszewski, Wiceprezes GIG — referat „Węzeł Jakości Geodezji: jak wiarygodność danych geodezyjnych ogranicza ryzyko i koszty realizacji inwestycji budowlanych”"
    ],
    note: "Organizator: SEKOCENBUD Sp. z o.o.",
    links: [
      { label: "Szczegóły patronatu", url: "/patronat-gig-29-konferencja-sekocenbud/" },
      { label: "Program i zapisy", url: "https://sekocenbud.pl/konferencja/" }
    ]
  },
  {
    date: "2027-06-01",
    dateLabel: "Czerwiec 2027",
    title: "Walne Zebranie Członków GIG",
    place: "Katowice",
    teaser: "Doroczne Walne Zebranie Członków Geodezyjnej Izby Gospodarczej odbędzie się w Katowicach. Dokładny termin podamy wkrótce.",
    link: ""
  }
];
