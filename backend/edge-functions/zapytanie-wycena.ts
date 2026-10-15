// ============================================================
// GIG — Edge Function: zapytanie-wycena (v1, 15.10.2026)
// Kalkulator /ile-kosztuje-geodezja/: klient wysyła jedno zapytanie o wycenę do kilku
// firm członkowskich z regionu. Każda firma dostaje osobny mail (Reply-To = klient),
// klient dostaje potwierdzenie z listą firm i ich kontaktami.
//
// Publiczna (verify_jwt = false). Zabezpieczenia:
//   - adresy firm bierzemy z tabeli czlonkowie po id (tylko opublikowani), nigdy z formularza,
//   - maks. 8 firm w zapytaniu, 3 zapytania na adres e-mail i 10 na IP w ciągu doby,
//   - pułapka na roboty (pole `www` musi być puste) i minimalny czas wypełniania (6 s).
// Zapis: tabela zapytania_wyceny (backend/supabase_zapytania_wyceny.sql), podgląd w /admin/wyceny.html.
// Sekrety: RESEND_API_KEY, FROM_EMAIL; SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY wstrzykiwane.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const RED = "#cc0a2b", DARK = "#16202a";
const MAX_FIRM = 8, LIMIT_EMAIL = 3, LIMIT_IP = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tekst = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const wsp = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function layout(title: string, body: string, stopka: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:26px 34px 18px;"><img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;"></td></tr>
      <tr><td style="height:3px;background:${RED};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:28px 34px 24px;font-size:15px;line-height:1.65;color:#38444e;">
        <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${DARK};font-weight:800;">${esc(title)}</h1>
        ${body}
        <div style="margin:22px 0 0;padding-top:14px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">${stopka}</div>
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:18px 34px;border-top:1px solid #e6ebef;font-size:12px;color:#7a8b97;line-height:1.7;">
        <strong style="color:${DARK};">Geodezyjna Izba Gospodarcza</strong><br>
        ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43 &middot;
        <a href="mailto:biuro@gig.org.pl" style="color:${RED};text-decoration:none;">biuro@gig.org.pl</a> &middot;
        <a href="https://gig.org.pl" style="color:${RED};text-decoration:none;">gig.org.pl</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const wiersz = (k: string, v: string) => v
  ? `<tr><td style="padding:5px 14px 5px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:5px 0;font-size:14px;color:${DARK};">${v}</td></tr>`
  : "";

async function wyslij(to: string, subject: string, html: string, replyTo: string) {
  for (let proba = 0; proba < 3; proba++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: replyTo }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (proba + 1))); continue; }
    const w = await res.json().catch(() => ({}));
    if (!res.ok) console.error("Resend:", to, w);
    return res.ok;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Nieprawidłowe dane." }, 400); }

  // pułapka i czas wypełniania: roboty wypełniają wszystko i wysyłają od razu
  if (tekst(b.www, 200) !== "" || Number(b.czas) < 6000) return json({ ok: true, wyslano: 0 });

  const usluga = tekst(b.usluga, 40);
  const uslugaNazwa = tekst(b.usluga_nazwa, 120);
  const woj = tekst(b.wojewodztwo, 40);
  const miejscowosc = tekst(b.miejscowosc, 160);
  const opis = tekst(b.opis, 3000);
  const termin = tekst(b.termin, 120);
  const imie = tekst(b.imie, 120);
  const email = tekst(b.email, 160).toLowerCase();
  const telefon = tekst(b.telefon, 40);
  const zgoda = b.zgoda === true;
  const par: Array<{ etykieta: string; wartosc: string }> = Array.isArray(b.parametry)
    ? (b.parametry as Array<Record<string, unknown>>).slice(0, 12)
        .map((p) => ({ etykieta: tekst(p.etykieta, 80), wartosc: tekst(p.wartosc, 200) }))
        .filter((p) => p.etykieta && p.wartosc)
    : [];
  const ids = Array.isArray(b.firmy) ? [...new Set((b.firmy as unknown[]).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : [];

  if (!usluga || !woj || !miejscowosc) return json({ error: "Podaj usługę, województwo i miejscowość." }, 400);
  if (!imie) return json({ error: "Podaj imię i nazwisko albo nazwę firmy." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Podaj poprawny adres e-mail." }, 400);
  if (!zgoda) return json({ error: "Zaznacz zgodę na przekazanie zapytania wybranym firmom." }, 400);
  if (!ids.length) return json({ error: "Zaznacz co najmniej jedną firmę." }, 400);
  if (ids.length > MAX_FIRM) return json({ error: `Zaznacz najwyżej ${MAX_FIRM} firm.` }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || null;

  // limity dobowe
  const doba = new Date(Date.now() - 86400000).toISOString();
  const { count: zEmaila } = await db.from("zapytania_wyceny").select("id", { count: "exact", head: true })
    .ilike("email", email).gte("created_at", doba);
  if ((zEmaila ?? 0) >= LIMIT_EMAIL) return json({ error: "Z tego adresu wysłano już dziś kilka zapytań. Spróbuj jutro albo napisz do biura Izby." }, 429);
  if (ip) {
    const { count: zIp } = await db.from("zapytania_wyceny").select("id", { count: "exact", head: true })
      .eq("ip", ip).gte("created_at", doba);
    if ((zIp ?? 0) >= LIMIT_IP) return json({ error: "Przekroczono dzienny limit zapytań. Spróbuj jutro." }, 429);
  }

  const fq = await db.from("czlonkowie").select("id,name,person,email,phone,address,website,region")
    .in("id", ids).eq("status", "published");
  if (fq.error) return json({ error: "Błąd serwera. Spróbuj za chwilę." }, 500);
  const firmy = (fq.data ?? []).filter((f) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email ?? "").trim()));
  if (!firmy.length) return json({ error: "Wybrane firmy nie są dostępne. Odśwież stronę." }, 400);

  // ── mail do firmy ──
  const tabela = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;">
    ${wiersz("Usługa", `<strong>${esc(uslugaNazwa || usluga)}</strong>`)}
    ${wiersz("Lokalizacja", esc(miejscowosc) + ", woj. " + esc(woj))}
    ${par.map((p) => wiersz(p.etykieta, esc(p.wartosc))).join("")}
    ${wiersz("Termin", esc(termin))}
  </table>
  ${opis ? `<div style="margin:0 0 16px;padding:12px 16px;background:#fdecef;border-left:4px solid ${RED};border-radius:6px;font-size:14px;white-space:pre-wrap;">${esc(opis)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 6px;">
    ${wiersz("Klient", esc(imie))}
    ${wiersz("E-mail", `<a href="mailto:${esc(email)}" style="color:${RED};">${esc(email)}</a>`)}
    ${wiersz("Telefon", esc(telefon))}
  </table>`;
  const wiecej = firmy.length > 1 ? `To samo zapytanie otrzymało ${firmy.length} firm członkowskich z regionu, wskazanych przez klienta.` : "Klient wybrał tylko Państwa firmę.";
  const doFirmy = (f: Record<string, unknown>) => layout("Zapytanie o wycenę od klienta",
    `<p style="margin:0 0 14px;">Dzień dobry,</p>
     <p style="margin:0 0 16px;">przez kalkulator usług geodezyjnych na stronie Geodezyjnej Izby Gospodarczej klient prosi
       <strong>${esc(f.name)}</strong> o wycenę. ${wiecej} Prosimy o odpowiedź bezpośrednio do klienta: wystarczy odpisać na tę wiadomość.</p>
     ${tabela}`,
    "Zapytania z kalkulatora trafiają wyłącznie do członków Izby. Klient wyraził zgodę na przekazanie swoich danych wybranym firmom w celu przygotowania wyceny. Nie chcecie Państwo otrzymywać takich zapytań? Napiszcie do biura Izby.");

  const wyniki: Array<{ id: string; nazwa: string; email: string; ok: boolean }> = [];
  for (const [i, f] of firmy.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    const ok = await wyslij(String(f.email).trim(), `Zapytanie o wycenę: ${uslugaNazwa || usluga}, ${miejscowosc} (gig.org.pl)`, doFirmy(f), email);
    wyniki.push({ id: String(f.id), nazwa: String(f.name), email: String(f.email).trim(), ok });
  }
  const wyslano = wyniki.filter((w) => w.ok).length;

  // ── potwierdzenie dla klienta: lista firm z kontaktami ──
  const lista = firmy.filter((f) => wyniki.find((w) => w.id === String(f.id) && w.ok)).map((f) =>
    `<li style="margin:0 0 10px;"><strong>${esc(f.name)}</strong>${f.address ? `<br><span style="color:#6b7c8c;font-size:13.5px;">${esc(f.address)}</span>` : ""}
      <br><span style="font-size:13.5px;">${f.phone ? "tel. " + esc(f.phone) + " &middot; " : ""}<a href="mailto:${esc(f.email)}" style="color:${RED};">${esc(f.email)}</a>${f.website ? ` &middot; <a href="${esc(/^https?:/i.test(String(f.website)) ? f.website : "https://" + f.website)}" style="color:${RED};">www</a>` : ""}</span></li>`).join("");
  if (wyslano) {
    await new Promise((r) => setTimeout(r, 600));
    await wyslij(email, "Twoje zapytanie o wycenę zostało wysłane (gig.org.pl)", layout("Zapytanie wysłane ✓",
      `<p style="margin:0 0 14px;">Dzień dobry,</p>
       <p style="margin:0 0 14px;">Twoje zapytanie o wycenę (<strong>${esc(uslugaNazwa || usluga)}</strong>, ${esc(miejscowosc)}) trafiło do
         ${wyslano === 1 ? "wybranej firmy" : wyslano + " wybranych firm"} członkowskich Geodezyjnej Izby Gospodarczej. Firmy odpowiedzą bezpośrednio na Twój adres e-mail.</p>
       <ul style="margin:0 0 16px;padding-left:18px;">${lista}</ul>
       <p style="margin:0 0 14px;font-size:14px;">Porównując oferty, sprawdź, co obejmuje cena: czy są w niej opłaty za materiały z ośrodka dokumentacji, stabilizacja znaków granicznych, liczba egzemplarzy map i termin wykonania. Najtańsza oferta nie zawsze obejmuje to samo co droższa.</p>`,
      "Wysłałeś zapytanie przez kalkulator na stronie gig.org.pl. Jeśli w ciągu kilku dni roboczych nikt się nie odezwie, napisz do biura Izby: biuro@gig.org.pl."),
      "biuro@gig.org.pl");
  }

  const ins = await db.from("zapytania_wyceny").insert({
    usluga, usluga_nazwa: uslugaNazwa || null, wojewodztwo: woj, miejscowosc, parametry: par, opis: opis || null,
    termin: termin || null, imie, email, telefon: telefon || null, firmy: wyniki, wyslano_do: wyslano, ip,
  });
  if (ins.error) console.error("zapytania_wyceny:", ins.error.message);

  console.log(`zapytanie-wycena: ${usluga} ${wsp(woj)} -> ${wyslano}/${firmy.length}`);
  if (!wyslano) return json({ error: "Nie udało się wysłać zapytania. Spróbuj ponownie albo napisz na biuro@gig.org.pl." }, 502);
  return json({ ok: true, wyslano, firmy: wyniki.filter((w) => w.ok).map((w) => w.nazwa) });
});
