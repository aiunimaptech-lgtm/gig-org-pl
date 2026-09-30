// ============================================================
// GIG, Edge Function: zapis-uczestnicy
// Lista uczestników zgłoszenia wieloosobowego, uzupełniana przez organizację.
//
// Biuro wysyła z panelu /admin/zapisy.html prośbę do osoby kontaktowej zgłoszenia:
//   * szkolenie płatne: zaświadczenie dostaje każda osoba, za którą zapłacono
//     (kwota = liczba osób × cena), wszyscy na jednej fakturze;
//   * udział z osobnych stanowisk wymaga e-maila każdej osoby (tam idzie link).
// W mailu jest osobisty link /uczestnicy/?t=<token>: formularz z imieniem, nazwiskiem
// i e-mailem każdej osoby. Zapis nadpisuje uczestnicy / uczestnicy_lista / liczba_osob,
// poprzednią wersję odkłada do uczestnicy_historia i wysyła dwa maile: powiadomienie
// do biura (Reply-To = organizacja) i potwierdzenie do organizacji.
//
// Tryby (POST JSON):
//   publiczne (bez logowania, klucz = token z linku):
//     { t, tryb: 'info' }                   -> dane zgłoszenia do formularza
//     { t, tryb: 'zapisz', osoby: [{imie, email}] }
//   panel (Authorization: Bearer <access_token admina>, sesja z kodem e-mail):
//     { tryb: 'podglad', id }               -> { subject, html } bez wysyłki
//     { tryb: 'wyslij', ids: [...], test? } -> test: mail pierwszego zgłoszenia na adres admina
// verify_jwt = false (strona publiczna woła bez sesji).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const SITE = (Deno.env.get("SITE_URL") ?? "https://gig.org.pl").replace(/\/$/, "");
const NOTIFY_EMAILS = (Deno.env.get("NOTIFY_EMAILS") ?? "biuro@gig.org.pl,jerzy.bryk@gmail.com")
  .split(",").map((x) => x.trim()).filter(Boolean);
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const C = { dark: "#16202a", mid: "#cc0a2b", bg: "#fdecef" };
const MAX_OSOB = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1] ?? "";
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch { return {}; }
}
async function sesjaPoKodzie(jwt: string): Promise<boolean> {
  const sid = String(jwtClaims(jwt).session_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return false;
  const r = await admin().from("panel_sesje_ok").select("session_id")
    .eq("session_id", sid).gt("wygasa", new Date().toISOString()).maybeSingle();
  return !r.error && !!r.data;
}
function nowyToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── szkolenie i cena ──────────────────────────────────────────
type Szkolenie = { title: string; date_start: string | null; time_range: string | null; is_online: boolean | null; price: string | null; price_member: string | null };
type Zapis = Record<string, unknown> & {
  id: string; szkolenie: string; liczba_osob: number | null; uczestnicy: string | null;
  uczestnicy_lista: Array<{ imie: string; email: string | null }> | null; email: string;
  nabywca_nazwa: string | null; nabywca_typ: string | null; czlonek_gig: boolean | null;
  status: string | null; uczestnicy_token: string | null; uczestnicy_prosba_at: string | null;
  uczestnicy_uzupelnione_at: string | null; uczestnicy_historia: unknown[] | null;
};

// jak kluczSzk w panelu: tytuł ze zgłoszenia bywa innym wariantem (myślnik, spacje)
const kluczSzk = (t: string | null | undefined) => String(t ?? "").toLowerCase()
  .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();

async function szkolenieDla(tytul: string): Promise<Szkolenie | null> {
  const r = await admin().from("szkolenia").select("title,date_start,time_range,is_online,price,price_member");
  if (r.error) { console.error("szkolenia:", r.error.message); return null; }
  const k = kluczSzk(tytul);
  return ((r.data ?? []) as Szkolenie[]).find((s) => kluczSzk(s.title) === k) ?? null;
}
function cenaLiczba(txt: string | null | undefined): number | null {
  const t = String(txt ?? "").replace(/\u00a0/g, " ").toLowerCase();
  const m = t.match(/\d[\d ]*(?:[.,]\d+)?/);
  if (m) return parseFloat(m[0].replace(/ /g, "").replace(",", "."));
  return /bezp[\u0142l]at|gratis|nieodp[\u0142l]at/.test(t) ? 0 : null;
}
function bezplatne(s: Szkolenie | null): boolean { return cenaLiczba(s?.price) === 0; }
// cena za osobę: członek wg ceny członkowskiej (osoba prywatna zawsze wg podstawowej)
function cenaOsoby(z: Zapis, s: Szkolenie | null): { cena: number | null; czlonkowska: boolean } {
  const pods = cenaLiczba(s?.price);
  if (z.czlonek_gig !== true || z.nabywca_typ === "osoba") return { cena: pods, czlonkowska: false };
  const czl = cenaLiczba(s?.price_member);
  return czl === null ? { cena: pods, czlonkowska: false } : { cena: czl, czlonkowska: true };
}
const zl = (x: number) => x.toLocaleString("pl-PL", { maximumFractionDigits: 2 }) + " zł";
// mianownik: „zgłoszonych: 1 osoba / 2 osoby / 5 osób”
const mianOsob = (n: number) => {
  const d = n % 10, s = n % 100;
  if (n === 1) return "osoba";
  return (d >= 2 && d <= 4 && (s < 12 || s > 14)) ? "osoby" : "osób";
};
// biernik: „obejmuje 1 osobę / 2 osoby / 5 osób”
const slowoOsob = (n: number) => {
  const d = n % 10, s = n % 100;
  if (n === 1) return "osobę";
  return (d >= 2 && d <= 4 && (s < 12 || s > 14)) ? "osoby" : "osób";
};
const MIES = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca",
  "sierpnia", "września", "października", "listopada", "grudnia"];
