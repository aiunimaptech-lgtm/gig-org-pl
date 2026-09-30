// ============================================================
// GIG — Edge Function: send-confirmation
// Wysyła potwierdzenie do klienta po zapisie (newsletter / kontakt).
// Wyzwalane przez Database Webhook (INSERT na submissions_*).
//
// Sekrety (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY = re_xxxxxxxx
//   FROM_EMAIL     = Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>  (domena zweryfikowana w Resend)
//   NOTIFY_EMAILS  = biuro@gig.org.pl,jerzy.bryk@gmail.com   (opcjonalny; adresy po przecinku)
//   GIG_HOOK_TOKEN = <wartosc z private.gig_sekrety>          (opcjonalny; wlacza brame)
//
// Przy zgloszeniu z formularza kontaktowego ida DWA maile:
//   1. powiadomienie do GIG (NOTIFY_EMAILS) z trescia zgloszenia, Reply-To = nadawca,
//   2. potwierdzenie do nadawcy.
// Przy zapisie do newslettera idzie TYLKO potwierdzenie do zapisujacego sie.
// Powiadomien o zapisach nie wysylamy: bylo ich za duzo, a lista jest w panelu
// (Newsletter) i w Bazie e-mail (lista „Newsletter”).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1";

// Adresy, na ktore ida powiadomienia o nowych zgloszeniach. Trzymane w sekrecie,
// zeby dodanie/zmiana odbiorcy nie wymagala ponownego wdrozenia funkcji.
const NOTIFY_EMAILS = (Deno.env.get("NOTIFY_EMAILS") ?? "biuro@gig.org.pl,jerzy.bryk@gmail.com")
  .split(",").map((x) => x.trim()).filter(Boolean);

// Wspolny sekret miedzy triggerem w bazie a ta funkcja.
// Dopoki sekret NIE jest ustawiony, funkcja dziala jak dotad (zeby wdrozenie
// kodu nie przerwalo wysylki maili). Gdy sekret zostanie dodany w
// Supabase -> Edge Functions -> Secrets, ochrona wlacza sie sama.
// Wartosc po stronie bazy: private.gig_sekrety, klucz 'hook_token'.
const HOOK_TOKEN = Deno.env.get("GIG_HOOK_TOKEN") ?? "";

// Porownanie o stalym czasie - nie zdradza, ile pierwszych znakow sie zgadza.
function rowneStalyCzas(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let roznica = 0;
  for (let i = 0; i < a.length; i++) roznica |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return roznica === 0;
}

const C = { dark: "#16202a", mid: "#cc0a2b", light: "#f3ccd4", bg: "#fdecef" };
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Jasna szata z logo GIG — ta sama, co w mailach wysyłanych z panelu
   (wyslij-mail / wyslij-kampanie), żeby wszystko z Izby wyglądało spójnie.
   `zacheta` = stopka z linkiem do szkoleń i zapisem na newsletter; wyłączamy ją
   w powiadomieniach wewnętrznych i w samym potwierdzeniu zapisu na newsletter. */
