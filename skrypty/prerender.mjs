// =====================================================================
// GIG — prerender: treści z bazy zapisane jako zwykły HTML w plikach strony.
//
// Po co: kalendarz szkoleń, katalog Członków i wpisy z panelu budują się
// skryptem w przeglądarce. Google zwykle to wykona, ale roboty agentów AI
// (ChatGPT, Claude, Perplexity) w większości nie uruchamiają JavaScriptu,
// więc widziały puste strony. Generator wpisuje tę samą treść do HTML-a;
// skrypty w przeglądarce dalej ją odświeżają, jak dotąd.
//
// Co zapisuje (tylko między znacznikami <!--PRERENDER:nazwa--> … <!--/PRERENDER:nazwa-->):
//   strona/szkolenia/index.html      karty szkoleń + JSON-LD Event
//   strona/czlonkowie/index.html     lista firm wg województw + liczba
//   strona/index.html                2 najnowsze aktualności (zapas przed skryptem)
//   strona/baza-wiedzy/index.html    po 3 najnowsze aktualności i artykuły
//   strona/wpis/<slug>/index.html    pełna strona każdego wpisu z panelu (+ JSON-LD Article)
//   strona/sitemap.xml, strona/llms.txt
//
// Bezpieczeństwo: wszystko albo nic. Gdy którekolwiek zapytanie do bazy się nie
// uda albo dane wyglądają podejrzanie (np. prawie pusty katalog), generator
// NICZEGO nie zmienia i kończy się kodem 0, więc strona zostaje taka jak była.
//
// Uruchamianie: node skrypty/prerender.mjs   (Node 18+, bez zależności)
// Automatycznie: GitHub Actions .github/workflows/prerender.yml, co godzinę.
// =====================================================================
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "strona");
const SITE = "https://gig.org.pl";
const MIES = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia",
  "września", "października", "listopada", "grudnia"];
const FALLBACK_IMG = "/wp-content/uploads/2026/04/gig-logo-new-poziom-dark.svg";

const esc = (s) => (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bezTagow = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const skroc = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t; };
const dzien = (d) => `${d.getDate()} ${MIES[d.getMonth()]} ${d.getFullYear()}`;
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const val = (v) => { v = (v == null ? "" : String(v)).trim(); return v && v.toLowerCase() !== "brak" ? v : ""; };

async function czytaj(rel) { return fs.readFile(path.join(ROOT, rel), "utf8"); }
const zmienione = [];
async function zapisz(rel, tresc) {
  const p = path.join(ROOT, rel);
  let stara = null;
  try { stara = await fs.readFile(p, "utf8"); } catch { /* nowy plik */ }
  if (stara === tresc) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, tresc, "utf8");
  zmienione.push(rel);
}

/* Blok między znacznikami. Przy pierwszym uruchomieniu `wstaw(html, blok)` mówi, gdzie go
   osadzić; potem zawsze podmieniamy tylko to, co między znacznikami. */
function blok(html, nazwa, tresc, wstaw) {
  const a = `<!--PRERENDER:${nazwa}-->`, b = `<!--/PRERENDER:${nazwa}-->`;
  const calosc = a + tresc + b;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i >= 0 && j > i) return html.slice(0, i) + calosc + html.slice(j + b.length);
  const nowy = wstaw(html, calosc);
  if (nowy === html) throw new Error(`nie znalazłem miejsca na blok ${nazwa}`);
  return nowy;
}
const przedHead = (html, c) => html.replace("</head>", c + "\n</head>");