function dataPl(iso: string | null | undefined, przesun = 0): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + przesun);
  return `${d.getUTCDate()} ${MIES[d.getUTCMonth()]} ${d.getUTCFullYear()} r.`;
}
function dzisWarszawa(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
}

// ── uczestnicy ze zgłoszenia ──────────────────────────────────
const RE_MAIL = /[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/;
function osobyZeZgloszenia(z: Zapis): Array<{ imie: string; email: string | null }> {
  if (Array.isArray(z.uczestnicy_lista) && z.uczestnicy_lista.length) {
    return z.uczestnicy_lista.map((o) => ({ imie: String(o.imie ?? "").trim(), email: o.email ? String(o.email).toLowerCase() : null }));
  }
  let linie = String(z.uczestnicy ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean);
  // „Anna Nowak, Jan Kowalski, …” w jednej linii (bez adresów) = kilka osób
  if (linie.length === 1 && (z.liczba_osob ?? 1) > 1 && !RE_MAIL.test(linie[0]) && linie[0].includes(",")) {
    linie = linie[0].split(",").map((x) => x.trim()).filter(Boolean);
  }
  return linie.map((l) => {
    const m = l.match(RE_MAIL);
    const email = m ? m[0].toLowerCase().replace(/[.;,]+$/, "") : null;
    const imie = (m ? l.replace(m[0], "") : l)
      .replace(/\be-?mail\s*:?/i, "").replace(/[\s,;:\-\u2013\u2014]+$/g, "").replace(/^[\s,;:\-\u2013\u2014]+/g, "").replace(/\s{2,}/g, " ").trim();
    return { imie, email };
  });
}

// ── maile ─────────────────────────────────────────────────────
function layout(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <tr><td style="padding:26px 34px 18px;background:#ffffff;">
        <img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="height:3px;background:${C.mid};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;font-size:15px;line-height:1.65;color:#38444e;">
        <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:${C.dark};font-weight:800;">${title}</h1>
        ${body}
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:${C.dark};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${C.mid};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${C.mid};text-decoration:none;">gig.org.pl</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
// temat z danych zgłoszenia: bez znaków sterujących (nowe linie w nagłówku) i nie za długi
const temat = (t: string) => t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
const P = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${t}</p>`;
function blok(nr: string, tytul: string, tresc: string): string {
  return `<div style="margin:0 0 14px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;letter-spacing:.3px;">${nr ? nr + ". " : ""}${tytul}</p>
      <p style="margin:0;font-size:14.5px;line-height:1.65;color:${C.dark};">${tresc}</p>
    </div>`;
}
function tabelaOsob(osoby: Array<{ imie: string; email: string | null }>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border:1px solid #e6ebef;border-radius:8px;border-collapse:separate;overflow:hidden;">
    <tr><td style="padding:8px 12px;background:#f5f8fa;font-size:12px;color:#6b7c8c;font-weight:700;">Imię i nazwisko</td>
        <td style="padding:8px 12px;background:#f5f8fa;font-size:12px;color:#6b7c8c;font-weight:700;">E-mail uczestnika</td></tr>
    ${osoby.map((o, i) => `<tr>
        <td style="padding:7px 12px;border-top:1px solid #edf1f4;font-size:14px;color:${C.dark};">${i + 1}. ${esc(o.imie || "(bez nazwiska)")}</td>
        <td style="padding:7px 12px;border-top:1px solid #edf1f4;font-size:14px;color:${o.email ? C.dark : "#9aa7b2"};">${o.email ? esc(o.email) : "brak"}</td></tr>`).join("")}
  </table>`;
}
function termin(s: Szkolenie | null): string {
  if (!s?.date_start) return "";
  return `${dataPl(s.date_start)}${s.time_range ? `, godz. ${esc(s.time_range)}` : ""}${s.is_online !== false ? ", online" : ""}`;
}

function mailProsba(z: Zapis, s: Szkolenie | null, link: string): { subject: string; html: string } {
  const bezpl = bezplatne(s);
  const osoby = osobyZeZgloszenia(z);
  const n = Math.max(Number(z.liczba_osob) || 0, osoby.length, 1);
  const org = (z.nabywca_nazwa ?? "").trim();
  const tytul = (s?.title ?? z.szkolenie ?? "").trim();
  const kiedy = termin(s);
  const online = s?.is_online !== false;
  const doDnia = dataPl(s?.date_start, -2);
  const { cena, czlonkowska } = cenaOsoby(z, s);
  const bezEmaila = osoby.filter((o) => !o.email).length;

  const wstep = P(`Dzień dobry,`) + P(`dziękujemy za zgłoszenie na ${bezpl ? "bezpłatne wydarzenie" : "szkolenie"} <strong>${esc(tytul)}</strong>${kiedy ? `, które odbędzie się ${kiedy}` : ""}. Zgłoszenie${org ? ` od ${esc(org)}` : ""} obejmuje <strong>${n} ${slowoOsob(n)}</strong>.`)
    + P(bezpl ? `Przed wysłaniem linków prosimy o jedną informację.` : `Przed wysłaniem linków prosimy o zapoznanie się z dwiema informacjami.`);

  let nr = 0;
  let bloki = "";
  if (!bezpl) {
    nr++;
    const kwota = cena === null ? ""
      : cena === 0
        ? ` Dla Państwa udział jest bezpłatny${czlonkowska ? " (cena dla członków GIG)" : ""}, więc zaświadczenie otrzyma każda osoba z listy.`
        : ` Opłata dotyczy każdego uczestnika osobno: <strong>${n} × ${zl(cena)} = ${zl(n * cena)}</strong>${czlonkowska ? " (cena dla członków GIG)" : ""}. Wszystkie osoby ujmiemy na jednej fakturze wystawionej na Państwa ${z.nabywca_typ === "osoba" ? "dane (rachunek)" : "organizację"}.`;
    bloki += blok(String(nr), "Zaświadczenie o ukończeniu szkolenia",
      `Zaświadczenie o ukończeniu szkolenia otrzyma każda zgłoszona osoba, za którą została wniesiona opłata.${kwota}`);
  }
  if (online) {
    nr++;
    bloki += blok(bezpl ? "" : String(nr), "Udział z osobnych stanowisk",
      `Jeśli uczestnicy mają łączyć się ${bezpl ? "" : "ze szkoleniem "}z osobnych komputerów, każdy potrzebuje własnego linku. Prosimy wtedy podać <strong>adres e-mail każdej osoby</strong>: link wyślemy dzień przed terminem bezpośrednio do niej. Osoby bez podanego adresu mogą uczestniczyć przy wspólnym stanowisku, z linkiem wysłanym na adres zgłoszenia.`);
  }

  const przycisk = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="border-radius:30px;background:${C.mid};">
      <a href="${link}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;border-radius:30px;">Uzupełnij listę uczestników</a>
    </td></tr></table>`;

  const body = wstep + bloki
    + P(`W zgłoszeniu mamy obecnie ${osoby.length === n ? "takie osoby" : `${osoby.length} z ${n} nazwisk`}:`)
    + tabelaOsob(osoby.length ? osoby : [{ imie: "(nie podano nazwisk)", email: null }])
    + P(`Prosimy o sprawdzenie listy i uzupełnienie adresów e-mail w formularzu${doDnia ? `, najlepiej do <strong>${doDnia}</strong>` : "."} Można w nim także dopisać lub usunąć osobę${bezpl ? "" : "; kwota do zapłaty przeliczy się automatycznie"}. Formularz przesyła się <strong>jeden raz</strong>, dlatego prosimy o podanie od razu wszystkich osób z Państwa organizacji.`)
    + przycisk
    + `<p style="margin:0 0 10px;font-size:13px;color:#6b7c8c;line-height:1.6;">${bezEmaila === 0 && osoby.length === n
        ? "Jeśli lista i adresy się zgadzają, nie trzeba nic robić."
        : "Jeśli wszyscy będą uczestniczyć przy jednym stanowisku, a lista nazwisk jest pełna, nie trzeba nic robić."}
       Link jest przeznaczony dla osoby prowadzącej zgłoszenie. Późniejsze zmiany prosimy zgłaszać w odpowiedzi na tę wiadomość. Jeśli przycisk nie działa, skopiuj adres: <span style="word-break:break-all;">${esc(link)}</span></p>`
    + `<p style="margin:0;font-size:13px;color:#6b7c8c;line-height:1.6;">W razie pytań wystarczy odpisać na tę wiadomość.</p>`;

  return {
    subject: temat(`${bezpl ? "Wydarzenie" : "Szkolenie"} ${s?.date_start ? dataPl(s.date_start).replace(/ r\.$/, "") : ""}: lista uczestników${org ? " (" + org + ")" : ""}`),
    html: layout(bezpl ? "Dane uczestników wydarzenia" : "Dane uczestników szkolenia", body),
  };
}

function mailPotwierdzenie(z: Zapis, s: Szkolenie | null, osoby: Array<{ imie: string; email: string | null }>): { subject: string; html: string } {
  const bezpl = bezplatne(s);
  const n = osoby.length;
  const { cena, czlonkowska } = cenaOsoby(z, s);
  const tytul = (s?.title ?? z.szkolenie ?? "").trim();
  const zMailem = osoby.filter((o) => o.email).length;
  const body = P("Dzień dobry,")
    + P(`zapisaliśmy listę uczestników ${bezpl ? "wydarzenia" : "szkolenia"} <strong>${esc(tytul)}</strong>${termin(s) ? ` (${termin(s)})` : ""}. Obecnie zgłoszonych: <strong>${n} ${mianOsob(n)}</strong>.`)
    + tabelaOsob(osoby)
    + (!bezpl && cena !== null && cena > 0
      ? blok("", "Opłata", `Do zapłaty: <strong>${n} × ${zl(cena)} = ${zl(n * cena)}</strong>${czlonkowska ? " (cena dla członków GIG)" : ""}. Zaświadczenie o ukończeniu szkolenia otrzyma każda osoba, za którą wniesiono opłatę. Wszystkie osoby ujmiemy na jednej fakturze.`)
      : "")
    + P(zMailem
      ? `Link do ${bezpl ? "spotkania" : "szkolenia"} wyślemy dzień przed terminem na adresy podane przy uczestnikach${zMailem < n ? ", a dla osób bez adresu na adres zgłoszenia" : ""}.`
      : `Link do ${bezpl ? "spotkania" : "szkolenia"} wyślemy dzień przed terminem na adres zgłoszenia.`)
    + `<p style="margin:0;font-size:13px;color:#6b7c8c;line-height:1.6;">Formularz został już wykorzystany. Jeśli trzeba coś poprawić, wystarczy odpisać na tę wiadomość.</p>`;
  return { subject: "Zapisaliśmy listę uczestników - GIG", html: layout("Lista uczestników zapisana ✓", body) };
}

function mailDoBiura(z: Zapis, s: Szkolenie | null, poprz: Array<{ imie: string; email: string | null }>, poprzN: number,
  osoby: Array<{ imie: string; email: string | null }>): { subject: string; html: string } {
  const bezpl = bezplatne(s);
  const { cena } = cenaOsoby(z, s);
  const n = osoby.length;
  const zmiana = n !== poprzN
    ? `<p style="margin:0 0 14px;padding:10px 14px;background:#fff8e6;border:1px solid #f0e2b6;border-radius:8px;font-size:14px;color:#7a5c14;"><strong>Zmiana liczby osób: ${poprzN} → ${n}.</strong>${!bezpl && cena ? ` Kwota: ${zl(poprzN * cena)} → <strong>${zl(n * cena)}</strong> (sprawdź fakturę).` : ""}</p>`
    : "";
  const body = P(`Zgłaszający <strong>${esc(z.nabywca_nazwa ?? z.email)}</strong> przesłał listę uczestników przez formularz. ${bezpl ? "Wydarzenie" : "Szkolenie"}: <strong>${esc(z.szkolenie)}</strong>.`)
    + zmiana
    + `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Nowa lista</p>` + tabelaOsob(osoby)
    + `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6b7c8c;text-transform:uppercase;">Poprzednio</p>` + tabelaOsob(poprz.length ? poprz : [{ imie: "(brak)", email: null }])
    + `<p style="margin:0;font-size:13px;color:#6b7c8c;">Kontakt zgłoszenia: <a href="mailto:${esc(z.email)}" style="color:${C.mid};">${esc(z.email)}</a>. Poprzednia wersja jest w historii zgłoszenia w <a href="https://gig.org.pl/admin/zapisy.html" style="color:${C.mid};">panelu GIG</a>.</p>`;
  return { subject: temat(`[GIG] Lista uczestników: ${z.nabywca_nazwa ?? z.email}${n !== poprzN ? ` (${poprzN} → ${n} os.)` : ""}`), html: layout("Uzupełniona lista uczestników", body) };
}

async function wyslijJeden(to: string[], subject: string, html: string, replyTo = REPLY_TO): Promise<{ ok: boolean; info: unknown }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, reply_to: replyTo }),
    });
    const wynik = await res.json();
    if (!res.ok) console.error("Resend:", wynik);
    return { ok: res.ok, info: wynik };
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return { ok: false, info: String(err) };
  }
}

