// ============================================================
// GIG — Edge Function: firma-gus
// Dane firmy po NIP-ie do formularza „Dołącz do nas" (przycisk „Wczytaj dane z GUS").
//
//   GET/POST ?nip=0000000000 → { ok, zrodlo, nazwa, ulica, kod, miejscowosc,
//                                wojewodztwo, powiat, gmina, nip, regon, krs, pkd }
//
// Dwa źródła, w tej kolejności:
//   1. GUS BIR1 (REGON) — pełne dane łącznie z województwem, powiatem i gminą
//      oraz PKD wiodącym i KRS. Wymaga bezpłatnego klucza: api.stat.gov.pl →
//      sekret `GUS_BIR_KEY` w Supabase (bez niego funkcja pomija to źródło).
//   2. Biała lista podatników VAT (Ministerstwo Finansów) — bez klucza, ale
//      daje tylko nazwę, REGON, KRS i adres w jednej linii (rozbijamy regexem),
//      bez podziału administracyjnego i bez PKD.
//
// Dane są publiczne (rejestry), więc funkcja nie wymaga logowania
// (verify_jwt = false). Zabezpieczenie przed nadużyciem: NIP musi przejść sumę
// kontrolną, więc funkcja nie nadaje się do skanowania zakresów.
// ============================================================

const GUS_KEY = Deno.env.get("GUS_BIR_KEY") ?? "";
const GUS_URL = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc";
const NS_ACT = "http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/* Suma kontrolna NIP-u: 10 cyfr, ostatnia wyliczana z wag. */
function nipOk(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const suma = w.reduce((s, waga, i) => s + waga * Number(nip[i]), 0) % 11;
  return suma !== 10 && suma === Number(nip[9]);
}

/* ── GUS BIR1 (SOAP) ── */
function koperta(action: string, body: string, sid?: string): string {
  const hdrSid = sid ? `<sid xmlns="http://CIS/BIR/PUBL/2014/07">${sid}</sid>` : "";
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://www.w3.org/2005/08/addressing">` +
    `<soap:Header><wsa:To>${GUS_URL}</wsa:To><wsa:Action>${action}</wsa:Action>${hdrSid}</soap:Header>` +
    `<soap:Body>${body}</soap:Body></soap:Envelope>`;
}
async function soap(action: string, body: string, sid?: string): Promise<string> {
  const h: Record<string, string> = { "Content-Type": "application/soap+xml; charset=utf-8" };
  if (sid) h["sid"] = sid;
  const r = await fetch(GUS_URL, { method: "POST", headers: h, body: koperta(action, body, sid) });
  return await r.text();
}
/* GUS oddaje XML zagnieżdżony w encjach — rozpakowujemy przed czytaniem pól. */
function rozpakuj(txt: string, wynikTag: string): string {
  const m = txt.match(new RegExp(`<${wynikTag}>([\\s\\S]*?)</${wynikTag}>`));
  if (!m) return "";
  return m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#xD;/g, "").replace(/&amp;/g, "&");
}
function pole(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : "";
}

type Firma = Record<string, string>;

