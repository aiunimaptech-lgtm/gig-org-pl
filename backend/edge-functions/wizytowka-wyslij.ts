// ============================================================
// GIG — Edge Function: wizytowka-wyslij
// Prośba do członków Izby o sprawdzenie i uzupełnienie wizytówki w katalogu
// /czlonkowie/. Każda firma dostaje osobisty link do /wizytowka/?t=<token>.
// Wołana z panelu /admin/wizytowki.html.
//
// Autoryzacja jak konsultacja-wyslij: Authorization: Bearer <access_token admina>,
// sesja musi być na liście panel_sesje_ok (kod z e-maila). verify_jwt = false.
//
// Body: { tryb: 'wyslij' | 'przypomnienie' | 'podglad', czlonkowie?: [uuid] }
//   wyslij        → do wskazanych firm (bez listy: do wszystkich, które jeszcze
//                   nie dostały prośby); link i token zostają te same przy ponowieniu,
//   przypomnienie → do firm, które dostały prośbę i nie odpowiedziały
//                   (opcjonalnie tylko wskazane),
//   podglad       → HTML maila dla pierwszej firmy, bez wysyłki.
// Adresy bierzemy z tabeli czlonkowie, nie z panelu.
// Między mailami 600 ms przerwy: limit Resend to 2 wiadomości na sekundę.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const SITE = (Deno.env.get("SITE_URL") ?? "https://gig.org.pl").replace(/\/$/, "");
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const RED = "#cc0a2b", DARK = "#16202a";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1] ?? "";
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch { return {}; }
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
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
const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Firma = { id: string; name: string; person: string | null; email: string };

function mail(f: Firma, token: string, przypomnienie: boolean): { subject: string; html: string } {
  const link = `${SITE}/wizytowka/?t=${encodeURIComponent(token)}`;
  const subject = (przypomnienie ? "Przypomnienie: " : "") + "Sprawdź wizytówkę firmy w katalogu Członków GIG";
  const powitanie = f.person ? `Dzień dobry, ${esc(f.person)},` : "Szanowni Państwo,";
  const przyp = przypomnienie
    ? `<div style="margin:0 0 18px;padding:12px 16px;background:#fff8e6;border:1px solid #f0e2b6;border-radius:8px;font-size:14px;line-height:1.6;color:#7a5c14;">
         <strong>Przypomnienie.</strong> Nie dostaliśmy jeszcze potwierdzenia danych Państwa firmy. Jeśli formularz został już wysłany, prosimy zignorować tę wiadomość.</div>`
    : "";
  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <tr><td style="padding:26px 34px 18px;background:#ffffff;">
        <img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="height:3px;background:${RED};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;font-size:15px;line-height:1.65;color:#38444e;">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${RED};font-weight:700;">Katalog Członków GIG</p>
        <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${DARK};font-weight:800;">Sprawdź wizytówkę firmy ${esc(f.name)}</h1>
        ${przyp}
        <p style="margin:0 0 14px;">${powitanie}</p>
        <p style="margin:0 0 14px;">na stronie <a href="${SITE}/czlonkowie/" style="color:${RED};">gig.org.pl/czlonkowie</a> każda firma członkowska ma swoją wizytówkę z danymi kontaktowymi i pinezką na mapie. To miejsce, w którym szukają Państwa zamawiający i inni geodeci, dlatego zależy nam, żeby dane były aktualne i pełne.</p>
        <p style="margin:0 0 18px;">Prosimy o sprawdzenie danych i uzupełnienie:</p>
        <ul style="margin:0 0 20px;padding-left:20px;">
          <li style="margin:0 0 6px;">krótkiego <strong>opisu firmy</strong>: czym się zajmujecie, w jakim regionie,</li>
          <li style="margin:0 0 6px;">adresu <strong>strony internetowej</strong>,</li>
          <li style="margin:0 0 6px;">profili na <strong>LinkedIn</strong> i <strong>Facebooku</strong>, albo zaznaczenia, że ich nie macie.</li>
        </ul>
        <p style="margin:0 0 22px;text-align:center;">
          <a href="${link}" style="display:inline-block;padding:14px 30px;background:${RED};color:#ffffff;font-weight:700;font-size:16px;border-radius:30px;text-decoration:none;">Sprawdź i uzupełnij wizytówkę</a>
        </p>
        <p style="margin:0 0 14px;">Formularz zajmuje około trzech minut. Zmiany sprawdza biuro Izby i publikuje je na stronie, zwykle w ciągu kilku dni roboczych.</p>
        <p style="margin:0;font-size:12.5px;color:#7a8b97;line-height:1.6;">Link jest osobisty i działa tylko dla Państwa firmy, prosimy go nie przekazywać dalej. Jeśli przycisk nie działa, skopiuj adres: <span style="word-break:break-all;">${esc(link)}</span></p>
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:${DARK};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${RED};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${RED};text-decoration:none;">gig.org.pl</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, html };
}

