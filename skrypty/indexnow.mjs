// =====================================================================
// GIG: powiadomienie wyszukiwarek o zmianach (IndexNow: Bing, Yandex, Seznam, Naver).
//
// Po co: wyszukiwarka ChatGPT i Copilot korzystają z indeksu Binga. Bez powiadomienia
// Bing odkrywa nowe szkolenia i wpisy po dniach lub tygodniach; z IndexNow zwykle w godziny.
// Google nie obsługuje IndexNow (dla niego jest sitemap.xml).
//
// Klucz: plik strona/<klucz>.txt (publiczny z założenia: wyszukiwarka sprawdza,
// że zgłaszający kontroluje domenę). Skrypt znajduje go sam.
//
// Użycie:
//   node skrypty/indexnow.mjs strona/szkolenia/index.html strona/wpis/x/index.html ...
//       (pliki zmienione w commicie; workflow prerender.yml podaje je z git diff)
//   node skrypty/indexnow.mjs --wszystko      (wszystkie adresy z sitemap.xml)
// Zgłaszamy tylko strony z mapy strony (bez panelu, formularzy i stron z noindex)
// oraz usunięte wpisy, żeby wyszukiwarka je wyrzuciła. Błąd sieci nie przerywa workflow.
// =====================================================================
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "strona");
const HOST = "gig.org.pl";
const SITE = "https://" + HOST;

async function main() {
  const klucz = (await fs.readdir(ROOT)).map((f) => f.match(/^([0-9a-f]{32})\.txt$/)).find(Boolean)?.[1];
  if (!klucz) { console.log("IndexNow: brak pliku klucza w strona/, pomijam."); return; }

  const mapa = await fs.readFile(path.join(ROOT, "sitemap.xml"), "utf8");
  const zMapy = new Set([...mapa.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));

  const arg = process.argv.slice(2);
  let adresy;
  if (arg.includes("--wszystko")) adresy = [...zMapy];
  else {
    adresy = arg.map((p) => p.replace(/\\/g, "/").replace(/^strona\//, ""))
      .filter((p) => p.endsWith("index.html"))
      .map((p) => SITE + "/" + p.replace(/index\.html$/, ""))
      .filter((u) => zMapy.has(u) || /\/wpis\/[^/]+\/$/.test(u));   // usunięty wpis: zgłaszamy, żeby zniknął
    if (arg.some((p) => /sitemap\.xml$/.test(p))) adresy.push(SITE + "/sitemap.xml");
  }
  adresy = [...new Set(adresy)];
  if (!adresy.length) { console.log("IndexNow: brak stron do zgłoszenia."); return; }

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: klucz, keyLocation: `${SITE}/${klucz}.txt`, urlList: adresy }),
  });
  // 200/202 = przyjęte; 403 = klucz jeszcze niewidoczny na stronie (pierwsze wdrożenie)
  console.log(`IndexNow: HTTP ${res.status}, zgłoszono ${adresy.length}:\n  ` + adresy.join("\n  "));
}

main().catch((e) => { console.error("IndexNow: błąd, pomijam:", e.message); process.exitCode = 0; });