// ── tryby publiczne ───────────────────────────────────────────
async function zapisPoTokenie(t: string): Promise<Zapis | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const r = await admin().from("zapisy_szkolenia").select("*").eq("uczestnicy_token", t).maybeSingle();
  return r.error ? null : (r.data as Zapis | null);
}

async function publiczny(body: Record<string, unknown>): Promise<Response> {
  const z = await zapisPoTokenie(String(body.t ?? ""));
  if (!z || z.status === "cancelled") return json({ ok: false, error: "Ten link jest nieaktualny. Napisz do nas na biuro@gig.org.pl." }, 404);
  const s = await szkolenieDla(z.szkolenie);
  const zamkniete = !!s?.date_start && s.date_start < dzisWarszawa();
  const { cena, czlonkowska } = cenaOsoby(z, s);

  if (body.tryb === "info") {
    return json({
      ok: true, szkolenie: s?.title ?? z.szkolenie, termin: termin(s), online: s?.is_online !== false,
      bezplatne: bezplatne(s), cena, czlonkowska, organizacja: z.nabywca_nazwa, email_org: z.email,
      osoba_prywatna: z.nabywca_typ === "osoba", liczba_osob: z.liczba_osob, osoby: osobyZeZgloszenia(z),
      zamkniete, uzupelniono: z.uczestnicy_uzupelnione_at, max: MAX_OSOB,
    });
  }
  if (body.tryb !== "zapisz") return json({ ok: false, error: "nieznany tryb" }, 400);
  if (zamkniete) return json({ ok: false, error: "Termin już minął, listy nie można zmienić. Napisz do nas na biuro@gig.org.pl." }, 409);
  // formularz jest jednorazowy: po przesłaniu zmiany tylko przez biuro (panel „Edytuj dane”)
  if (z.uczestnicy_uzupelnione_at) return json({ ok: false, juz: true, error: "Lista uczestników została już przesłana. Zmiany prosimy zgłaszać na biuro@gig.org.pl." }, 409);

  const surowe = Array.isArray(body.osoby) ? body.osoby as Array<Record<string, unknown>> : [];
  if (surowe.length > MAX_OSOB) return json({ ok: false, error: `Najwięcej ${MAX_OSOB} osób w jednym zgłoszeniu.` }, 400);
  const osoby = surowe.map((o) => ({
    imie: String(o?.imie ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    email: String(o?.email ?? "").trim().toLowerCase().slice(0, 160) || null,
  })).filter((o) => o.imie || o.email);
  if (!osoby.length) return json({ ok: false, error: "Lista jest pusta. Podaj co najmniej jedną osobę." }, 400);
  if (osoby.length > MAX_OSOB) return json({ ok: false, error: `Najwięcej ${MAX_OSOB} osób w jednym zgłoszeniu.` }, 400);
  const widziane = new Map<string, number>();
  for (let i = 0; i < osoby.length; i++) {
    const o = osoby[i];
    if (!o.imie) return json({ ok: false, error: `Podaj imię i nazwisko osoby nr ${i + 1}.` }, 400);
    if (o.email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(o.email)) return json({ ok: false, error: `Adres e-mail osoby nr ${i + 1} jest niepoprawny.` }, 400);
      if (widziane.has(o.email)) return json({ ok: false, error: `Osoby nr ${widziane.get(o.email)! + 1} i ${i + 1} mają ten sam e-mail. Link jest imienny, więc każda osoba potrzebuje własnego adresu.` }, 400);
      widziane.set(o.email, i);
    }
  }

  const { cena: c1 } = cenaOsoby(z, s);
  // link z testowej wiadomości do biura: pełna walidacja, ale bez zapisu i bez maili
  if (body.test === true) return json({ ok: true, test: true, liczba: osoby.length, kwota: !bezplatne(s) && c1 ? osoby.length * c1 : null });

  const poprz = osobyZeZgloszenia(z);
  const poprzN = Number(z.liczba_osob) || poprz.length;
  const teraz = new Date().toISOString();
  const historia = [...(Array.isArray(z.uczestnicy_historia) ? z.uczestnicy_historia : []),
    { at: teraz, liczba_osob: z.liczba_osob, uczestnicy: z.uczestnicy, uczestnicy_lista: z.uczestnicy_lista }].slice(-20);
  // warunek „jeszcze nie przesłano” w samym UPDATE: dwa równoczesne kliknięcia zapiszą się raz
  const up = await admin().from("zapisy_szkolenia").update({
    uczestnicy: osoby.map((o) => o.imie).join("\n"),
    uczestnicy_lista: osoby,
    liczba_osob: osoby.length,
    uczestnicy_uzupelnione_at: teraz,
    uczestnicy_historia: historia,
  }).eq("id", z.id).is("uczestnicy_uzupelnione_at", null).neq("status", "cancelled").select("id");
  if (up.error) { console.error(up.error); return json({ ok: false, error: "Nie udało się zapisać. Spróbuj ponownie za chwilę." }, 500); }
  if (!up.data?.length) return json({ ok: false, juz: true, error: "Lista uczestników została już przesłana. Zmiany prosimy zgłaszać na biuro@gig.org.pl." }, 409);

  const zPo = { ...z, liczba_osob: osoby.length } as Zapis;
  const b = mailDoBiura(zPo, s, poprz, poprzN, osoby);
  const p = mailPotwierdzenie(zPo, s, osoby);
  const [wb, wp] = await Promise.all([
    NOTIFY_EMAILS.length ? wyslijJeden(NOTIFY_EMAILS, b.subject, b.html, z.email) : Promise.resolve({ ok: true, info: null }),
    wyslijJeden([z.email], p.subject, p.html),
  ]);
  return json({ ok: true, liczba: osoby.length, kwota: !bezplatne(s) && cena ? osoby.length * cena : null, czlonkowska,
    maile: { biuro: wb.ok, organizacja: wp.ok } });
}

