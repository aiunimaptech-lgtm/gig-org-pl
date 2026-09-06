// ============================================================
// GIG — Edge Function: wyslij-mail
// Wysyła wiadomość z panelu (Resend): do uczestników szkoleń, jako odpowiedź
// na wiadomość z formularza kontaktowego albo do adresów z bazy (rodzaj 'baza').
// Wołana z panelu przez gigKreatorMaila() w /admin/_admin.js.
//
// Autoryzacja: Authorization: Bearer <access_token zalogowanego admina>.
// Funkcja sprawdza token przez auth.getUser() — bez zalogowanego użytkownika
// nic nie wyśle. Wdrożenie z verify_jwt = false (klucz publishable nie jest JWT).
//
// Body: { subject, html, recipients: [{email, name?, id?}],
//         rodzaj?: 'szkolenie' | 'kontakt' | 'baza', szkolenie? }
// Każdy odbiorca dostaje osobny mail (nie widzi pozostałych adresów).
// Przy rodzaj='baza' i podanym id (wiersz baza_email) mail dostaje link
// „wypisz się" -> Edge Function baza-wypis, która oznacza status=unsubscribed.
// Reply-To = biuro@gig.org.pl.
//
// Sekrety: RESEND_API_KEY, FROM_EMAIL; SUPABASE_URL i SUPABASE_ANON_KEY wstrzykiwane.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1";
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const MAX_ODBIORCOW = 200;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RED = "#cc0a2b";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Lekka, jasna szata: białe tło, logo GIG w nagłówku, czerwona kreska zamiast
   ciężkiego ciemnego pasa. Stopka z danymi Izby i (opcjonalnie) linkiem wypisu. */
function layout(title: string, body: string, stopka: string, unsubUrl: string): string {
  const wypis = unsubUrl
    ? `<p style="margin:14px 0 0;font-size:12px;color:#9aa7b2;line-height:1.6;">Nie chcesz otrzymywać wiadomości od Izby? <a href="${unsubUrl}" style="color:#9aa7b2;text-decoration:underline;">Wypisz się z listy</a>.</p>`
    : "";
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <tr><td style="padding:26px 34px 18px;background:#ffffff;">
        <img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="height:3px;background:${RED};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;">
        <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#16202a;font-weight:800;">${esc(title)}</h1>
        <div style="font-size:15px;line-height:1.65;color:#38444e;">${body}</div>
        ${stopka ? `<div style="margin:22px 0 0;padding-top:16px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">${stopka}</div>` : ""}
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:#16202a;">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${RED};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${RED};text-decoration:none;">gig.org.pl</a>
        </p>
        ${wypis}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/* Treść z edytora Quill: zostawiamy proste znaczniki, wycinamy skrypty/atrybuty zdarzeń.
   Cytat (blockquote) dostaje styl inline, bo klienci poczty nie czytają arkuszy. */
function oczyscHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<blockquote>/gi, `<blockquote style="margin:12px 0;padding:4px 0 4px 14px;border-left:3px solid #e6ebef;color:#6b7c8c;">`);
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
  const rodzaj = String(body.rodzaj ?? "").trim();
  const szkolenie = String(body.szkolenie ?? "").trim();
  const wejscie = Array.isArray(body.recipients) ? body.recipients as Array<Record<string, unknown>> : [];

  if (!subject) return json({ error: "brak tematu" }, 400);
  if (!html || html.replace(/<[^>]+>/g, "").trim().length < 2) return json({ error: "brak tresci" }, 400);

  // dedup po e-mailu, zachowujemy id (do linku wypisu)
  const widziane = new Set<string>();
  const odb: Array<{ email: string; id: string | null }> = [];
  for (const r of wejscie) {
    const e = String(r.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || widziane.has(e)) continue;
    widziane.add(e);
    odb.push({ email: e, id: r.id ? String(r.id) : null });
  }
  if (!odb.length) return json({ error: "brak poprawnych odbiorcow" }, 400);
  if (odb.length > MAX_ODBIORCOW) return json({ error: `za duzo odbiorcow (max ${MAX_ODBIORCOW})` }, 400);

  let stopka: string;
  if (rodzaj === "kontakt") {
    stopka = "To odpowiedź na Twoją wiadomość wysłaną przez formularz na gig.org.pl. Odpisując na ten mail, piszesz do biura Izby.";
  } else if (rodzaj === "baza") {
    stopka = "Otrzymujesz tę wiadomość, ponieważ Twój adres jest w bazie kontaktów Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.";
  } else if (szkolenie) {
    stopka = `Otrzymujesz tę wiadomość, ponieważ zgłoszono Cię na szkolenie GIG: <strong>${esc(szkolenie)}</strong>. Odpowiedź na ten mail trafi do biura Izby.`;
  } else {
    stopka = "Otrzymujesz tę wiadomość jako uczestnik szkoleń Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.";
  }

  const wyniki: Array<{ email: string; ok: boolean; blad?: unknown }> = [];
  for (const r of odb) {
    // link wypisu tylko dla wysyłek do bazy i gdy znamy wiersz (id)
    const unsubUrl = (rodzaj === "baza" && r.id) ? `${FUNCTIONS_BASE}/baza-wypis?id=${encodeURIComponent(r.id)}` : "";
    const tresc = layout(subject, html, stopka, unsubUrl);
    const w = await wyslijJeden(r.email, subject, tresc);
    wyniki.push({ email: r.email, ok: w.ok, ...(w.ok ? {} : { blad: w.info }) });
  }
  const wyslane = wyniki.filter((w) => w.ok).length;
  console.log(`wyslij-mail: ${u.user.email} -> ${wyslane}/${odb.length} [${rodzaj || "-"}] (${subject})`);
  return json({ ok: true, wyslane, razem: odb.length, wyniki });
});