function layout(title: string, body: string, zacheta = true): string {
  const stopkaZacheta = zacheta
    ? `<p style="margin:12px 0 0;font-size:12px;color:#7a8b97;line-height:1.7;">
          Więcej informacji o szkoleniach znajdziesz na stronie <a href="https://gig.org.pl/szkolenia/" style="color:${C.mid};text-decoration:none;">gig.org.pl/szkolenia</a>.<br>
          Chcesz być na bieżąco ze szkoleniami i wydarzeniami Izby? <a href="https://gig.org.pl/" style="color:${C.mid};text-decoration:none;">Zapisz się do newslettera GIG</a>.
        </p>`
    : "";
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <tr><td style="padding:26px 34px 18px;background:#ffffff;">
        <img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="height:3px;background:${C.mid};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;font-size:15px;line-height:1.65;color:#38444e;">
        <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${C.dark};font-weight:800;">${title}</h1>
        ${body}
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:${C.dark};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${C.mid};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${C.mid};text-decoration:none;">gig.org.pl</a>
        </p>
        ${stopkaZacheta}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function newsletterMail(rec: Record<string, unknown>) {
  const unsub = `${FUNCTIONS_BASE}/newsletter-unsubscribe?id=${rec.id ?? ""}`;
  const adres = (rec.email as string) || "";
  const body = `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    <p style="margin:0 0 14px;">potwierdzamy zapisanie adresu${adres ? ` <strong>${esc(adres)}</strong>` : ""} do newslettera <strong>Geodezyjnej Izby Gospodarczej</strong>.</p>
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Co będziesz otrzymywać</p>
      <p style="margin:0;font-size:14px;line-height:1.7;">
        &bull; terminy i programy szkoleń Izby,<br>
        &bull; aktualności Izby,<br>
        &bull; zaproszenia na wydarzenia branżowe.
      </p>
    </div>
    <p style="margin:0 0 14px;">Najbliższe szkolenia znajdziesz na stronie <a href="https://gig.org.pl/szkolenia/" style="color:${C.mid};text-decoration:none;">gig.org.pl/szkolenia</a>.</p>
    <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">
      Nie chcesz otrzymywać newslettera? <a href="${unsub}" style="color:#9aa7b2;text-decoration:underline;">Wypisz się jednym kliknięciem</a>.
    </p>`;
  return { subject: "Potwierdzenie zapisu do newslettera GIG", html: layout("Zapis potwierdzony ✓", body, false) };
}

function kontaktMail(rec: Record<string, unknown>) {
  const name = (rec.name as string) || "";
  const greet = name && name !== "Anonim" ? `Szanowny/a ${esc(name)},` : "Dzień dobry,";
  const msg = (rec.message as string) || "";
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${greet}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">dziękujemy za kontakt z Geodezyjną Izbą Gospodarczą. Odpowiemy najszybciej, jak to możliwe.</p>
    ${msg ? `<div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Twoja wiadomość:</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(msg)}</p></div>` : ""}`;
  return { subject: "Otrzymaliśmy Twoją wiadomość - GIG", html: layout("Wiadomość przyjęta ✓", body) };
}

/* Potwierdzenie wniosku czlonkowskiego: od razu prosimy o wydruk z CEIDG/KRS
   i o potwierdzenie przelewu wpisowego - bez tych dwoch rzeczy Rada i tak nie
   rozpatrzy wniosku, a tak zalatwiamy je jedna wiadomoscia.
   Wpisowe: uchwala Rady o przyjeciu wchodzi w zycie pod warunkiem jego uiszczenia
   (art. 12 pkt 1 Statutu). Kwota i konto sa tu na sztywno - zmieniaja sie raz na
   lata, a w sekrecie biuro nie zobaczyloby, co poszlo w mailu. */
const WPISOWE_KWOTA = "75,00 zł";
const WPISOWE_KONTO = "61 1240 6175 1111 0000 4574 9045";
const WPISOWE_BANK = "Bank PEKAO SA Oddział w Warszawie";
const WPISOWE_DNI = 7;   // termin liczony od zgloszenia; tyle samo co domyslny termin opinii Prezydium

function czlonkostwoMail(rec: Record<string, unknown>) {
  const name = (rec.name as string) || "";
  const greet = name && name !== "Anonim" ? `Szanowni Państwo, ${esc(name)},` : "Dzień dobry,";
  const msg = (rec.message as string) || "";
  // poludnie UTC, zeby dataPL (czyta czesci UTC) nie cofnela dnia przy mailu wyslanym nad ranem
  const termin = new Date(Date.now() + WPISOWE_DNI * 86400000);
  termin.setUTCHours(12, 0, 0, 0);
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${greet}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">dziękujemy za złożenie akcesu członkowskiego do Geodezyjnej Izby Gospodarczej. Wniosek trafił do biura Izby.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Do rozpatrzenia wniosku przez Radę Izby potrzebujemy jeszcze dwóch rzeczy. Prosimy o przesłanie ich razem,
      w odpowiedzi na tę wiadomość albo na adres <a href="mailto:biuro@gig.org.pl" style="color:${C.mid};">biuro@gig.org.pl</a>,
      <strong>do dnia ${esc(dataPL(termin))}</strong>.</p>
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">1. Dokument rejestrowy firmy</p>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">Dokument potwierdzający status prawny firmy:
      <strong>wydruk z CEIDG lub odpis z rejestru przedsiębiorców KRS</strong>.</p>
      <p style="margin:0;font-size:14px;line-height:1.6;">Pobiorą go Państwo bezpłatnie ze strony
      <a href="https://wyszukiwarka-krs.ms.gov.pl/" style="color:${C.mid};">wyszukiwarka-krs.ms.gov.pl</a> (spółki wpisane do KRS) lub
      <a href="https://aplikacja.ceidg.gov.pl/CEIDG/Index.aspx" style="color:${C.mid};">ceidg.gov.pl</a> (jednoosobowa działalność gospodarcza).</p>
    </div>
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">2. Potwierdzenie przelewu opłaty wpisowej</p>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">Opłata wpisowa wynosi <strong>${WPISOWE_KWOTA}</strong>. Prosimy o jej uiszczenie na konto Izby
      i przesłanie potwierdzenia przelewu razem z dokumentem rejestrowym.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
        <tr><td style="padding:2px 12px 2px 0;color:#6b7c8c;white-space:nowrap;">Odbiorca</td><td style="padding:2px 0;">Geodezyjna Izba Gospodarcza<br>ul. Czackiego 3/5, 00-043 Warszawa</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7c8c;white-space:nowrap;">Bank</td><td style="padding:2px 0;">${WPISOWE_BANK}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7c8c;white-space:nowrap;">Numer rachunku</td><td style="padding:2px 0;"><strong style="letter-spacing:.4px;">${WPISOWE_KONTO}</strong></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7c8c;white-space:nowrap;">Tytuł przelewu</td><td style="padding:2px 0;">Opłata wpisowa GIG${name && name !== "Anonim" ? " - " + esc(name) : ""}</td></tr>
      </table>
    </div>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Po otrzymaniu kompletu dokumentów kandydaturę opiniuje Prezydium Rady Izby, a następnie Rada Izby podejmuje uchwałę
      o przyjęciu w poczet członków (art. 12 pkt 1 Statutu Izby). O decyzji poinformujemy Państwa mailem.</p>
    ${msg ? `<div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Dane z wniosku:</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(msg)}</p></div>` : ""}`;
  return { subject: "Otrzymaliśmy wniosek o członkostwo w GIG", html: layout("Wniosek przyjęty ✓", body) };
}