async function wyslijJeden(to: string, subject: string, html: string): Promise<{ ok: boolean; info: unknown }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: REPLY_TO }),
    });
    const wynik = await res.json();
    if (!res.ok) console.error("Resend:", to, wynik);
    return { ok: res.ok, info: wynik };
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return { ok: false, info: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ error: "brak uprawnien" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await sb.auth.getUser(jwt);
  if (uErr || !u?.user?.email) return json({ error: "brak uprawnien" }, 401);
  if (!await sesjaPoKodzie(jwt)) return json({ error: "sesja bez potwierdzenia kodem z e-maila - zaloguj sie ponownie" }, 401);
  const kto = u.user.email;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }
  const tryb = String(body.tryb ?? "");
  if (!["wyslij", "przypomnienie", "podglad"].includes(tryb)) return json({ error: "nieznany tryb" }, 400);
  const wskazani = Array.isArray(body.czlonkowie)
    ? (body.czlonkowie as unknown[]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : [];

  const db = admin();
  const fq = await db.from("czlonkowie").select("id,name,person,email").eq("status", "published").order("name");
  if (fq.error) return json({ error: fq.error.message }, 500);
  const firmy = ((fq.data ?? []) as Firma[]).filter((f) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email ?? "").trim()));
  const wq = await db.from("wizytowki_weryfikacja").select("id,czlonek_id,token,status,przypomnien");
  if (wq.error) return json({ error: wq.error.message }, 500);
  const wiersze = new Map((wq.data ?? []).map((w) => [w.czlonek_id as string, w]));

  if (tryb === "podglad") {
    const f = firmy.find((x) => !wskazani.length || wskazani.includes(x.id)) ?? firmy[0];
    if (!f) return json({ error: "brak firm z adresem e-mail" }, 400);
    const m = mail(f, "PODGLAD", false);
    return json({ ok: true, subject: m.subject, html: m.html });
  }

  const wyniki: Array<{ id: string; nazwa: string; email: string; ok: boolean; blad?: unknown }> = [];
  const teraz = () => new Date().toISOString();

  if (tryb === "wyslij") {
    const cel = wskazani.length ? firmy.filter((f) => wskazani.includes(f.id)) : firmy.filter((f) => !wiersze.has(f.id));
    if (!cel.length) return json({ ok: true, wyslane: 0, razem: 0, wyniki: [], info: "wszystkie firmy dostały już prośbę" });
    for (const f of cel) {
      const adres = f.email.trim().toLowerCase();
      let w = wiersze.get(f.id);
      if (!w) {
        const ins = await db.from("wizytowki_weryfikacja").insert({ czlonek_id: f.id, email: adres, token: nowyToken() })
          .select("id,czlonek_id,token,status,przypomnien").single();
        if (ins.error) { wyniki.push({ id: f.id, nazwa: f.name, email: adres, ok: false, blad: ins.error.message }); continue; }
        w = ins.data;
      }
      const m = mail(f, String(w!.token), false);
      const r = await wyslijJeden(adres, m.subject, m.html);
      await db.from("wizytowki_weryfikacja").update(r.ok
        ? { wyslano_at: teraz(), email: adres, blad_wysylki: null, updated_at: teraz() }
        : { blad_wysylki: JSON.stringify(r.info).slice(0, 500), updated_at: teraz() }).eq("id", w!.id);
      wyniki.push({ id: f.id, nazwa: f.name, email: adres, ok: r.ok, ...(r.ok ? {} : { blad: r.info }) });
      await pauza(600);
    }
  } else {
    const cel = firmy.filter((f) => {
      const w = wiersze.get(f.id);
      return w && w.status === "wyslano" && (!wskazani.length || wskazani.includes(f.id));
    });
    if (!cel.length) return json({ ok: true, wyslane: 0, razem: 0, wyniki: [], info: "nie ma firm czekajacych na odpowiedz" });
    for (const f of cel) {
      const w = wiersze.get(f.id)!;
      const adres = f.email.trim().toLowerCase();
      const m = mail(f, String(w.token), true);
      const r = await wyslijJeden(adres, m.subject, m.html);
      await db.from("wizytowki_weryfikacja").update(r.ok
        ? { przypomnienie_at: teraz(), przypomnien: Number(w.przypomnien ?? 0) + 1, blad_wysylki: null, updated_at: teraz() }
        : { blad_wysylki: JSON.stringify(r.info).slice(0, 500), updated_at: teraz() }).eq("id", w.id);
      wyniki.push({ id: f.id, nazwa: f.name, email: adres, ok: r.ok, ...(r.ok ? {} : { blad: r.info }) });
      await pauza(600);
    }
  }

  const wyslane = wyniki.filter((w) => w.ok).length;
  console.log(`wizytowka-wyslij: ${kto} [${tryb}] -> ${wyslane}/${wyniki.length}`);
  return json({ ok: true, wyslane, razem: wyniki.length, wyniki });
});
