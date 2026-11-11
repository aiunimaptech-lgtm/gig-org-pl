/* =====================================================================
   GIG: wspólny kod sekcji „Zapytaj Izbę” (Geodezja pyta, Izba odpowiada).

   Używają go strony /pytania/ (lista) i /pytania/<slug>/ (jedna odpowiedź).
   Funkcje karta() i strona() składają HTML z wiersza tabeli `opinie` i nie
   dotykają DOM-u, więc ten sam plik może wczytać skrypty/prerender.mjs
   (module.exports na końcu), żeby HTML z prerendera był identyczny z tym,
   który rysuje przeglądarka.

   Każdy tekst z bazy przechodzi przez esc(). Wyjątek: opinie.tresc_html
   (odpowiedź pisana przez biuro w edytorze panelu, jak articles.content).
   ===================================================================== */
(function (root) {
  "use strict";

  var SITE = "https://gig.org.pl";
  var RODZAJE = (root.GIG_PYTANIA && root.GIG_PYTANIA.RODZAJE) ||
    { odpowiedz: "Odpowiedź", opracowanie: "Opracowanie", stanowisko: "Stanowisko Izby" };
  var ZESPOL = "Zespół Ekspercki GIG";
  var NOTA_OPINIA = "Opinia autora, nie jest wiążącą interpretacją prawa.";
  var NOTA_STANOWISKO = "Stanowisko Geodezyjnej Izby Gospodarczej.";
  var PAS_CZLONKOWIE = "Członkowie GIG mają pierwszeństwo i zawsze dostają odpowiedź indywidualną.";
  var MIES = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca",
              "sierpnia", "września", "października", "listopada", "grudnia"];
  /* kolumny potrzebne liście (bez tresc_html) */
  var KOLUMNY_LISTY = "slug,rodzaj,tytul,pytanie_publiczne,pytajacy,zrodlo,wydarzenie,temat," +
    "w_skrocie,podstawa_prawna,autor,autor_gosc,opublikowano_at";

  function esc(s) {
    return (s == null ? "" : String(s))
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function czysty(s) { return (s == null ? "" : String(s)).replace(/\s+/g, " ").trim(); }
  function skroc(s, n) {
    var t = czysty(s);
    if (t.length <= n) return t;
    t = t.slice(0, n);
    var i = t.lastIndexOf(" ");
    return (i > n * 0.6 ? t.slice(0, i) : t).replace(/[\s,;:.]+$/, "") + "…";
  }
  /* Data publikacji zawsze wg czasu polskiego, żeby prerender (serwer w UTC)
     i przeglądarka pokazywały ten sam dzień. */
  function dataDluga(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      var cz = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      return dataDnia(cz);
    } catch (e) {
      return d.getDate() + " " + MIES[d.getMonth()] + " " + d.getFullYear();
    }
  }
  /* 'RRRR-MM-DD' (kolumna typu date) → '1 listopada 2026', bez przeliczania stref */
  function dataDnia(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s == null ? "" : String(s));
    if (!m) return "";
    return Number(m[3]) + " " + MIES[Number(m[2]) - 1] + " " + m[1];
  }
  function rodzajKlucz(o) { return RODZAJE[o && o.rodzaj] ? o.rodzaj : "odpowiedz"; }
  function etykieta(o) { return RODZAJE[rodzajKlucz(o)]; }
  function autor(o) { return czysty(o && o.autor) || ZESPOL; }
  function adres(o) { return "/pytania/" + encodeURIComponent(o.slug) + "/"; }
  function opis(o) { return skroc(o.w_skrocie || o.pytanie_publiczne || o.tytul, 300); }
  function nota(o) { return rodzajKlucz(o) === "stanowisko" ? NOTA_STANOWISKO : NOTA_OPINIA; }
  /* tekst do szukania na liście: tytuł, pytanie, skrót, podstawa prawna, autor, temat */
  function szukajTekst(o) {
    return czysty([o.tytul, o.pytanie_publiczne, o.w_skrocie, o.podstawa_prawna, autor(o), o.temat].join(" ")).toLowerCase();
  }
  /* zwykły tekst z bazy → akapity <p>, pojedynczy Enter → <br> */
  function akapity(t) {
    return String(t == null ? "" : t).replace(/\r/g, "").split(/\n\s*\n/).map(function (a) { return a.trim(); })
      .filter(Boolean).map(function (a) { return "<p>" + esc(a).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function linie(t) {
    return String(t == null ? "" : t).replace(/\r/g, "").split("\n").map(czysty).filter(Boolean);
  }

  /* ---------- karta na liście /pytania/ ---------- */
  function karta(o) {
    var r = rodzajKlucz(o), kiedy = dataDluga(o.opublikowano_at);
    return '<a class="pyt-card pyt-' + r + '" href="' + adres(o) + '"' +
        ' data-rodzaj="' + r + '" data-temat="' + esc(czysty(o.temat)) + '"' +
        ' data-wydarzenie="' + esc(czysty(o.wydarzenie)) + '" data-szukaj="' + esc(szukajTekst(o)) + '">' +
      '<div class="pyt-top"><span class="pyt-badge pyt-b-' + r + '">' + esc(etykieta(o)) + '</span>' +
        (czysty(o.temat) ? '<span class="pyt-temat">' + esc(czysty(o.temat)) + '</span>' : '') + '</div>' +
      '<h3>' + esc(o.tytul) + '</h3>' +
      (czysty(o.w_skrocie) ? '<p class="pyt-skrot">' + esc(skroc(o.w_skrocie, 220)) + '</p>' : '') +
      '<div class="pyt-meta">' +
        '<span class="pyt-autor">' + esc(autor(o)) + (o.autor_gosc ? ' <em>autor gościnny</em>' : '') + '</span>' +
        (czysty(o.zrodlo) ? '<span class="pyt-zrodlo">' + esc(czysty(o.zrodlo)) + '</span>' : '') +
        (kiedy ? '<span class="pyt-data">' + kiedy + '</span>' : '') +
      '</div>' +
    '</a>';
  }

  /* ---------- treść strony /pytania/<slug>/ (wnętrze <main>) ---------- */
  function strona(o) {
    var r = rodzajKlucz(o), kiedy = dataDluga(o.opublikowano_at), stan = dataDnia(o.stan_prawny_na);
    var temat = czysty(o.temat), pytajacy = czysty(o.pytajacy), zrodlo = czysty(o.zrodlo);
    var podstawa = linie(o.podstawa_prawna);
    var naglowekTresci = r === "odpowiedz" ? "Odpowiedź" : (r === "opracowanie" ? "Opracowanie" : "Stanowisko");
    var byline = [];
    if (pytajacy) byline.push('<span>Pyta: <b>' + esc(pytajacy) + '</b></span>');
    if (zrodlo) byline.push('<span>' + esc(zrodlo) + '</span>');
    if (kiedy) byline.push('<span>Opublikowano ' + kiedy + '</span>');
    if (stan) byline.push('<span>stan prawny na ' + stan + '</span>');
    return '<section class="a-hero"><div class="narrow">' +
        '<div class="a-crumbs"><a href="/baza-wiedzy/">Baza wiedzy</a> › <a href="/pytania/">Zapytaj Izbę</a>' +
          (temat ? ' › ' + esc(temat) : '') + '</div>' +
        '<span class="a-kicker pyt-k-' + r + '">' + esc(etykieta(o)) + '</span>' +
        '<h1 class="a-title">' + esc(o.tytul) + '</h1>' +
        (byline.length ? '<div class="a-byline">' + byline.join('<span class="dot"></span>') + '</div>' : '') +
      '</div></section>' +
      '<article class="post"><div class="narrow">' +
        (czysty(o.w_skrocie) ? '<div class="pyt-skrot-box"><strong>W skrócie</strong>' + akapity(o.w_skrocie) + '</div>' : '') +
        (czysty(o.pytanie_publiczne) ? '<section class="pyt-sekcja pyt-pytanie"><h2>Pytanie</h2>' + akapity(o.pytanie_publiczne) + '</section>' : '') +
        '<section class="pyt-sekcja pyt-odp"><h2>' + naglowekTresci + '</h2><div id="gigTresc">' + (o.tresc_html || '') + '</div></section>' +
        (podstawa.length ? '<section class="pyt-sekcja pyt-podstawa"><h2>Podstawa prawna</h2><ul>' +
          podstawa.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></section>' : '') +
        '<div class="pyt-autor-box"><span class="pyt-autor-et">Autor</span><b>' + esc(autor(o)) + '</b>' +
          (o.autor_gosc ? '<span class="pyt-gosc">autor gościnny</span>' : '') + '</div>' +
        '<div class="a-note">' + nota(o) + '</div>' +
        '<div class="pyt-cta"><a class="btn" href="/pytania/zadaj/">Masz podobny problem? Zadaj pytanie</a></div>' +
        '<div class="pyt-pas">' + PAS_CZLONKOWIE + ' <a href="/dolacz-do-nas/">Dołącz do Izby</a></div>' +
        '<a class="a-back" href="/pytania/">← Wróć do: Zapytaj Izbę</a>' +
      '</div></article>';
  }

  /* ---------- odczyt przez REST (klucz anon z window.GIG_CFG) ---------- */
  function pobierz(zapytanie) {
    var cfg = root.GIG_CFG || {};
    return fetch(cfg.SUPABASE_URL + "/rest/v1/opinie?" + zapytanie, {
      headers: { apikey: cfg.SUPABASE_ANON, Authorization: "Bearer " + cfg.SUPABASE_ANON, Accept: "application/json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("opinie: HTTP " + r.status);
      return r.json();
    });
  }
  function pobierzListe() {
    return pobierz("select=" + KOLUMNY_LISTY + "&status=eq.opublikowana&order=opublikowano_at.desc.nullslast&limit=500");
  }
  function pobierzJedna(slug) {
    return pobierz("select=*&status=eq.opublikowana&slug=eq." + encodeURIComponent(slug) + "&limit=1")
      .then(function (d) { return (d && d[0]) || null; });
  }

  var API = {
    SITE: SITE, ZESPOL: ZESPOL, RODZAJE: RODZAJE, KOLUMNY_LISTY: KOLUMNY_LISTY,
    NOTA_OPINIA: NOTA_OPINIA, NOTA_STANOWISKO: NOTA_STANOWISKO, PAS_CZLONKOWIE: PAS_CZLONKOWIE,
    esc: esc, czysty: czysty, skroc: skroc, dataDluga: dataDluga, dataDnia: dataDnia,
    etykieta: etykieta, autor: autor, adres: adres, opis: opis, nota: nota, szukajTekst: szukajTekst,
    akapity: akapity, linie: linie, karta: karta, strona: strona,
    pobierz: pobierz, pobierzListe: pobierzListe, pobierzJedna: pobierzJedna
  };
  root.GIG_PYT = API;
  if (typeof module === "object" && module && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