/* Klient po zapisie na szkolenie zostawil zaznaczona opcje "chce wiedziec wiecej
   o czlonkostwie" (strona /zapisy/). Potwierdzamy, mowimy co dalej i od razu
   podajemy, czego bedzie trzeba do wniosku - zeby biuro nie musialo tego pisac. */
function zainteresowanieMail(rec: Record<string, unknown>) {
  const name = (rec.name as string) || "";
  const greet = name && name !== "Anonim" ? `Szanowni Państwo, ${esc(name)},` : "Dzień dobry,";
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${greet}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">dziękujemy za zainteresowanie członkostwem w Geodezyjnej Izbie Gospodarczej, największej organizacji przedsiębiorców geodezyjnych w Polsce. Biuro Izby skontaktuje się z Państwem w najbliższych dniach.</p>
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Co zyskuje członek Izby</p>
      <p style="margin:0;font-size:14px;line-height:1.7;">
        &bull; interwencje w sprawach z ośrodkami dokumentacji i nadzorem geodezyjnym,<br>
        &bull; szkolenia w cenie członkowskiej, część bezpłatnie,<br>
        &bull; Węzeł Jakości: rynkowe stawki prac geodezyjnych w układzie SEKOCENBUD,<br>
        &bull; opiniowanie projektów przepisów i postulaty do Głównego Geodety Kraju,<br>
        &bull; wizytówka firmy w katalogu Członków na gig.org.pl.
      </p>
    </div>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Jeśli chcą Państwo od razu złożyć wniosek, formularz jest na stronie
      <a href="https://gig.org.pl/dolacz-do-nas/" style="color:${C.mid};">gig.org.pl/dolacz-do-nas</a>. Do rozpatrzenia wniosku potrzebny jest
      <strong>wydruk z CEIDG lub odpis z KRS</strong> oraz potwierdzenie przelewu opłaty wpisowej (${WPISOWE_KWOTA}), które prosimy przesłać na
      <a href="mailto:biuro@gig.org.pl" style="color:${C.mid};">biuro@gig.org.pl</a>.
      Dokument pobiorą Państwo bezpłatnie ze strony <a href="https://wyszukiwarka-krs.ms.gov.pl/" style="color:${C.mid};">wyszukiwarka-krs.ms.gov.pl</a>
      lub <a href="https://aplikacja.ceidg.gov.pl/CEIDG/Index.aspx" style="color:${C.mid};">ceidg.gov.pl</a>.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Składka członkowska wynosi 40 zł miesięcznie dla firmy jednoosobowej, 80 zł dla firmy do 5 osób
      i 160 zł dla firmy powyżej 5 osób.</p>
    <p style="margin:0;font-size:13px;color:#6b7c8c;line-height:1.6;">Silni wiedzą, zjednoczeni działaniem.</p>`;
  return { subject: "Członkostwo w GIG: dziękujemy za zainteresowanie", html: layout("Dziękujemy za zainteresowanie", body) };
}

/* Rodzaj zgloszenia rozpoznajemy po prefiksie tematu, ktory ustawia
   forms_integration.js: zapis na szkolenie, akces czlonkowski albo zwykly kontakt. */
function rodzaj(subject: string): string {
  if (/^Zapis na szkolenie:/i.test(subject)) return "Zapis na szkolenie";
  if (/^Zgłoszenie członkowskie:/i.test(subject)) return "Zgłoszenie członkowskie";
  if (/^Zainteresowanie członkostwem:/i.test(subject)) return "Zainteresowanie członkostwem";
  return "Wiadomość z formularza kontaktowego";
}

/* Powiadomienie wewnetrzne dla GIG. Reply-To ustawiamy na adres nadawcy,
   wiec odpowiedz z klienta poczty trafia wprost do niego. */
function notifyMail(rec: Record<string, unknown>) {
  const subject = (rec.subject as string) || "";
  const typ = rodzaj(subject);
  const name = (rec.name as string) || "-";
  const from = (rec.email as string) || "-";
  const msg = (rec.message as string) || "";
  const kiedy = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

  const wiersz = (etykieta: string, wartosc: string) => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${etykieta}</td>
      <td style="padding:6px 0;font-size:14px;color:${C.dark};">${wartosc}</td>
    </tr>`;

  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Nowe zgłoszenie ze strony <strong>gig.org.pl</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">
      ${wiersz("Rodzaj", `<strong>${esc(typ)}</strong>`)}
      ${wiersz("Od", esc(name))}
      ${wiersz("E-mail", `<a href="mailto:${esc(from)}" style="color:${C.mid};">${esc(from)}</a>`)}
      ${subject ? wiersz("Temat", esc(subject)) : ""}
      ${wiersz("Otrzymano", esc(kiedy))}
    </table>
    ${msg ? `<div style="margin:0 0 18px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Treść zgłoszenia</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(msg)}</p></div>` : ""}
    <p style="margin:0;font-size:13px;color:#6b7c8c;">
      Odpowiadając na tego maila, piszesz bezpośrednio do nadawcy.
      Zgłoszenie jest też w <a href="https://gig.org.pl/admin/" style="color:${C.mid};">panelu GIG</a>.
    </p>`;

  return {
    subject: `[GIG] ${typ}${name && name !== "-" ? ": " + name : ""}`,
    html: layout("Nowe zgłoszenie", body, false),
  };
}

/* --- ZAPISY NA SZKOLENIA (tabela zapisy_szkolenia) --------------------- */

function wierszTabeli(etykieta: string, wartosc: string): string {
  if (!wartosc) return "";
  return `<tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${etykieta}</td>
      <td style="padding:6px 0;font-size:14px;color:${C.dark};">${wartosc}</td>
    </tr>`;
}

/* Uczestnicy: przy szkoleniu płatnym formularz zbiera imię i e-mail każdej osoby
   (uczestnicy_lista), bo link do szkolenia idzie do uczestnika, a sprawy zgłoszenia
   i faktura do kontaktu organizacji (rec.email). Starsze zgłoszenia mają same nazwiska. */
function listaUczestnikow(rec: Record<string, unknown>): string {
  const l = rec.uczestnicy_lista;
  if (Array.isArray(l) && l.length) {
    return l.map((o: Record<string, unknown>) =>
      `${esc(String(o.imie ?? "").trim())}${o.email ? ` &middot; <a href="mailto:${esc(String(o.email))}" style="color:${C.mid};">${esc(String(o.email))}</a>` : ""}`)
      .join("<br>");
  }
  return esc(String(rec.uczestnicy ?? "").trim()).replace(/\n/g, "<br>");
}
function liczbaZ(txt: string | null | undefined): number | null {
  const n = String(txt ?? "").replace(/\s/g, "").match(/\d+(?:[.,]\d+)?/);
  return n ? parseFloat(n[0].replace(",", ".")) : null;
}
function zl(x: number): string {
  return x.toLocaleString("pl-PL", { maximumFractionDigits: 2 }) + " zł";
}
/* Kwota: liczba osób × cena; członek Izby (rozpoznany przez bazę przy zapisie) płaci cenę członkowską. */
function kwota(rec: Record<string, unknown>, szk: Szkolenie | null): string {
  const ile = Number(rec.liczba_osob) || 1;
  const czl = rec.czlonek_gig === true && !!liczbaZ(szk?.price_member);
  const c = czl ? liczbaZ(szk?.price_member) : liczbaZ(szk?.price);
  if (!c) return "";
  return `${ile} × ${zl(c)} = <strong>${zl(ile * c)}</strong>${czl ? " (cena członkowska)" : ""}`;
}

/* Powiadomienie dla GIG: komplet danych potrzebnych do wystawienia faktury,
   zeby nie trzeba bylo wchodzic do panelu przy kazdym zgloszeniu. */
function zapisNotifyMail(rec: Record<string, unknown>, szk: Szkolenie | null) {
  const bezpl = cenaZerowa(szk?.price);
  const s = (k: string) => String(rec[k] ?? "").trim();
  const szkolenie = s("szkolenie") || "(nie podano)";
  const takiSam = rec.odbiorca_taki_sam !== false;
  const jst = rec.nabywca_jst === true;
  const osoba = rec.nabywca_typ === "osoba";   // osoba prywatna: rachunek zamiast faktury
  const faktura = rec.faktura_kiedy === "po" ? "po szkoleniu"
    : (rec.faktura_kiedy === "przed" ? "przed szkoleniem" : "");

  const blok = (tytul: string, tresc: string) => `
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">${tytul}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${tresc}</table>
    </div>`;

  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">${bezpl ? "Nowe zgłoszenie na bezpłatne wydarzenie" : "Nowe zgłoszenie na szkolenie"} <strong>${esc(szkolenie)}</strong>.</p>

    ${blok("Uczestnicy",
      wierszTabeli("Liczba osób", esc(s("liczba_osob"))) +
      wierszTabeli(Array.isArray(rec.uczestnicy_lista) ? "Uczestnicy (e-mail do linku)" : "Imiona i nazwiska", listaUczestnikow(rec)) +
      (bezpl ? "" : wierszTabeli("Kwota", kwota(rec, szk))))}

    ${osoba
      ? blok("Osoba prywatna: RACHUNEK (nie faktura)",
          wierszTabeli("Imię i nazwisko", esc(s("nabywca_nazwa"))) +
          wierszTabeli("Adres", esc(s("nabywca_adres"))) +
          wierszTabeli("Dokument", "<strong>rachunek</strong>, płatność przed szkoleniem"))
      : blok(bezpl ? "Firma lub instytucja (bez faktury)" : "Nabywca",
      wierszTabeli("Nazwa", esc(s("nabywca_nazwa"))) +
      wierszTabeli("Adres", esc(s("nabywca_adres"))) +
      wierszTabeli("NIP", esc(s("nabywca_nip"))) +
      (bezpl ? "" : wierszTabeli("Jednostka samorządu", jst ? "<strong>TAK</strong>" : "nie")) +
      wierszTabeli("Członek GIG", rec.czlonek_gig === true
        ? `<strong>TAK</strong> (dopasowanie: ${esc(s("czlonek_sposob"))})`
        : (rec.czlonek_gig === false ? "nie" : "")) +
      wierszTabeli("Faktura", bezpl ? "nie (udział bezpłatny)" : faktura))}

    ${bezpl || osoba ? "" : takiSam
      ? blok("Odbiorca", wierszTabeli("Odbiorca", "taki sam jak nabywca"))
      : blok("Odbiorca",
          wierszTabeli("Nazwa", esc(s("odbiorca_nazwa"))) +
          wierszTabeli("Adres", esc(s("odbiorca_adres"))) +
          wierszTabeli("NIP / ID-wewn.", esc(s("odbiorca_nip"))))}

    ${blok("Kontakt",
      wierszTabeli("E-mail", `<a href="mailto:${esc(s("email"))}" style="color:${C.mid};">${esc(s("email"))}</a>`) +
      wierszTabeli("Telefon", esc(s("telefon"))) +
      wierszTabeli("Uwagi", esc(s("uwagi")).replace(/\n/g, "<br>")))}

    <p style="margin:0;font-size:13px;color:#6b7c8c;">
      Odpowiadając na tego maila, piszesz bezpośrednio do zgłaszającego.
      Zgłoszenie jest też w <a href="https://gig.org.pl/admin/" style="color:${C.mid};">panelu GIG</a>.
    </p>`;

  return {
    subject: `[GIG] ${bezpl ? "Zapis na wydarzenie" : "Zapis na szkolenie"}: ${s("nabywca_nazwa") || s("email")}`,
    html: layout(bezpl ? "Nowy zapis na wydarzenie" : "Nowy zapis na szkolenie", body, false),
  };
}

