/* =====================================================================
   GIG — elementy site-wide:
   (1) pływający widget: Facebook + LinkedIn + zapis do newslettera,
   (2) rozwijane menu „O nas" → [Członkowie] (strzałka ▾ w dół, jak Baza wiedzy).
   Wstrzykiwane na każdej stronie.
   ===================================================================== */
(function () {
  "use strict";
  var SUPABASE_URL = window.GIG_CFG.SUPABASE_URL;
  var SUPABASE_ANON = window.GIG_CFG.SUPABASE_ANON;
  var FB = "https://www.facebook.com/gigorgpl";
  var LI = "https://www.linkedin.com/company/gig-geodezyjna-izba-gospodarcza";
  var RED = "#cc0a2b";

  /* ---------- CSS ---------- */
  var css =
    /* widget */
    "#gigw{position:fixed;right:18px;bottom:18px;z-index:9998;font-family:Inter,-apple-system,'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:10px;}" +
    "#gigw .gigw-panel{display:none;flex-direction:column;gap:8px;width:280px;}" +
    "#gigw.open .gigw-panel{display:flex;}" +
    "#gigw .gigw-tab{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e6ebef;border-radius:12px;padding:12px 14px;box-shadow:0 8px 26px rgba(20,40,60,.16);text-decoration:none;color:#16202a;transition:transform .15s;}" +
    "#gigw .gigw-tab:hover{transform:translateY(-2px);text-decoration:none;}" +
    "#gigw .gigw-ic{width:38px;height:38px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:15px;}" +
    "#gigw .gigw-fb .gigw-ic{background:#1877f2;}#gigw .gigw-li .gigw-ic{background:#0a66c2;}#gigw .gigw-nl .gigw-ic{background:" + RED + ";}" +
    "#gigw .gigw-tx b{display:block;font-size:14px;}#gigw .gigw-tx span{font-size:12px;color:#6b7884;}" +
    "#gigw .gigw-launch{display:flex;align-items:center;gap:8px;background:" + RED + ";color:#fff;border:0;border-radius:30px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 10px 30px rgba(204,10,43,.4);font-family:inherit;}" +
    "#gigw .gigw-launch:hover{filter:brightness(.95);}" +
    "#gigw .gigw-nlform{display:none;gap:8px;margin-top:8px;}#gigw .gigw-nl.exp .gigw-nlform{display:flex;flex-direction:column;}" +
    "#gigw .gigw-nlform input{padding:9px 11px;border:1px solid #d6dde3;border-radius:8px;font-size:13px;font-family:inherit;}" +
    "#gigw .gigw-nlform button{background:" + RED + ";color:#fff;border:0;border-radius:8px;padding:9px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}" +
    "#gigw .gigw-msg{font-size:12px;margin-top:4px;}" +
    "#gigw .gigw-nlwrap{background:#fff;border:1px solid #e6ebef;border-radius:12px;padding:12px 14px;box-shadow:0 8px 26px rgba(20,40,60,.16);}" +
    /* gwarancja: rozwiń podmenu O nas na hover (bez odstępu), niezależnie od JS motywu */
    "li[data-gig-dd]{position:relative;}" +
    "li[data-gig-dd]:hover > .mfn-submenu, li[data-gig-dd]:focus-within > .mfn-submenu{display:block !important;opacity:1 !important;visibility:visible !important;pointer-events:auto !important;}" +
    /* w rozwijanych podmenu bez poziomych strzałek (fa-arrow-right) — spójnie wszędzie */
    ".mfn-submenu .mfn-menu-sub-subicon{display:none !important;}" +
    /* rozwijane licują: flush tuż pod pozycją (ciągłość hovera);
       „Kontakt" (ostatnia, przy prawej krawędzi) otwiera się w lewo — prawą krawędzią
       pod pozycją, żeby nie wystawać w prawo poza pasek */
    "li[data-gig-dd] > .mfn-submenu{top:100% !important;margin-top:0 !important;}" +
    "li[data-gig-dd].gig-dd-right > .mfn-submenu{left:auto !important;right:0 !important;}" +
    /* sticky: nagłówek BeTheme (strona główna + podstrony mirror) — po scrollu staje się
       biały, przyklejony na górze; czerwone menu i kolorowe logo czytelne na białym.
       Bez animacji transform — żeby nagłówek nigdy nie mógł „utknąć" poza ekranem. */
    ".mfn-header-tmpl.mfn-header-main.gig-sticky{position:fixed !important;top:0 !important;left:0;right:0;width:100%;background:#fff !important;box-shadow:0 3px 16px rgba(20,40,60,.12);}" +
    /* logo BeTheme ma biały napis (zaprojektowane pod ciemne hero u góry). Po przyklejeniu
       pasek robi się biały — biały napis znika. Podmieniamy na wariant z ciemnym napisem
       (oba sekcje: desktop i mobilna). U góry nad hero pasek jest przezroczysty → białe zostaje. */
    ".mfn-header-tmpl.mfn-header-main.gig-sticky .logo-wrapper img{content:url(/wp-content/uploads/2026/04/gig-logo-new-poziom-dark.svg) !important;}" +
    /* płynne, eleganckie wjechanie przyklejonego paska z góry przy scrollu w dół.
       Stan spoczynkowy nie ma transformacji, więc pasek nigdy nie utknie poza ekranem;
       animacja tylko dla użytkowników bez preferencji ograniczenia ruchu. */
    "@media (prefers-reduced-motion: no-preference){.mfn-header-tmpl.mfn-header-main.gig-sticky{animation:gigHdrDown .42s cubic-bezier(.22,.61,.36,1);}}" +
    "@keyframes gigHdrDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}" +
    /* usuń zbędną ikonę hamburgera (czerwone kółko) z nagłówka DESKTOP — pełne menu i tak
       jest zawsze widoczne; mobilny hamburger w .mfn-header-mobile-section zostaje nietknięty */
    ".mfn-header-tmpl section:not(.mfn-header-mobile-section) a.mfn-header-menu-burger{display:none !important;}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- (1) WIDGET ---------- */
  function buildWidget() {
    var w = document.createElement("div"); w.id = "gigw";
    w.innerHTML =
      '<div class="gigw-panel">' +
        '<a class="gigw-tab gigw-fb" href="' + FB + '" target="_blank" rel="noopener"><span class="gigw-ic">f</span><span class="gigw-tx"><b>GIG na Facebooku</b><span>Zobacz aktualności</span></span></a>' +
        '<a class="gigw-tab gigw-li" href="' + LI + '" target="_blank" rel="noopener"><span class="gigw-ic">in</span><span class="gigw-tx"><b>GIG na LinkedIn</b><span>Zobacz profil Izby</span></span></a>' +
        '<div class="gigw-nlwrap"><div class="gigw-tab gigw-nl" style="border:0;box-shadow:none;padding:0;cursor:pointer" id="gigwNlTab"><span class="gigw-ic">✉</span><span class="gigw-tx"><b>Newsletter GIG</b><span>Kliknij i zapisz się</span></span></div>' +
          '<div class="gigw-nlform"><input type="email" id="gigwEmail" placeholder="Twój e-mail" aria-label="E-mail"><button id="gigwNlBtn">Zapisz się</button><div class="gigw-msg" id="gigwMsg"></div></div></div>' +
      '</div>' +
      '<button class="gigw-launch" id="gigwLaunch" aria-expanded="false">✦ Bądź na bieżąco</button>';
    document.body.appendChild(w);

    var launch = w.querySelector("#gigwLaunch");
    launch.addEventListener("click", function () {
      var open = w.classList.toggle("open");
      launch.setAttribute("aria-expanded", String(open));
      launch.innerHTML = open ? "✕ Zamknij" : "✦ Bądź na bieżąco";
    });
    var nlTab = w.querySelector("#gigwNlTab");
    nlTab.addEventListener("click", function () { nlTab.parentElement.classList.toggle("exp"); var e = w.querySelector("#gigwEmail"); if (e) e.focus(); });
    w.querySelector("#gigwNlBtn").addEventListener("click", subscribe);
    w.querySelector("#gigwEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") subscribe(); });
  }

  var dbP = null;
  function getDb() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (window.supabase) return res(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON));
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      s.onload = function () { res(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)); };
      s.onerror = rej; document.head.appendChild(s);
    });
    return dbP;
  }
  async function subscribe() {
    var email = (document.getElementById("gigwEmail").value || "").trim();
    var msg = document.getElementById("gigwMsg");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.style.color = "#c0392b"; msg.textContent = "Podaj poprawny e-mail."; return; }
    msg.style.color = "#6b7884"; msg.textContent = "Zapisywanie…";
    try {
      var db = await getDb();
      var res = await db.from("submissions_newsletter").insert({ email: email, status: "new" });
      if (res.error && res.error.code !== "23505") throw res.error;
      msg.style.color = "#1f6b3b"; msg.textContent = "✓ Dziękujemy! Zapisano.";
      document.getElementById("gigwEmail").value = "";
    } catch (e) { console.error(e); msg.style.color = "#c0392b"; msg.textContent = "Błąd — spróbuj ponownie."; }
  }

  /* ---------- (2) MENU „O nas" → dropdown ---------- */
  // pojedyncza pozycja podmenu w stylu motywu (mfn)
  function subLi(href, label) {
    return '<li class="menu-item menu-item-type-post_type menu-item-object-page mfn-menu-li">' +
      '<a class="mfn-menu-link" href="' + href + '">' +
      '<span class="menu-item-helper mfn-menu-item-helper"></span>' +
      '<span class="label-wrapper mfn-menu-label-wrapper"><span class="menu-label">' + label + '</span></span></a></li>';
  }
  // Zamień „O nas" w natywne menu rozwijane motywu (klasy mfn → strzałka + hover jak „Baza wiedzy")
  function enhanceMenu() {
    var links = document.querySelectorAll('a.mfn-menu-link[href$="/o-nas/"], a.mfn-menu-link[href$="/index.php/o-nas/"]');
    links.forEach(function (a) {
      var li = a.closest("li.mfn-menu-li, li.menu-item");
      if (!li || li.dataset.gigDd || li.classList.contains("menu-item-has-children")) return;
      li.dataset.gigDd = "1";
      li.classList.add("menu-item-has-children");
      var ul = document.createElement("ul");
      ul.className = "sub-menu mfn-submenu";
      ul.innerHTML = subLi("/czlonkowie/", "Członkowie");
      li.appendChild(ul);
    });
  }

  /* ---------- (2b) PRZEBUDOWA MENU (site-wide, idempotentna) ----------
     • „Aktualności" jako osobna pozycja top-level po prawej od „O nas”
       (rozwijane: Nadchodzące wydarzenia),
     • „Baza wiedzy” zostaje z Artykułami i Biuletynem (Aktualności/Nadchodzące przeniesione),
     • „Dołącz do nas” wchodzi do rozwijanego „Kontakt”.
     Wszystkie rozwijane mają strzałkę ▾ w dół (menu-sub mfn-menu-subicon). */
  // markup top-level kotwicy ze strzałką ▾ w dół (jak „Baza wiedzy”)
  function topAnchorHTML(href, label) {
    return '<a class="mfn-menu-link" href="' + href + '">' +
      '<span class="menu-item-helper mfn-menu-item-helper"></span>' +
      '<span class="label-wrapper mfn-menu-label-wrapper"><span class="menu-label">' + label + '</span></span>' +
      '<span class="menu-sub mfn-menu-subicon"><i class="fas fa-arrow-down"></i></span></a>';
  }
  function makeSubLi(href, label) { var d = document.createElement("div"); d.innerHTML = subLi(href, label); return d.firstChild; }
  function hrefEnds(a, suffix) {
    var h = (a.getAttribute("href") || "").replace(/[#?].*$/, "").replace(/\/+$/, "");
    return h.endsWith(suffix.replace(/\/+$/, ""));
  }
  function topByHref(ul, suffix) {
    return Array.prototype.slice.call(ul.children).filter(function (l) { return l.tagName === "LI"; })
      .find(function (l) { var a = l.querySelector(":scope > a"); return a && hrefEnds(a, suffix); });
  }
  function restructureMenu(ul) {
    if (!ul) return;
    var oNas = topByHref(ul, "/o-nas");
    var baza = topByHref(ul, "/baza-wiedzy");
    var kontakt = topByHref(ul, "/kontakt");

    // (A) „Aktualności” — osobna pozycja top-level po prawej od „O nas”
    if (oNas && !topByHref(ul, "/aktualnosci-gig")) {
      var aktLi = document.createElement("li");
      aktLi.className = "menu-item menu-item-type-post_type menu-item-object-page mfn-menu-li menu-item-has-children";
      aktLi.dataset.gigDd = "1";
      aktLi.innerHTML = topAnchorHTML("/baza-wiedzy/aktualnosci-gig/", "Aktualności");
      var aSub = document.createElement("ul"); aSub.className = "sub-menu mfn-submenu";
      aSub.appendChild(makeSubLi("/nadchodzace-wydarzenia/", "Nadchodzące wydarzenia"));
      aktLi.appendChild(aSub);
      oNas.insertAdjacentElement("afterend", aktLi);
    }
    // usuń z podmenu „Baza wiedzy” pozycje przeniesione do „Aktualności” (Aktualności + Nadchodzące);
    // „Artykuły” zostaje w „Baza wiedzy”
    if (baza) {
      baza.dataset.gigDd = "1"; // spójne otwieranie na hover naszą regułą (jak O nas)
      var bSub = baza.querySelector(":scope > ul");
      if (bSub) {
        Array.prototype.slice.call(bSub.children).forEach(function (l) {
          var a = l.querySelector(":scope > a"); if (!a) return;
          if (hrefEnds(a, "/aktualnosci-gig") || hrefEnds(a, "/nadchodzace-wydarzenia")) l.remove();
        });
        // kolejność w „Baza wiedzy": „Artykuły” przed „Biuletyn” (idempotentne)
        var liArt = topByHref(bSub, "/artykuly");
        var liBiul = topByHref(bSub, "/biuletyn-gig");
        if (liArt && liBiul && (liArt.compareDocumentPosition(liBiul) & Node.DOCUMENT_POSITION_PRECEDING)) {
          bSub.insertBefore(liArt, liBiul);
        }
      }
    }
    // (B) „Dołącz do nas” → rozwijane „Kontakt”
    var dolacz = topByHref(ul, "/dolacz-do-nas");
    if (kontakt && dolacz && dolacz.parentElement === ul) {
      if (!kontakt.querySelector(":scope > ul")) {
        // gig-dd-right: „Kontakt” to ostatnia pozycja przy prawej krawędzi —
        // jego rozwijane otwiera się w lewo (prawą krawędzią pod pozycją), żeby licowało
        kontakt.classList.add("menu-item-has-children", "gig-dd-right");
        kontakt.dataset.gigDd = "1";
        var kSub = document.createElement("ul"); kSub.className = "sub-menu mfn-submenu";
        kSub.appendChild(makeSubLi("/dolacz-do-nas/", "Dołącz do nas"));
        kontakt.appendChild(kSub);
      }
      dolacz.remove();
    }
  }
  function restructureAll() {
    var seen = [];
    document.querySelectorAll('ul.mfn-header-menu, ul[id^="menu-main-menu"]').forEach(function (ul) {
      if (seen.indexOf(ul) > -1) return; seen.push(ul);
      restructureMenu(ul);
    });
  }

  /* ---------- (3) STICKY HEADER ---------- */
  // Nagłówek szablonu BeTheme (strona główna i pozostałe podstrony mirror) jest
  // przezroczystym overlayem (position:absolute) i znika przy scrollu. Po przewinięciu
  // przyklejamy go na górze z białym tłem. Podstrony autorskie używają header.site-head
  // (są już sticky w gig-subhead.css) — tam tego elementu nie ma, więc to no-op.
  function stickyHeader() {
    var h = document.querySelector(".mfn-header-tmpl.mfn-header-main");
    if (!h) return;
    var on = false;
    function upd() {
      var should = window.scrollY > 130;
      if (should === on) return;
      on = should;
      h.classList.toggle("gig-sticky", should);
    }
    window.addEventListener("scroll", upd, { passive: true });
    upd();
  }

  function init() {
    buildWidget();
    enhanceMenu();
    restructureAll();
    stickyHeader();
    // BeTheme przebudowuje markup menu po DOMContentLoaded — enhanceMenu/restructureAll
    // są idempotentne, więc powtarzamy je po inicjalizacji motywu.
    var tries = 0;
    var iv = setInterval(function () {
      enhanceMenu();
      restructureAll();
      if (++tries >= 6) clearInterval(iv);
    }, 250);
    window.addEventListener("load", function () { enhanceMenu(); restructureAll(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
