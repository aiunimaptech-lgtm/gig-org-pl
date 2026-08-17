/* =====================================================================
   GIG — publiczny render wpisów z panelu (tabela `articles`)

   Dokłada na listach (Aktualności / Artykuły / Biuletyn) karty wpisów
   dodanych w panelu /admin/. Karty NIE są budowane od zera: klonujemy
   pierwszą istniejącą kartę BeTheme na danej stronie i podmieniamy w niej
   treść. Dzięki temu wpis z panelu wygląda 1:1 jak wpis wpisany ręcznie,
   niezależnie od tego, którą wersję układu ma dana lista (col-, col-3…).

   Zasady:
   - tylko status `published`, sortowanie od najnowszych,
   - wpisy z panelu trafiają na GÓRĘ listy (najnowsze pierwsze),
   - jeśli na stronie istnieje już statyczna karta o tym samym adresie,
     wpis z bazy jest pomijany (brak duplikatów po ręcznym zbudowaniu strony),
   - awaria bazy = brak zmian: statyczne karty zostają nietknięte.
   ===================================================================== */
(function () {
  "use strict";

  var SUPABASE_URL  = "https://zlepwzeyjwpmhyxfnime.supabase.co";
  var SUPABASE_ANON = "sb_publishable_1KPF4mdln3C-cZHMIqAOFw_ZM8Go2Ji";

  /* Która lista jest otwarta → jaką kategorię pokazujemy */
  var ROUTES = [
    { re: /^\/aktualnosci\/?$/,                 cat: "aktualnosci" },
    { re: /^\/baza-wiedzy\/aktualnosci-gig\/?$/, cat: "aktualnosci" },
    { re: /^\/category\/aktualnosci\/?$/,        cat: "aktualnosci" },
    { re: /^\/artykuly\/?$/,                     cat: "artykuly" },
    { re: /^\/baza-wiedzy\/artykuly\/?$/,        cat: "artykuly" },
    { re: /^\/category\/artykuly\/?$/,           cat: "artykuly" },
    { re: /^\/biuletyn(-gig)?\/?$/,              cat: "biuletyn" }
  ];

  var path = location.pathname.replace(/\/+$/, "/") || "/";
  var route = null;
  for (var i = 0; i < ROUTES.length; i++) {
    if (ROUTES[i].re.test(path)) { route = ROUTES[i]; break; }
  }
  if (!route) return;

  var FALLBACK_IMG = "/wp-content/uploads/2026/04/gig-logo-new-poziom-dark.svg";
  var MIES = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca",
              "sierpnia","września","października","listopada","grudnia"];

  function dateHuman(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.getDate() + " " + MIES[d.getMonth()] + ", " + d.getFullYear();
  }

  /* Zajawka: własna, a gdy brak — z treści (bez znaczników HTML) */
  function excerptOf(rec) {
    if (rec.excerpt && rec.excerpt.trim()) return rec.excerpt.trim();
    var tmp = document.createElement("div");
    tmp.innerHTML = rec.content || "";
    var txt = (tmp.textContent || "").replace(/\s+/g, " ").trim();
    return txt.length > 190 ? txt.slice(0, 190) + "…" : txt;
  }

  function loadSdk() {
    return new Promise(function (res, rej) {
      if (window.supabase) return res();
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* Klon karty-wzorca z podmienioną treścią */
  function buildCard(tpl, rec) {
    var el = tpl.cloneNode(true);
    var href = "/wpis/" + rec.slug + "/";
    var when = dateHuman(rec.published_at || rec.created_at);
    var img  = rec.image_url || FALLBACK_IMG;

    el.setAttribute("data-gig-src", "db");
    el.removeAttribute("style");

    /* wszystkie odnośniki karty prowadzą do wpisu (poza podglądem zdjęcia) */
    Array.prototype.forEach.call(el.querySelectorAll("a"), function (a) {
      if (a.classList.contains("zoom")) { a.setAttribute("href", img); return; }
      a.setAttribute("href", href);
      a.removeAttribute("rel");
    });

    Array.prototype.forEach.call(el.querySelectorAll("img"), function (im) {
      im.setAttribute("src", img);
      im.setAttribute("alt", rec.title || "");
      im.removeAttribute("srcset");
      im.removeAttribute("sizes");
      im.setAttribute("loading", "lazy");
    });

    Array.prototype.forEach.call(
      el.querySelectorAll(".date_label, .post-date, .entry-date"),
      function (d) { d.textContent = when; }
    );

    var t = el.querySelector(".post-title a, .entry-title a, h3 a, h4 a");
    if (t) t.textContent = rec.title || "(bez tytułu)";

    var ex = el.querySelector(".post-excerpt");
    if (ex) {
      /* zachowujemy ewentualny przycisk „Czytaj dalej”, podmieniamy sam tekst */
      var more = ex.querySelector("a.button, .button_wrapper, a.more-link");
      ex.textContent = excerptOf(rec) + " ";
      if (more) ex.appendChild(more);
    }
    return el;
  }

  async function init() {
    var group = document.querySelector(".posts_group");
    if (!group) return;
    var tpl = group.querySelector(".post-item");
    if (!tpl) return; /* brak wzorca — nie ryzykujemy własnego markupu */

    /* adresy, które już są na stronie statycznie → pomijamy */
    var have = {};
    Array.prototype.forEach.call(group.querySelectorAll(".post-item a[href]"), function (a) {
      have[a.getAttribute("href").replace(/\/+$/, "/")] = true;
    });

    try {
      await loadSdk();
      var db  = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      var res = await db.from("articles")
        .select("title,slug,excerpt,content,category,published_at,created_at,image_url")
        .eq("status", "published")
        .eq("category", route.cat)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (res.error) throw res.error;

      var rows = (res.data || []).filter(function (r) {
        return r.slug && !have["/wpis/" + r.slug + "/"];
      });
      if (!rows.length) return;

      /* najnowszy ma trafić na samą górę → wstawiamy od najstarszego */
      rows.slice().reverse().forEach(function (r) {
        group.insertBefore(buildCard(tpl, r), group.firstChild);
      });

      /* BeTheme układa kafelki Isotope — po dołożeniu trzeba przeliczyć */
      if (window.jQuery && jQuery(".isotope_wrapper").length && jQuery.fn.isotope) {
        try { jQuery(".isotope_wrapper").isotope("reloadItems").isotope(); } catch (e) {}
      }
    } catch (e) {
      /* cicho: lista statyczna zostaje, użytkownik nic nie traci */
      console.warn("[GIG] Nie udało się dociągnąć wpisów z bazy:", e && e.message);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