/* "7 października 2026 r." — miesiac w dopelniaczu, bo tak pisze sie daty po polsku. */
const MIESIACE = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
function dataPL(d: Date): string {
  return `${d.getUTCDate()} ${MIESIACE[d.getUTCMonth()]} ${d.getUTCFullYear()} r.`;
}
/* date_start to sam dzien (YYYY-MM-DD); liczymy w UTC, zeby strefa nie przesunela doby. */
function dzienPrzed(dateStart: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) return null;
  const d = new Date(dateStart + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

type Szkolenie = { date_start: string | null; time_range: string | null; is_online: boolean | null; platnosc: string | null; price: string | null; price_member: string | null };

/* Wydarzenie bezplatne (np. Forum z GUGiK): cena dla uczestnikow spoza Izby jest
   zerowa albo brzmi „bezplatne". Wtedy nie ma faktury ani przelewu - ta sama
   regula co w formularzu /zapisy/ i w panelu (cenaLiczba). */
function cenaZerowa(txt: string | null | undefined): boolean {
  const t = String(txt ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (/bezp[\u0142l]at|nieodp[\u0142l]at|gratis/.test(t)) return true;
  const n = t.replace(/\s/g, "").match(/\d+(?:[.,]\d+)?/);
  return !!n && parseFloat(n[0].replace(",", ".")) === 0;
}

/* Zgloszenie nie ma klucza do szkolenia — laczymy po tytule, jak w panelu
   (bez wielkosci liter i spacji na brzegach). Brak dopasowania = mail bez
   terminu i bez bloku platnosci, ale nadal wychodzi. */
async function pobierzSzkolenie(tytul: string): Promise<Szkolenie | null> {
  const t = tytul.trim();
  if (!t) return null;
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const r = await db.from("szkolenia")
      .select("date_start,time_range,is_online,platnosc,price,price_member")
      .ilike("title", t.replace(/[%_]/g, (m) => "\\" + m))
      .limit(1).maybeSingle();
    if (r.error) { console.error("szkolenia:", r.error.message); return null; }
    return (r.data as Szkolenie | null) ?? null;
  } catch (err) {
    console.error("szkolenia (wyjatek):", err);
    return null;
  }
}

/* Potwierdzenie dla zglaszajacego. Trzy rzeczy, ktore ma zalatwic:
   1) kiedy przyjdzie link do logowania (dzien przed szkoleniem — liczony z daty),
   2) jak platnosc: firmy i osoby prywatne PRZED szkoleniem (z numerem konta),
      jednostki rzadowe/samorzadowe PO, wg terminu z faktury; faktura idzie do KSeF,
   3) komplet podanych danych — zglaszajacy ma szanse wychwycic literowke
      w NIP-ie czy nazwisku, zanim wystawimy fakture. */
function zapisPotwierdzenieMail(rec: Record<string, unknown>, szk: Szkolenie | null) {
  const s = (k: string) => String(rec[k] ?? "").trim();
  const bezpl = cenaZerowa(szk?.price);
  const szkolenie = s("szkolenie");
  const takiSam = rec.odbiorca_taki_sam !== false;
  const jst = rec.nabywca_jst === true;
  const osoba = rec.nabywca_typ === "osoba";   // osoba prywatna: rachunek zamiast faktury
  const faktura = rec.faktura_kiedy === "po" ? "po szkoleniu"
    : (rec.faktura_kiedy === "przed" ? "przed szkoleniem" : "");

  // termin szkolenia + dzien wysylki linku
  const start = szk?.date_start ? dzienPrzed(szk.date_start) : null;
  const dataSzk = szk?.date_start ? dataPL(new Date(szk.date_start + "T12:00:00Z")) : "";
  const termin = dataSzk ? ` w dniu ${dataSzk}${szk?.time_range ? `, godz. ${esc(szk.time_range)}` : ""}` : "";
  const online = szk?.is_online !== false;
  const kazdy = Array.isArray(rec.uczestnicy_lista) && (rec.uczestnicy_lista as unknown[]).length > 0;
  const linkInfo = online && kazdy && !bezpl
    ? (start
        ? `Link do logowania prześlemy <strong>${dataPL(start)}</strong>, czyli dzień przed terminem, <strong>każdemu uczestnikowi na jego adres e-mail</strong> podany w zgłoszeniu.`
        : `Link do logowania prześlemy dzień przed terminem każdemu uczestnikowi na jego adres e-mail podany w zgłoszeniu.`)
    : online
    ? (start
        ? `Link do ${bezpl ? "spotkania" : "logowania na szkolenie"} prześlemy <strong>${dataPL(start)}</strong>, czyli dzień przed terminem.`
        : `Link do ${bezpl ? "spotkania" : "logowania na szkolenie"} prześlemy dzień przed jego terminem.`)
    : (start
        ? `Szczegóły organizacyjne prześlemy <strong>${dataPL(start)}</strong>, czyli dzień przed terminem.`
        : `Szczegóły organizacyjne prześlemy dzień przed terminem szkolenia.`);

  // platnosc — inna dla firm/osob, inna dla jednostek rzadowych i samorzadowych
  const przelew = szk?.platnosc
    ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.7;">${esc(szk.platnosc).replace(/\n/g, "<br>")}</p>`
    : "";
  const platnosc = jst
    ? `<p style="margin:0;font-size:14px;line-height:1.7;">Jednostki rządowe i samorządowe: <strong>płatność po szkoleniu</strong>, zgodnie z terminem określonym na fakturze.</p>`
      + (rec.faktura_kiedy === "przed"
          ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.7;">Zgodnie z Państwa wyborem fakturę wystawimy <strong>przed szkoleniem</strong>.</p>` + przelew
          : "")
    : `<p style="margin:0;font-size:14px;line-height:1.7;">Firmy geodezyjne oraz indywidualnych uczestników szkolenia prosimy o dokonanie <strong>opłaty przed szkoleniem</strong>.</p>` + przelew;

  const blok = (tytul: string, tresc: string) => tresc ? `
    <div style="margin:0 0 14px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">${tytul}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${tresc}</table>
    </div>` : "";

  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Dzień dobry,</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">
      potwierdzamy przyjęcie zgłoszenia${szkolenie ? ` na ${bezpl ? "" : "szkolenie "}<strong>${esc(szkolenie)}</strong>${termin}` : ""}.</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;">${linkInfo}</p>

    ${bezpl
      ? blok("Udział", `<tr><td colspan="2" style="padding:2px 0;color:${C.dark};"><p style="margin:0;font-size:14px;line-height:1.7;">Udział jest <strong>bezpłatny</strong>. Nie wystawiamy faktury i nie prosimy o żadną wpłatę.</p></td></tr>`)
      : blok("Płatność", `<tr><td colspan="2" style="padding:2px 0;color:${C.dark};">${kwota(rec, szk) ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.7;">Do zapłaty: ${kwota(rec, szk)}. Opłata dotyczy każdego uczestnika; wszystkich ujmujemy na ${osoba ? "jednym rachunku wystawionym na osobę podaną w zgłoszeniu" : "jednej fakturze wystawionej na nabywcę"}.</p>` : ""}${platnosc}
      <p style="margin:10px 0 0;font-size:14px;line-height:1.7;">${osoba ? "Wystawimy <strong>rachunek</strong> na osobę prywatną podaną w zgłoszeniu." : "Faktura zostanie wysłana do <strong>KSeF</strong>."}</p></td></tr>`)}

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Poniżej dane, które otrzymaliśmy. Prosimy o ich sprawdzenie:</p>

    ${blok("Uczestnicy",
      wierszTabeli("Liczba osób", esc(s("liczba_osob"))) +
      wierszTabeli(kazdy ? "Uczestnicy (e-mail do linku)" : "Imiona i nazwiska", listaUczestnikow(rec)))}

    ${osoba
      ? blok("Dane do rachunku",
          wierszTabeli("Imię i nazwisko", esc(s("nabywca_nazwa"))) +
          wierszTabeli("Adres", esc(s("nabywca_adres"))))
      : blok(bezpl ? "Firma lub instytucja" : "Nabywca (dane do faktury)",
      wierszTabeli("Nazwa", esc(s("nabywca_nazwa"))) +
      wierszTabeli("Adres", esc(s("nabywca_adres"))) +
      wierszTabeli("NIP", esc(s("nabywca_nip"))) +
      (bezpl ? "" : wierszTabeli("Jednostka samorządu", jst ? "TAK" : "nie") +
      wierszTabeli("Faktura", faktura)))}

    ${bezpl || osoba ? "" : takiSam
      ? blok("Odbiorca", wierszTabeli("Odbiorca", "taki sam jak nabywca"))
      : blok("Odbiorca",
          wierszTabeli("Nazwa", esc(s("odbiorca_nazwa"))) +
          wierszTabeli("Adres", esc(s("odbiorca_adres"))) +
          wierszTabeli("NIP / ID-wewn.", esc(s("odbiorca_nip"))))}

    ${blok("Kontakt",
      wierszTabeli("E-mail", esc(s("email"))) +
      wierszTabeli("Telefon", esc(s("telefon"))) +
      wierszTabeli("Uwagi", esc(s("uwagi")).replace(/\n/g, "<br>")))}

    <p style="margin:18px 0 0;font-size:13px;color:#6b7c8c;line-height:1.6;">
      ${bezpl ? "Jeśli któraś dana jest niepoprawna, odpisz na tę wiadomość, a poprawimy ją."
        : `Jeśli któraś dana jest niepoprawna, odpisz na tę wiadomość, a poprawimy ją przed wystawieniem ${osoba ? "rachunku" : "faktury"}.`}</p>`;
  return { subject: bezpl ? "Potwierdzenie zgłoszenia - GIG" : "Potwierdzenie zgłoszenia na szkolenie - GIG", html: layout("Zgłoszenie przyjęte ✓", body) };
}

/* Jedno wywolanie Resend. Zwraca blad zamiast rzucac, zeby niepowodzenie
   jednego maila nie blokowalo wyslania drugiego. */
async function wyslij(
  to: string[],
  mail: { subject: string; html: string },
  replyTo?: string,
): Promise<{ ok: boolean; info: unknown }> {
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL, to, subject: mail.subject, html: mail.html,
  };
  if (replyTo) payload.reply_to = replyTo;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const wynik = await res.json();
    if (!res.ok) console.error("Resend:", wynik);
    return { ok: res.ok, info: wynik };
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return { ok: false, info: String(err) };
  }
}

