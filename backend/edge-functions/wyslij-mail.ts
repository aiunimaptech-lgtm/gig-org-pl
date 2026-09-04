// ============================================================
// GIG — Edge Function: wyslij-mail
// Wysyła wiadomość z panelu do uczestników szkoleń (Resend).
// Wołana z /admin/zapisy.html (kreator e-maila).
//
// Autoryzacja: nagłówek Authorization: Bearer <access_token zalogowanego
// administratora>. Funkcja sprawdza token przez auth.getUser() — bez
// zalogowanego użytkownika panelu nic nie wyśle. Wdrożenie z
// verify_jwt = false (klucz sb_publishable_ nie jest JWT; sprawdzamy sami).
//
// Body: { subject, html, recipients: [{email, name?}], szkolenie? }
// Każdy odbiorca dostaje osobny mail (nie widzi pozostałych adresów).
// Reply-To = biuro@gig.org.pl, żeby odpowiedzi trafiały do Izby.
//
// Sekrety: RESEND_API_KEY, FROM_EMAIL (jak w send-confirmation),
//          SUPABASE_URL i SUPABASE_ANON_KEY wstrzykuje Supabase.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const MAX_ODBIORCOW = 200;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const C = { dark: "#16202a", mid: "#cc0a2b", bg: "#f4f6f8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Ta sama ramka, co w mailach potwierdzających — spójny wygląd. */
function layout(title: string, body: string, stopka: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef0f3;font-family:'Segoe UI',Arial,sans-serif;color:${C.dark};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(22,32,42,.10);">
      <tr><td style="background:${C.dark};padding:24px 32px;color:#fff;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${C.mid};width:46px;height:46px;border-radius:8px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:15px;">GIG</td>
          <td style="padding-left:12px;font-weight:700;font-size:15px;">Geodezyjna Izba Gospodarcza<br><span style="font-weight:400;font-size:12px;color:rgba(255,255,255,.6);">gig.org.pl</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;background:${C.mid};"></td></tr>
      <tr><td style="padding:32px;font-size:15px;line-height:1.65;">
        <h1 style="margin:0 0 16px;font-size:20px;color:${C.dark};">${esc(title)}</h1>
        <div class="tresc">${body}</div>
        ${stopka ? `<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e6ebef;font-size:12px;color:#90a4b4;">${stopka}</p>` : ""}
      </td></tr>
      <tr><td style="background:#f6f8fa;padding:20px 32px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#6b7c8c;line-height:1.6;">
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

/* Treść z edytora Quill: zostawiamy proste znaczniki, wycinamy skrypty/atrybuty zdarzeń. */
function oczyscHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
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
    console.error("Resend (wyjatek):", to, err);
    return { ok: false, info: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  // ── kto woła: tylko zalogowany administrator panelu ──
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ error: "brak uprawnien" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await sb.auth.getUser(jwt);
  if (uErr || !u?.user?.email) return json({ error: "brak uprawnien" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }

  const subject = String(body.subject ?? "").trim();
  const html = oczyscHtml(String(body.html ?? "")).trim();
  const szkolenie = String(body.szkolenie ?? "").trim();
  const odbiorcy = Array.isArray(body.recipients) ? body.recipients as Array<Record<string, unknown>> : [];

  if (!subject) return json({ error: "brak tematu" }, 400);
  if (!html || html.replace(/<[^>]+>/g, "").trim().length < 2) return json({ error: "brak tresci" }, 400);
  const adresy = [...new Set(odbiorcy.map((r) => String(r.email ?? "").trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  if (!adresy.length) return json({ error: "brak poprawnych odbiorcow" }, 400);
  if (adresy.length > MAX_ODBIORCOW) return json({ error: `za duzo odbiorcow (max ${MAX_ODBIORCOW})` }, 400);

  const stopka = szkolenie
    ? `Otrzymujesz tę wiadomość, ponieważ zgłoszono Cię na szkolenie GIG: <strong>${esc(szkolenie)}</strong>. Odpowiedź na ten mail trafi do biura Izby.`
    : "Otrzymujesz tę wiadomość jako uczestnik szkoleń Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.";
  const tresc = layout(subject, html, stopka);

  const wyniki: Array<{ email: string; ok: boolean; blad?: unknown }> = [];
  for (const email of adresy) {
    const r = await wyslijJeden(email, subject, tresc);
    wyniki.push({ email, ok: r.ok, ...(r.ok ? {} : { blad: r.info }) });
  }
  const wyslane = wyniki.filter((w) => w.ok).length;
  console.log(`wyslij-mail: ${u.user.email} -> ${wyslane}/${adresy.length} (${subject})`);
  return json({ ok: true, wyslane, razem: adresy.length, wyniki });
});
