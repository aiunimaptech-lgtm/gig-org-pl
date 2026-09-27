/* =====================================================================
   GIG — najnowsze wpisy z dwóch źródeł, posortowane od najnowszego.
   1) wpisy dodane w panelu (Supabase, tabela articles, wg kategorii),
   2) dawne wpisy z kopii WordPressa (statyczne listy /aktualnosci/, /artykuly/).
   Używa strona główna (2 aktualności) i Baza wiedzy (po 3 aktualności i artykuły),
   więc każdy nowy wpis z panelu sam trafia na obie strony, najnowszy pierwszy.
   Błąd jednego źródła nie psuje sekcji: zostaje to, co udało się pobrać.
   Wymaga wcześniej wpiętego gig-config.js (window.GIG_CFG).
   ===================================================================== */
(function () {
  "use strict";
  var MIES = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia",
    "września", "października", "listopada", "grudnia"];
  var FALLBACK_IMG = "/wp-content/uploads/2026/04/gig-logo-new-poziom-dark.svg";

  function dataZTekstu(t) { // "7 sierpnia, 2026" -> Date
    var m = String(t || "").toLowerCase().match(/(\d{1,2})\s+([a-ząćęłńóśźż]+),?\s+(\d{4})/);
    if (!m) return new Date(0);
    var i = MIES.indexOf(m[2]);
    return i < 0 ? new Date(0) : new Date(+m[3], i, +m[1]);
  }
  function dataNaTekst(d) { return d.getDate() + " " + MIES[d.getMonth()] + ", " + d.getFullYear(); }
  function skroc(t, n) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t;
  }

  function zPanelu(kategoria) {
    return new Promise(function (res) {
      var cfg = window.GIG_CFG;
      if (!cfg || !window.fetch) return res([]);
      fetch(cfg.SUPABASE_URL + "/rest/v1/articles?select=title,slug,excerpt,published_at,created_at,image_url" +
        "&status=eq.published&category=eq." + encodeURIComponent(kategoria) + "&order=published_at.desc.nullslast&limit=6",
        { headers: { apikey: cfg.SUPABASE_ANON, Authorization: "Bearer " + cfg.SUPABASE_ANON } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          res((rows || []).filter(function (r) { return r.slug; }).map(function (r) {
            var d = new Date(r.published_at || r.created_at);
            return { kiedy: d, date: dataNaTekst(d), title: r.title, href: "/wpis/" + r.slug + "/",
              img: r.image_url || FALLBACK_IMG, excerpt: skroc(r.excerpt, 240) };
          }));
        })
        .catch(function () { res([]); });
    });
  }

  function zeStatycznej(url) {
    return fetch(url).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      return [].slice.call(doc.querySelectorAll(".posts_group article.post-item"))
        .filter(function (a) { return !a.hasAttribute("data-gig-src"); })
        .map(function (a) {
          var t = a.querySelector(".post-title a") || a.querySelector(".entry-title a");
          var im = a.querySelector(".image_frame img");
          var dt = ((a.querySelector(".date_label") || {}).textContent || "").trim();
          return { kiedy: dataZTekstu(dt), date: dt, title: t ? t.textContent.trim() : "",
            href: t ? t.getAttribute("href") : "#", img: im ? im.getAttribute("src") : "",
            excerpt: ((a.querySelector(".post-excerpt") || {}).textContent || "").trim() };
        });
    }).catch(function () { return []; });
  }

  /* kategoria: 'aktualnosci' | 'artykuly'; zwraca Promise z listą max pozycji */
  window.gigNajnowsze = function (kategoria, statycznaUrl, max) {
    return Promise.all([zPanelu(kategoria), zeStatycznej(statycznaUrl)]).then(function (w) {
      var widziane = {};
      var wszystkie = w[0].concat(w[1]).filter(function (d) {
        if (!d.title || widziane[d.href]) return false;
        widziane[d.href] = 1; return true;
      });
      wszystkie.sort(function (a, b) { return b.kiedy - a.kiedy; });
      return wszystkie.slice(0, max);
    });
  };
})();