/* ---------- dane ---------- */
function konfiguracja(txt) {
  const url = (txt.match(/SUPABASE_URL\s*:\s*["']([^"']+)["']/) || [])[1];
  const anon = (txt.match(/SUPABASE_ANON\s*:\s*["']([^"']+)["']/) || [])[1];
  if (!url || !anon) throw new Error("brak SUPABASE_URL/SUPABASE_ANON w gig-config.js");
  return { url, anon };
}
async function pobierz(cfg, tabela, zapytanie) {
  const r = await fetch(`${cfg.url}/rest/v1/${tabela}?${zapytanie}`, {
    headers: { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}` }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status}`);
  return r.json();
}

/* Dawne wpisy z kopii WordPressa (statyczne listy): data, tytuł, adres, obrazek, zajawka. */
function wpisyStatyczne(html) {
  const out = [];
  for (const m of html.matchAll(/<article[^>]*post-item[\s\S]*?<\/article>/g)) {
    const a = m[0];
    if (/data-gig-src=/.test(a)) continue;
    const t = a.match(/<h[45][^>]*entry-title[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const dt = (a.match(/<div class="date_label">([^<]+)<\/div>/) || [])[1] || "";
    const im = (a.match(/<div class="image_frame[\s\S]*?<img[^>]*src="([^"]+)"/) || [])[1] || "";
    const ex = (a.match(/<div class="post-excerpt">([\s\S]*?)<\/div>/) || [])[1] || "";
    if (!t) continue;
    const m2 = dt.toLowerCase().match(/(\d{1,2})\s+([a-ząćęłńóśźż]+),?\s+(\d{4})/);
    const i = m2 ? MIES.indexOf(m2[2]) : -1;
    out.push({ kiedy: i < 0 ? new Date(0) : new Date(+m2[3], i, +m2[1]), date: dt.trim(), title: bezTagow(t[2]),
      href: t[1], img: im, excerpt: bezTagow(ex) });
  }
  return out;
}
function najnowsze(zPanelu, statyczne, max) {
  const widziane = new Set();
  return zPanelu.concat(statyczne).filter((d) => d.title && !widziane.has(d.href) && widziane.add(d.href))
    .sort((a, b) => b.kiedy - a.kiedy).slice(0, max);
}

/* ---------- szkolenia ---------- */
function kartaSzkolenia(r) {
  const d = r.date_start ? new Date(r.date_start + "T00:00:00") : null;
  const MS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
  const badge = r.date_label ? `<div class="gig-szk-date opisowy"><span class="t">${esc(r.date_label)}</span></div>`
    : d ? `<div class="gig-szk-date"><span class="d">${d.getDate()}</span><span class="m">${MS[d.getMonth()]} ${d.getFullYear()}</span></div>`
      : `<div class="gig-szk-date opisowy"><span class="t">termin<br>wkrótce</span></div>`;
  const kiedy = r.date_label || (d ? dzien(d) : "");
  const meta = [kiedy, r.is_online ? "Online" : (r.location || "")].filter(Boolean).join(" · ");
  const akapity = String(r.description || "").split(/\n\s*\n/).map((a) => {
    let t = esc(a.trim()).replace(/\n/g, "<br>").replace(/[*][*]([^*]+)[*][*]/g, "<strong>$1</strong>");
    return t ? `<p class="gig-szk-desc">${t}</p>` : "";
  }).join("");
  const lista = (tytul, txt) => {
    const p = String(txt || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
    return p.length ? `<div class="gig-szk-prog-t">${tytul}</div><ul class="gig-szk-prog">${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  };
  const ceny = (r.price || r.price_member) ? `<div class="gig-szk-ceny">${r.price ? `<span class="gig-szk-cena">Cena: <b>${esc(r.price)}</b></span>` : ""}${r.price_member ? `<span class="gig-szk-cena czlonek">Dla członków GIG: <b>${esc(r.price_member)}</b></span>` : ""}</div>` : "";
  const wyk = r.lecturer ? `<div class="gig-szk-wyk"><div class="kto">${esc(r.lecturer)}</div>${r.lecturer_bio ? `<div class="bio">${esc(r.lecturer_bio)}</div>` : ""}</div>` : "";
  const zgl = val(r.zgloszenia_do) ? `<p class="gig-szk-zgldo">${esc(r.zgloszenia_do.trim())}</p>` : "";
  const link = "/zapisy/?szkolenie=" + encodeURIComponent(r.title);
  return `<article class="gig-szk-card">${badge}<div class="gig-szk-body"><h3>${esc(r.title)}</h3>` +
    (meta ? `<p class="gig-szk-meta">${esc(meta)}</p>` : "") +
    (r.time_range ? `<p class="gig-szk-time">Godziny: <b>${esc(r.time_range)}</b></p>` : "") +
    akapity + lista("Program", r.agenda) + lista("Informacje organizacyjne", r.informacje) + ceny + wyk + zgl +
    `<p><a class="gig-szk-btn" href="${esc(link)}">Zapisz się →</a></p></div></article>`;
}
function eventLd(r) {
  if (!r.date_start) return null;
  const [od, doo] = String(r.time_range || "").split(/[-–]/).map((x) => (x || "").trim());
  /* czas letni w Polsce: od ostatniej niedzieli marca do ostatniej niedzieli października */
  const strefa = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    const ostNiedz = (mies) => { const t = new Date(Date.UTC(y, mies, 0)); return t.getUTCDate() - t.getUTCDay(); };
    const letni = (m > 3 && m < 10) || (m === 3 && d >= ostNiedz(3)) || (m === 10 && d < ostNiedz(10));
    return letni ? "+02:00" : "+01:00";
  };
  const godz = (h, iso) => /^\d{1,2}:\d{2}$/.test(h) ? "T" + h.padStart(5, "0") + ":00" + strefa(iso) : "";
  const cena = (t) => { t = String(t || "").toLowerCase(); if (/bezp[łl]at/.test(t)) return 0; const n = t.replace(/\s/g, "").match(/\d+/); return n ? +n[0] : null; };
  const c = cena(r.price);
  return {
    "@type": "EducationEvent", name: r.title, url: SITE + "/szkolenia/",
    startDate: r.date_start + godz(od, r.date_start),
    ...(doo ? { endDate: (r.date_end || r.date_start) + godz(doo, r.date_end || r.date_start) } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: r.is_online ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    location: r.is_online ? { "@type": "VirtualLocation", url: SITE + "/szkolenia/" } : { "@type": "Place", name: r.location || "", address: r.location || "" },
    description: skroc(bezTagow(String(r.description || "").replace(/[*][*]/g, "")), 480),
    organizer: { "@type": "Organization", name: "Geodezyjna Izba Gospodarcza", url: SITE },
    ...(r.lecturer ? { performer: { "@type": "Person", name: r.lecturer } } : {}),
    ...(c != null ? { offers: { "@type": "Offer", price: c, priceCurrency: "PLN", url: SITE + "/zapisy/?szkolenie=" + encodeURIComponent(r.title), availability: "https://schema.org/InStock" } } : {}),
    inLanguage: "pl",
  };
}

/* ---------- wpisy z panelu ---------- */
const KAT = {
  aktualnosci: { etykieta: "Aktualność", lista: "/baza-wiedzy/aktualnosci-gig/", nazwa: "Aktualności" },
  artykuly: { etykieta: "Artykuł", lista: "/baza-wiedzy/artykuly/", nazwa: "Artykuły" },
  biuletyn: { etykieta: "Biuletyn", lista: "/biuletyn-gig/", nazwa: "Biuletyn" },
};
function stronaWpisu(szablon, a) {
  const k = KAT[a.category] || KAT.aktualnosci;
  const url = `${SITE}/wpis/${a.slug}/`;
  const d = new Date(a.published_at || a.created_at);
  const opis = skroc(a.excerpt || bezTagow(a.content), 300);
  const slow = bezTagow(a.content).split(/\s+/).filter(Boolean).length;
  const figura = a.image_url ? `<figure class="a-figure"><img src="${esc(a.image_url)}" alt="${esc(a.title)}"></figure>` : "";
  const tresc =
    `<section class="a-hero"><div class="narrow">` +
    `<div class="a-crumbs"><a href="/">Strona główna</a> › <a href="${k.lista}">${k.nazwa}</a> › ${esc(a.title)}</div>` +
    `<span class="a-kicker">${k.etykieta}</span><h1 class="a-title">${esc(a.title)}</h1>` +
    `<div class="a-byline">${a.author ? `<span>Autor: <b>${esc(a.author)}</b></span>` : "<span>Geodezyjna Izba Gospodarcza</span>"}` +
    `<span class="dot"></span><span>${dzien(d)}</span><span class="dot"></span><span>czas czytania: ~${Math.max(1, Math.round(slow / 200))} min</span></div>` +
    `</div></section>${figura}<article class="post"><div class="narrow"><div id="gigTresc">${a.content || ""}</div>` +
    `<a class="a-back" href="${k.lista}">← Wróć do: ${k.nazwa}</a></div></article>`;
  const ld = {
    "@context": "https://schema.org", "@type": a.category === "artykuly" ? "Article" : "NewsArticle",
    headline: skroc(a.title, 110), description: opis, url, mainEntityOfPage: url, inLanguage: "pl",
    datePublished: d.toISOString(), dateModified: new Date(a.updated_at || a.published_at || a.created_at).toISOString(),
    ...(a.image_url ? { image: [a.image_url] } : {}),
    author: a.author ? { "@type": "Person", name: a.author.split(",")[0].trim(), description: a.author } : { "@type": "Organization", name: "Geodezyjna Izba Gospodarcza" },
    publisher: { "@type": "Organization", name: "Geodezyjna Izba Gospodarcza", url: SITE, logo: { "@type": "ImageObject", url: SITE + "/_assets/img/gig-logo-email.png" } },
  };
  let h = szablon
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(a.title)} | Geodezyjna Izba Gospodarcza</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(opis)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:type" content="article">/,
      `<meta property="og:type" content="article">\n  <meta property="og:title" content="${esc(a.title)}">\n  <meta property="og:description" content="${esc(opis)}">\n  <meta property="og:url" content="${url}">` +
      (a.image_url ? `\n  <meta property="og:image" content="${esc(a.image_url)}">\n  <meta name="twitter:card" content="summary_large_image">` : "") +
      `\n  <meta name="gig-prerender" content="wpis">`)
    .replace('<div class="a-state" id="gigLoading">Ładowanie wpisu…</div>', `<div data-prerender="wpis">${tresc}</div>`);
  h = przedHead(h, "  " + jsonLd(ld));
  if (!h.includes('data-prerender="wpis"') || !h.includes("gig-prerender")) throw new Error("szablon /wpis/ ma inną budowę niż oczekiwana");
  return h;
}

/* ---------- główny przebieg ---------- */
async function main() {
  const cfg = konfiguracja(await czytaj("_assets/js/gig-config.js"));
  let szk, czl, art;
  try {
    [szk, czl, art] = await Promise.all([
      pobierz(cfg, "szkolenia", "select=*&status=eq.published&order=date_start.asc"),
      pobierz(cfg, "czlonkowie", "select=name,region,person,address,website,description&status=eq.published&order=region.asc,name.asc"),
      pobierz(cfg, "articles", "select=title,slug,excerpt,content,category,published_at,created_at,updated_at,image_url,author&status=eq.published&order=published_at.desc.nullslast"),
    ]);
  } catch (e) {
    console.log("Baza niedostępna, niczego nie zmieniam:", e.message);
    return;
  }
  if (!Array.isArray(czl) || czl.length < 20 || !Array.isArray(szk) || !Array.isArray(art)) {
    console.log(`Podejrzane dane (członków: ${czl?.length}, szkoleń: ${szk?.length}, wpisów: ${art?.length}), niczego nie zmieniam.`);
    return;
  }

  // Wszystkie strony budujemy w pamięci; zapis dopiero, gdy każda się udała.
  const doZapisu = [];
  const dzis = new Date(); dzis.setHours(0, 0, 0, 0);

  // 1) Szkolenia
  const nadchodzace = szk.filter((r) => { const ref = r.date_end || r.date_start; return !ref || new Date(ref + "T00:00:00") >= dzis; });
  const minione = szk.filter((r) => !nadchodzace.includes(r)).reverse();
  let hs = await czytaj("szkolenia/index.html");
  const sekcja = `<section class="gig-szk" data-prerender="szkolenia"><h2>Kalendarz szkoleń</h2>` +
    `<p class="lead">Najbliższe szkolenia organizowane przez Geodezyjną Izbę Gospodarczą.</p>` +
    `<div class="gig-szk-grid">${nadchodzace.map(kartaSzkolenia).join("") || '<div class="gig-szk-empty">Obecnie nie ma zaplanowanych szkoleń.</div>'}</div>` +
    (minione.length ? `<details class="gig-szk-arch"><summary>Szkolenia, które już się odbyły (${minione.length})</summary><div class="gig-szk-grid">${minione.map((r) => kartaSzkolenia(r).replace(/<p><a class="gig-szk-btn"[^]*?<\/p>/, "")).join("")}</div></details>` : "") +
    `</section>`;
  hs = blok(hs, "szkolenia", sekcja, (h, c) => h.replace('<div id="gig-szkolenia"></div>', `<div id="gig-szkolenia">${c}</div>`));
  const eventy = nadchodzace.map(eventLd).filter(Boolean);
  hs = blok(hs, "szkolenia-jsonld", eventy.length ? jsonLd({ "@context": "https://schema.org", "@graph": eventy }) : "", przedHead);
  doZapisu.push(["szkolenia/index.html", hs]);

  // 2) Członkowie
  let hc = await czytaj("czlonkowie/index.html");
  const wgReg = {};
  czl.forEach((r) => (wgReg[r.region || "Pozostałe"] = wgReg[r.region || "Pozostałe"] || []).push(r));
  const listaCzl = Object.keys(wgReg).sort((a, b) => a.localeCompare(b, "pl")).map((reg) => {
    const l = wgReg[reg].sort((a, b) => a.name.localeCompare(b.name, "pl"));
    return `<div class="region"><h2>${esc(reg)}</h2><span class="pill">${l.length}</span><span class="ln"></span></div><div class="grid">` +
      l.map((r) => {
        const msc = ((String(r.address || "").match(/\d{2}-\d{3}\s*(.+)$/) || [])[1] || "").trim();
        const meta = [esc(reg), esc(msc)].filter(Boolean).join(" · ");
        return `<div class="card"><h3>${esc(r.name)}</h3>${meta ? `<div class="who">${meta}</div>` : ""}` +
          (r.person ? `<div class="who" style="margin-top:2px;color:#8a96a2">${esc(r.person)}</div>` : "") +
          (val(r.description) ? `<p class="who" style="margin-top:6px">${esc(skroc(r.description, 200))}</p>` : "") + `</div>`;
      }).join("") + `</div>`;
  }).join("");
  hc = blok(hc, "czlonkowie", `<div data-prerender="czlonkowie">${listaCzl}</div>`,
    (h, c) => h.replace('<div id="lista"><div class="empty">Ładowanie listy członków…</div></div>', `<div id="lista">${c}</div>`));
  doZapisu.push(["czlonkowie/index.html", hc]);

  // 3) Najnowsze wpisy: strona główna i Baza wiedzy
  const zPanelu = (kat) => art.filter((a) => a.category === kat).map((a) => {
    const d = new Date(a.published_at || a.created_at);
    return { kiedy: d, date: `${d.getDate()} ${MIES[d.getMonth()]}, ${d.getFullYear()}`, title: a.title, href: `/wpis/${a.slug}/`,
      img: a.image_url || FALLBACK_IMG, excerpt: skroc(a.excerpt || bezTagow(a.content), 240) };
  });
  const statAkt = wpisyStatyczne(await czytaj("aktualnosci/index.html"));
  const statArt = wpisyStatyczne(await czytaj("artykuly/index.html"));
  const kartaDom = (d) => `<div class="posts_group lm_wrapper element_classes col- photo"><article class="post post-item isotope-item clearfix category-5 type-post status-publish format-standard has-post-thumbnail hentry category-aktualnosci">` +
    `<div class="date_label">${esc(d.date)}</div><div class="image_frame post-photo-wrapper scale-with-grid image"><div class="image_wrapper"><a href="${esc(d.href)}"><div class="mask"></div><img alt="" class="scale-with-grid wp-post-image" decoding="async" loading="lazy" src="${esc(d.img)}"/></a></div></div>` +
    `<div class="post-desc-wrapper bg- has-custom-bg"><div class="post-desc"><div class="post-head"><div class="post-meta clearfix"><div class="author-date"><span class="date"><i class="icon-clock"></i> <span class="post-date updated">${esc(d.date)}</span></span></div></div>` +
    `<div class="post-footer"><div class="post-links"><i aria-hidden="true" class="read-more-icon icon-doc-text"></i> <a class="post-more" href="${esc(d.href)}">Czytaj dalej</a></div></div></div>` +
    `<div class="post-title"><h5 class="entry-title" itemprop="headline"><a href="${esc(d.href)}">${esc(d.title)}</a></h5></div><div class="post-excerpt">${esc(d.excerpt)}</div></div></div></article></div>`;
  let hi = await czytaj("index.html");
  hi = blok(hi, "aktualnosci", najnowsze(zPanelu("aktualnosci"), statAkt, 2).map(kartaDom).join(""), (h, c) => {
    const s = '<div id="gig-home-aktualnosci" class="gig-news-grid">';
    const i = h.indexOf(s); if (i < 0) return h;
    const j = h.indexOf('<div class="gig-news-more">', i); const k = h.lastIndexOf("</div>", j);
    return h.slice(0, i + s.length) + c + h.slice(k);
  });
  doZapisu.push(["index.html", hi]);

  const kartaBw = (d) => `<a class="bw-card" href="${esc(d.href)}"><div class="img" ${d.img ? `style="background-image:url('${esc(d.img)}')"` : ""}></div><div class="body">` +
    (d.date ? `<span class="date">${esc(d.date)}</span>` : "") + `<h3>${esc(d.title)}</h3>` + (d.excerpt ? `<p>${esc(d.excerpt)}</p>` : "") + `<span class="more">Czytaj dalej →</span></div></a>`;
  let hb = await czytaj("baza-wiedzy/index.html");
  for (const [id, kat, stat] of [["bw-aktualnosci", "aktualnosci", statAkt], ["bw-artykuly", "artykuly", statArt]]) {
    hb = blok(hb, id, najnowsze(zPanelu(kat), stat, 3).map(kartaBw).join(""),
      (h, c) => h.replace(`<div class="bw-grid" id="${id}"><div class="bw-loading">Ładowanie…</div></div>`, `<div class="bw-grid" id="${id}">${c}</div>`));
  }
  doZapisu.push(["baza-wiedzy/index.html", hb]);

  // 3b) Listy Aktualności i Artykułów: wpisy z panelu na górze, jak robi artykuly-render.js
  //     (klon pierwszej karty z WordPressa, oznaczony data-gig-src="db", żeby skrypt ich nie dublował)
  const kartaListy = (tpl, d) => tpl
    .replace(/^<article /, '<article data-gig-src="db" ')
    .replace(/<a ([^>]*)>/g, (m, at) => /class="zoom/.test(at)
      ? `<a ${at.replace(/href="[^"]*"/, `href="${esc(d.img)}"`)}>`
      : `<a ${at.replace(/href="[^"]*"/, `href="${esc(d.href)}"`).replace(/\s*rel="[^"]*"/, "")}>`)
    .replace(/<img ([^>]*?)\/?>/g, (m, at) => `<img ${at.replace(/\s*(srcset|sizes|width|height|loading)="[^"]*"/g, "")
      .replace(/src="[^"]*"/, `src="${esc(d.img)}"`).replace(/alt="[^"]*"/, `alt="${esc(d.title)}"`)} loading="lazy"/>`)
    .replace(/(<div class="date_label">)[^<]*(<\/div>)/, `$1${esc(d.date)}$2`)
    .replace(/(<span class="post-date[^"]*">)[^<]*(<\/span>)/g, `$1${esc(d.date)}$2`)
    .replace(/(<h[345] class="entry-title"[^>]*><a [^>]*>)[^<]*(<\/a>)/, `$1${esc(d.title)}$2`)
    .replace(/(<div class="post-excerpt">)[\s\S]*?(<\/div>)/, `$1${esc(d.excerpt)} $2`);
  const listy = [["aktualnosci/index.html", "aktualnosci"], ["baza-wiedzy/aktualnosci-gig/index.html", "aktualnosci"],
    ["artykuly/index.html", "artykuly"], ["baza-wiedzy/artykuly/index.html", "artykuly"]];
  for (const [rel, kat] of listy) {
    let hl = await czytaj(rel);
    const bezNaszych = hl.replace(/<!--PRERENDER:lista-->[\s\S]*?<!--\/PRERENDER:lista-->/, "");
    const tpl = (bezNaszych.match(/<article[^>]*post-item[\s\S]*?<\/article>/) || [])[0];
    if (!tpl) throw new Error(`brak karty-wzorca na liście ${rel}`);
    const karty = zPanelu(kat).slice(0, 50).map((d) => kartaListy(tpl, d)).join("");
    hl = blok(hl, "lista", karty, (h, c) => h.replace(/(<div class="posts_group[^"]*"[^>]*>)/, `$1${c}`));
    doZapisu.push([rel, hl]);
  }

  // 4) Strony wpisów
  const szablon = await czytaj("wpis/index.html");
  const slugi = new Set();
  for (const a of art) {
    if (!a.slug || !/^[a-z0-9-]+$/.test(a.slug)) continue;
    slugi.add(a.slug);
    doZapisu.push([`wpis/${a.slug}/index.html`, stronaWpisu(szablon, a)]);
  }

  // 5) Mapa strony: dotychczasowe adresy + wpisy z panelu
  const stara = await czytaj("sitemap.xml");
  const adresy = [...stara.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((m) => ({ loc: m[1], lastmod: m[2] || "" })).filter((u) => !u.loc.includes("/wpis/"));
  if (adresy.length < 10) throw new Error("obecna mapa strony wygląda na uszkodzoną");
  const dzisIso = new Date().toISOString().slice(0, 10);
  const najSzk = szk.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), "");
  adresy.forEach((u) => { if (u.loc === SITE + "/szkolenia/" && najSzk) u.lastmod = najSzk.slice(0, 10); });
  const wpisy = art.filter((a) => slugi.has(a.slug)).map((a) => ({ loc: `${SITE}/wpis/${a.slug}/`, lastmod: String(a.updated_at || a.published_at || dzisIso).slice(0, 10) }));
  const mapa = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    adresy.concat(wpisy).map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n") + `\n</urlset>\n`;
  doZapisu.push(["sitemap.xml", mapa]);

  // 6) llms.txt: skrót strony dla modeli językowych (https://llmstxt.org)
  const lin = (t, u, o) => `- [${t}](${u})${o ? ": " + o : ""}`;
  const llms = [
    "# Geodezyjna Izba Gospodarcza (GIG)",
    "",
    "> Samorząd gospodarczy firm geodezyjnych w Polsce, działający od 1994 roku. Zrzesza " + czl.length +
    " firm geodezyjnych, reprezentuje je wobec administracji (m.in. Głównego Geodety Kraju i ośrodków dokumentacji), " +
    "opiniuje projekty przepisów, prowadzi szkolenia i Węzeł Jakości (rynkowe stawki prac geodezyjnych w układzie SEKOCENBUD). " +
    "Hasło: „Silni wiedzą, zjednoczeni działaniem”.",
    "",
    "Dane: ul. Czackiego 3/5, 00-043 Warszawa · tel. 22 827 38 43 · biuro@gig.org.pl · NIP 525-20-34-024 · REGON 010753536.",
    "Składka członkowska: 40 zł miesięcznie (firma jednoosobowa), 80 zł (do 5 osób), 160 zł (powyżej 5 osób); wpisowe 75 zł.",
    "",
    "## Najważniejsze strony",
    lin("O Izbie", SITE + "/o-nas/", "historia, organy, statut"),
    lin("Dołącz do Izby", SITE + "/dolacz-do-nas/", "korzyści, koszty, procedura przyjęcia"),
    lin("Katalog Członków", SITE + "/czlonkowie/", `${czl.length} firm geodezyjnych wg województw`),
    lin("Kalendarz szkoleń", SITE + "/szkolenia/"),
    lin("Węzeł Jakości: ankieta cenowa", SITE + "/wezel-jakosci/"),
    lin("Baza wiedzy", SITE + "/baza-wiedzy/"),
    lin("Kontakt", SITE + "/kontakt/"),
    "",
    "## Nadchodzące szkolenia i wydarzenia",
    ...(nadchodzace.length ? nadchodzace.map((r) => lin(r.title, SITE + "/szkolenia/",
      [r.date_start ? dzien(new Date(r.date_start + "T00:00:00")) : r.date_label, r.time_range, r.is_online ? "online" : r.location, r.price ? "cena " + r.price : "", r.price_member ? "dla członków " + r.price_member : ""].filter(Boolean).join(", ")))
      : ["- brak zaplanowanych szkoleń"]),
    "",
    "## Artykuły i aktualności",
    ...najnowsze(zPanelu("artykuly").concat(zPanelu("aktualnosci")), statArt.concat(statAkt), 30)
      .map((d) => lin(d.title, d.href.startsWith("http") ? d.href : SITE + d.href, d.date)),
    "",
    "## Opcjonalnie",
    lin("Mapa strony", SITE + "/sitemap.xml"),
    lin("Polityka prywatności", SITE + "/polityka-prywatnosci-rodo/"),
    "",
  ].join("\n");
  doZapisu.push(["llms.txt", llms]);

  // Zapis dopiero teraz: wszystkie strony zbudowały się bez błędu.
  for (const [rel, tresc] of doZapisu) await zapisz(rel, tresc);

  // Sprzątanie: strony wpisów, które zniknęły z bazy (tylko te, które sami wygenerowaliśmy).
  for (const e of await fs.readdir(path.join(ROOT, "wpis"), { withFileTypes: true })) {
    if (!e.isDirectory() || slugi.has(e.name)) continue;
    const p = path.join(ROOT, "wpis", e.name, "index.html");
    try {
      if ((await fs.readFile(p, "utf8")).includes('name="gig-prerender"')) {
        await fs.rm(path.join(ROOT, "wpis", e.name), { recursive: true });
        zmienione.push(`wpis/${e.name}/ (usunięty)`);
      }
    } catch { /* brak pliku: nie nasz katalog */ }
  }

  console.log(`Szkoleń: ${szk.length} (nadchodzących ${nadchodzace.length}), członków: ${czl.length}, wpisów: ${art.length}.`);
  console.log(zmienione.length ? "Zmienione pliki:\n  " + zmienione.join("\n  ") : "Bez zmian.");
}

main().catch((e) => {
  // Błąd budowy strony (np. zmienił się szablon): nie zapisaliśmy nic, strona zostaje jak była.
  console.error("Prerender przerwany, niczego nie zapisano:", e.message);
  process.exitCode = 0;
});