async function zGus(nip: string): Promise<Firma | null> {
  if (!GUS_KEY) return null;
  let sid = "";
  try {
    const zal = await soap(NS_ACT + "/Zaloguj",
      `<Zaloguj xmlns="http://CIS/BIR/PUBL/2014/07"><pKluczUzytkownika>${GUS_KEY}</pKluczUzytkownika></Zaloguj>`);
    sid = (zal.match(/<ZalogujResult>([^<]*)<\/ZalogujResult>/) ?? ["", ""])[1];
    if (!sid) { console.error("GUS: brak sesji (klucz?)"); return null; }

    const szukaj = rozpakuj(await soap(NS_ACT + "/DaneSzukajPodmioty",
      `<DaneSzukajPodmioty xmlns="http://CIS/BIR/PUBL/2014/07"><pParametryWyszukiwania xmlns:d="http://CIS/BIR/PUBL/2014/07/DataContract">` +
      `<d:Nip>${nip}</d:Nip></pParametryWyszukiwania></DaneSzukajPodmioty>`, sid), "DaneSzukajPodmiotyResult");
    const regon = pole(szukaj, "Regon");
    if (!regon) return null;

    const ulica = [pole(szukaj, "Ulica"), pole(szukaj, "NrNieruchomosci")].filter(Boolean).join(" ");
    const lokal = pole(szukaj, "NrLokalu");
    const typ = pole(szukaj, "Typ");                 // P = prawna, F = fizyczna
    const fizyczna = typ === "F";

    const firma: Firma = {
      zrodlo: "GUS",
      nazwa: pole(szukaj, "Nazwa"),
      ulica: lokal ? `${ulica}/${lokal}` : ulica,
      kod: pole(szukaj, "KodPocztowy"),
      miejscowosc: pole(szukaj, "Miejscowosc"),
      wojewodztwo: pole(szukaj, "Wojewodztwo").toLowerCase(),
      powiat: pole(szukaj, "Powiat"),
      gmina: pole(szukaj, "Gmina"),
      nip, regon, krs: "", pkd: "",
    };

    // KRS tylko dla osób prawnych; PKD wiodące z osobnego raportu
    if (!fizyczna) {
      const raport = rozpakuj(await soap(NS_ACT + "/DanePobierzPelnyRaport",
        `<DanePobierzPelnyRaport xmlns="http://CIS/BIR/PUBL/2014/07"><pRegon>${regon}</pRegon>` +
        `<pNazwaRaportu>BIR11OsPrawna</pNazwaRaportu></DanePobierzPelnyRaport>`, sid), "DanePobierzPelnyRaportResult");
      const krs = pole(raport, "praw_numerWRejestrzeEwidencji");
      if (/^\d{10}$/.test(krs)) firma.krs = krs;
    }
    const pkdRaport = rozpakuj(await soap(NS_ACT + "/DanePobierzPelnyRaport",
      `<DanePobierzPelnyRaport xmlns="http://CIS/BIR/PUBL/2014/07"><pRegon>${regon}</pRegon>` +
      `<pNazwaRaportu>${fizyczna ? "BIR11OsFizycznaPkd" : "BIR11OsPrawnaPkd"}</pNazwaRaportu></DanePobierzPelnyRaport>`, sid),
      "DanePobierzPelnyRaportResult");
    // wiodące PKD ma znacznik „przewazajace" = 1; gdy go nie ma, bierzemy pierwsze
    const dane = pkdRaport.split(/<\/dane>/).filter((x) => x.includes("Pkd"));
    const wiodace = dane.find((d) => /Przewazajace>\s*1\s*</i.test(d)) ?? dane[0] ?? "";
    const kod = (wiodace.match(/<\w*pkdKod>([^<]*)</i) ?? ["", ""])[1].trim();
    const nazwaPkd = (wiodace.match(/<\w*pkdNazwa>([^<]*)</i) ?? ["", ""])[1].trim();
    if (kod) firma.pkd = [kod, nazwaPkd].filter(Boolean).join(" — ");

    return firma;
  } catch (e) {
    console.error("GUS:", e);
    return null;
  } finally {
    if (sid) {
      try {
        await soap(NS_ACT + "/Wyloguj",
          `<Wyloguj xmlns="http://CIS/BIR/PUBL/2014/07"><pIdentyfikatorSesji>${sid}</pIdentyfikatorSesji></Wyloguj>`, sid);
      } catch { /* wylogowanie nie jest krytyczne */ }
    }
  }
}

/* ── Biała lista MF: bez klucza, adres w jednej linii („ULICA 3/5/207, 00-043 WARSZAWA") ── */
function rozbijAdres(adres: string): { ulica: string; kod: string; miejscowosc: string } {
  const m = adres.match(/^(.*?),?\s*(\d{2}-\d{3})\s+(.+)$/);
  if (!m) return { ulica: adres.trim(), kod: "", miejscowosc: "" };
  return { ulica: m[1].replace(/,\s*$/, "").trim(), kod: m[2], miejscowosc: m[3].trim() };
}
async function zMf(nip: string): Promise<Firma | null> {
  try {
    const dzis = new Date().toISOString().slice(0, 10);
    const r = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${dzis}`);
    if (!r.ok) return null;
    const d = await r.json();
    const s = d?.result?.subject;
    if (!s) return null;
    const a = rozbijAdres(String(s.workingAddress ?? s.residenceAddress ?? ""));
    return {
      zrodlo: "MF", nazwa: String(s.name ?? ""), ulica: a.ulica, kod: a.kod, miejscowosc: a.miejscowosc,
      wojewodztwo: "", powiat: "", gmina: "", nip, regon: String(s.regon ?? ""), krs: String(s.krs ?? ""), pkd: "",
    };
  } catch (e) {
    console.error("MF:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let nip = "";
  if (req.method === "GET") nip = new URL(req.url).searchParams.get("nip") ?? "";
  else if (req.method === "POST") {
    try { nip = String(((await req.json()) as Record<string, unknown>).nip ?? ""); } catch { /* puste */ }
  } else return json({ error: "tylko GET/POST" }, 405);

  nip = nip.replace(/[\s-]/g, "");
  if (!nipOk(nip)) return json({ error: "Podaj poprawny NIP (10 cyfr)." }, 400);

  const firma = (await zGus(nip)) ?? (await zMf(nip));
  if (!firma) return json({ error: "Nie znaleźliśmy firmy o tym NIP-ie w rejestrach. Wpisz dane ręcznie." }, 404);
  console.log(`firma-gus: ${nip} -> ${firma.zrodlo} (${firma.nazwa})`);
  return json({ ok: true, ...firma });
});