Deno.serve(async (req) => {
  try {
    // Brama: klucz publiczny (anon) jest jawny na stronie, wiec sam w sobie
    // nie dowodzi, ze wywolanie pochodzi z naszego triggera. Gdy sekret jest
    // ustawiony, wymagamy zgodnego naglowka - inaczej mozna by tym kanalem
    // wysylac maile z domeny Izby na dowolny adres.
    if (HOOK_TOKEN) {
      const podany = req.headers.get("x-gig-token") ?? "";
      if (!rowneStalyCzas(podany, HOOK_TOKEN)) {
        return new Response(JSON.stringify({ error: "brak uprawnien" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const payload = await req.json();
    const table = payload.table as string;
    const rec = (payload.record ?? {}) as Record<string, unknown>;
    const nadawca = (rec.email as string) || "";
    if (!nadawca) return new Response(JSON.stringify({ skipped: "brak email" }), { status: 200 });

    const wyniki: Record<string, unknown> = {};

    if (table === "submissions_kontakt") {
      // 1) powiadomienie do GIG — Reply-To na nadawce, zeby dalo sie odpisac wprost
      if (NOTIFY_EMAILS.length) {
        const r = await wyslij(NOTIFY_EMAILS, notifyMail(rec), nadawca);
        wyniki.powiadomienie = r.ok ? "wyslane" : r.info;
      }
      // 2) potwierdzenie dla nadawcy - wniosek czlonkowski ma wlasna tresc (CEIDG/KRS + wpisowe)
      const temat = String(rec.subject ?? "");
      const potwierdzenie = /^Zgłoszenie członkowskie:/i.test(temat) ? czlonkostwoMail(rec)
        : (/^Zainteresowanie członkostwem:/i.test(temat) ? zainteresowanieMail(rec) : kontaktMail(rec));
      const p = await wyslij([nadawca], potwierdzenie);
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else if (table === "zapisy_szkolenia") {
      // szkolenie pobieramy od razu: od ceny zalezy, czy oba maile mowia o fakturze
      const szk = await pobierzSzkolenie(String(rec.szkolenie ?? ""));
      // 1) powiadomienie do GIG z kompletem danych do faktury (albo bez, gdy udzial bezplatny)
      if (NOTIFY_EMAILS.length) {
        const r = await wyslij(NOTIFY_EMAILS, zapisNotifyMail(rec, szk), nadawca);
        wyniki.powiadomienie = r.ok ? "wyslane" : r.info;
      }
      // 2) potwierdzenie dla zglaszajacego — z terminem linku i platnoscia ze szkolenia
      const p = await wyslij([nadawca], zapisPotwierdzenieMail(rec, szk));
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else if (table === "submissions_newsletter") {
      // tylko potwierdzenie dla zapisujacego sie; powiadomien do GIG nie wysylamy
      const p = await wyslij([nadawca], newsletterMail(rec));
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else {
      return new Response(JSON.stringify({ skipped: `tabela ${table}` }), { status: 200 });
    }

    // 200 nawet przy czesciowym niepowodzeniu: webhook Supabase nie ma sensownego
    // ponawiania, a szczegoly i tak trafiaja do logow funkcji.
    return new Response(JSON.stringify({ ok: true, ...wyniki }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