// ── tryby panelu ──────────────────────────────────────────────
async function panel(req: Request, body: Record<string, unknown>): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ ok: false, error: "brak uprawnien" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await sb.auth.getUser(jwt);
  if (uErr || !u?.user?.email) return json({ ok: false, error: "brak uprawnien" }, 401);
  if (!await sesjaPoKodzie(jwt)) return json({ ok: false, error: "sesja bez potwierdzenia kodem z e-maila - zaloguj sie ponownie" }, 401);
  const kto = u.user.email;
  const db = admin();

  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!ids.length) return json({ ok: false, error: "nie wskazano zgłoszeń" }, 400);
  if (ids.length > 200) return json({ ok: false, error: "za dużo zgłoszeń naraz (max 200)" }, 400);
  const q = await db.from("zapisy_szkolenia").select("*").in("id", ids);
  if (q.error) return json({ ok: false, error: q.error.message }, 500);
  const zapisy = ((q.data ?? []) as Zapis[]).filter((z) => z.status !== "cancelled");
  if (!zapisy.length) return json({ ok: false, error: "brak aktywnych zgłoszeń" }, 400);
  zapisy.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  // token nadajemy przy pierwszym podglądzie/wysyłce; link działa potem stale
  async function token(z: Zapis): Promise<string> {
    if (z.uczestnicy_token) return z.uczestnicy_token;
    const t = nowyToken();
    const r = await db.from("zapisy_szkolenia").update({ uczestnicy_token: t }).eq("id", z.id).is("uczestnicy_token", null);
    if (r.error) throw new Error(r.error.message);
    const again = await db.from("zapisy_szkolenia").select("uczestnicy_token").eq("id", z.id).single();
    z.uczestnicy_token = (again.data?.uczestnicy_token as string) ?? t;
    return z.uczestnicy_token;
  }

  if (body.tryb === "podglad") {
    const z = zapisy[0];
    const s = await szkolenieDla(z.szkolenie);
    const t = await token(z);
    const m = mailProsba(z, s, `${SITE}/uczestnicy/?t=${encodeURIComponent(t)}`);
    return json({ ok: true, subject: m.subject, html: m.html, do: z.email, link: `${SITE}/uczestnicy/?t=${encodeURIComponent(t)}&test=1` });
  }

  if (body.tryb === "wyslij") {
    const test = body.test === true;
    const wyniki: Array<{ id: string; email: string; ok: boolean; blad?: unknown }> = [];
    const pominiete: Array<{ id: string; powod: string }> = [];
    const cache = new Map<string, Szkolenie | null>();
    for (const z of (test ? zapisy.slice(0, 1) : zapisy)) {
      const k = kluczSzk(z.szkolenie);
      if (!cache.has(k)) cache.set(k, await szkolenieDla(z.szkolenie));
      const s = cache.get(k)!;
      if (!test) {
        if (s?.date_start && s.date_start < dzisWarszawa()) { pominiete.push({ id: z.id, powod: "termin minął" }); continue; }
        if (z.uczestnicy_uzupelnione_at) { pominiete.push({ id: z.id, powod: "lista już uzupełniona" }); continue; }
        // JEDNA prośba na zgłoszenie: rezerwujemy ją w bazie PRZED wysyłką (warunek w UPDATE),
        // więc podwójne kliknięcie, dwie karty panelu czy ponowienie żądania nie wyślą drugi raz
        const claim = await db.from("zapisy_szkolenia").update({ uczestnicy_prosba_at: new Date().toISOString() })
          .eq("id", z.id).is("uczestnicy_prosba_at", null).select("uczestnicy_prosba_at");
        if (claim.error) { wyniki.push({ id: z.id, email: z.email, ok: false, blad: claim.error.message }); continue; }
        if (!claim.data?.length) { pominiete.push({ id: z.id, powod: "prośba była już wysłana" }); continue; }
        z.uczestnicy_prosba_at = claim.data[0].uczestnicy_prosba_at as string;
      }
      const t = await token(z);
      const link = `${SITE}/uczestnicy/?t=${encodeURIComponent(t)}${test ? "&test=1" : ""}`;
      const m = mailProsba(z, s, link);
      const w = await wyslijJeden([test ? kto : z.email], (test ? "[TEST] " : "") + m.subject, m.html);
      // nieudana wysyłka zwalnia rezerwację, żeby dało się spróbować ponownie
      if (!w.ok && !test) await db.from("zapisy_szkolenia").update({ uczestnicy_prosba_at: null })
        .eq("id", z.id).eq("uczestnicy_prosba_at", z.uczestnicy_prosba_at!);
      wyniki.push({ id: z.id, email: test ? kto : z.email, ok: w.ok, ...(w.ok ? {} : { blad: w.info }) });
      if (!test) await new Promise((r) => setTimeout(r, 600));   // limit Resend ~2/s
    }
    return json({ ok: true, test, wyslane: wyniki.filter((w) => w.ok).length, bledy: wyniki.filter((w) => !w.ok), pominiete });
  }
  return json({ ok: false, error: "nieznany tryb" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "tylko POST" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "nieprawidlowe dane" }, 400); }
  try {
    if (body.tryb === "info" || body.tryb === "zapisz") return await publiczny(body);
    return await panel(req, body);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

// eksport do testów lokalnych (render maili)
export { mailProsba, mailPotwierdzenie, mailDoBiura, osobyZeZgloszenia };
