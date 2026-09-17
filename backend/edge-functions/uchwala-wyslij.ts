// ============================================================
// GIG — Edge Function: uchwala-wyslij
// Rozsyła członkom Rady Izby projekt uchwały o przyjęciu członka z osobistymi
// linkami do głosowania, a potem przypomnienia tym, którzy nie zagłosowali.
// Wołana z panelu /admin/uchwaly.html.
//
// Autoryzacja jak wyslij-mail: Authorization: Bearer <access_token admina>,
// sesja musi być na liście panel_sesje_ok (kod z e-maila). Wdrożenie z
// verify_jwt = false (klucz publishable nie jest JWT).
//
// Body: { uchwala_id, tryb: 'start' | 'przypomnienie' | 'podglad', odbiorcy?: [rada_id, …] }
//   start         – tworzy głosy (token per osoba) dla wskazanych/aktywnych członków Rady,
//                   wysyła maile, ustawia status 'glosowanie'
//   przypomnienie – mail do tych, którzy jeszcze nie oddali głosu
//   podglad       – zwraca HTML maila (bez wysyłki i bez zapisu)
//
// Sekrety: RESEND_API_KEY, FROM_EMAIL, SITE_URL (domyślnie https://gig.org.pl);
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY wstrzykiwane.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const SITE = (Deno.env.get("SITE_URL") ?? "https://gig.org.pl").replace(/\/$/, "");
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const RED = "#cc0a2b", GREEN = "#1d7a45", DARK = "#16202a";

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

/* Token do linku: 24 losowe bajty w base64url (32 znaki), bez znaków specjalnych w URL. */
function nowyToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Zwykły tekst z panelu → akapity; pusta linia rozdziela akapity, pojedyncza łamie wiersz. */
function akapity(t: string): string {
  return t.trim().split(/\n\s*\n/).map((p) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

type Uchwala = {
  id: string; numer: string | null; kandydat_osoba: string | null; kandydat_firma: string | null;
  kandydat_adres: string | null; data_wejscia: string; tresc: string; mail_temat: string; mail_tresc: string; status: string;
};

/* Mail do członka Rady: treść od sekretariatu, projekt uchwały w ramce, dwa przyciski
   z osobistym linkiem. Głos pada dopiero na stronie po potwierdzeniu, więc skanery
   linków w poczcie nie oddadzą głosu za nikogo. */
function mailGlosowania(u: Uchwala, imie: string, token: string, przypomnienie: boolean): { subject: string; html: string } {
  const linkZa = `${SITE}/glosowanie/?t=${encodeURIComponent(token)}&g=za`;
  const linkPrzeciw = `${SITE}/glosowanie/?t=${encodeURIComponent(token)}&g=przeciw`;
  const subject = (przypomnienie ? "Przypomnienie: " : "") + (u.mail_temat || "Prośba o podjęcie uchwały");
  const przyp = przypomnienie
    ? `<div style="margin:0 0 18px;padding:12px 16px;background:#fff8e6;border:1px solid #f0e2b6;border-radius:8px;font-size:14px;line-height:1.6;color:#7a5c14;">
         <strong>Przypomnienie.</strong> Nie odnotowaliśmy jeszcze Państwa głosu w tej sprawie. Jeśli głos został już oddany, prosimy zignorować tę wiadomość.</div>`
    : "";
  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <tr><td style="padding:26px 34px 18px;background:#ffffff;">
        <img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="height:3px;background:${RED};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${RED};font-weight:700;">Głosowanie Rady Izby</p>
        <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${DARK};font-weight:800;">${esc(u.mail_temat || "Prośba o podjęcie uchwały")}</h1>
        ${przyp}
        ${akapity(u.mail_tresc)}
        <div style="margin:22px 0;padding:18px 22px;background:#fdf5f6;border-left:4px solid ${RED};border-radius:8px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:${RED};text-transform:uppercase;letter-spacing:.6px;">Projekt uchwały</p>
          <p style="margin:0;font-size:14.5px;line-height:1.7;color:${DARK};white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;">${esc(u.tresc)}</p>
        </div>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.65;">${esc(imie)}, prosimy o oddanie głosu:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>
          <td style="padding:0 12px 0 0;"><a href="${linkZa}" style="display:inline-block;padding:13px 26px;background:${GREEN};color:#ffffff;font-weight:700;font-size:15px;border-radius:30px;text-decoration:none;">✓ Głosuję ZA</a></td>
          <td><a href="${linkPrzeciw}" style="display:inline-block;padding:13px 26px;background:${RED};color:#ffffff;font-weight:700;font-size:15px;border-radius:30px;text-decoration:none;">✕ Głosuję PRZECIW</a></td>
        </tr></table>
        <p style="margin:0;font-size:12.5px;color:#7a8b97;line-height:1.6;">Po kliknięciu otworzy się strona, na której można dopisać uzasadnienie i potwierdzić głos. Link jest osobisty i działa tylko dla tego głosowania. Jeśli przyciski nie działają, skopiuj adres: <span style="word-break:break-all;">${esc(linkZa)}</span></p>
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
    if (!res.ok) console.error("Resend:", wynik);
    return { ok: res.ok, info: wynik };
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return { ok: false, info: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  // ── kto woła: tylko zalogowany administrator panelu po kodzie z maila ──
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
  const uchwalaId = String(body.uchwala_id ?? "");
  const tryb = String(body.tryb ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(uchwalaId)) return json({ error: "brak uchwaly" }, 400);
  if (!["start", "przypomnienie", "podglad"].includes(tryb)) return json({ error: "nieznany tryb" }, 400);

  const db = admin();
  const uq = await db.from("uchwaly").select("*").eq("id", uchwalaId).maybeSingle();
  if (uq.error || !uq.data) return json({ error: "nie ma takiej uchwaly" }, 404);
  const uch = uq.data as Uchwala;
  if (!uch.tresc.trim()) return json({ error: "uchwala nie ma tresci" }, 400);

  // ── podgląd: HTML maila dla pierwszego odbiorcy, bez zapisu ──
  if (tryb === "podglad") {
    const m = mailGlosowania(uch, "Szanowni Państwo", "PODGLAD", false);
    return json({ ok: true, subject: m.subject, html: m.html });
  }

  const wyniki: Array<{ email: string; ok: boolean; blad?: unknown }> = [];

  if (tryb === "start") {
    if (uch.status !== "projekt") return json({ error: "uchwala nie jest projektem (status: " + uch.status + ")" }, 409);

    const wybrani = Array.isArray(body.odbiorcy) ? (body.odbiorcy as unknown[]).map(String) : [];
    let rq = db.from("rada_izby").select("id,imie_nazwisko,email").eq("aktywny", true).order("kolejnosc");
    if (wybrani.length) rq = rq.in("id", wybrani);
    const rada = await rq;
    if (rada.error) return json({ error: rada.error.message }, 500);
    const osoby = (rada.data ?? []) as Array<{ id: string; imie_nazwisko: string; email: string }>;
    if (!osoby.length) return json({ error: "brak odbiorcow - uzupelnij sklad Rady" }, 400);

    for (const o of osoby) {
      const token = nowyToken();
      const ins = await db.from("uchwaly_glosy").insert({
        uchwala_id: uch.id, rada_id: o.id, imie_nazwisko: o.imie_nazwisko, email: o.email.toLowerCase(), token,
      }).select("id").single();
      if (ins.error) { wyniki.push({ email: o.email, ok: false, blad: ins.error.message }); continue; }
      const m = mailGlosowania(uch, o.imie_nazwisko, token, false);
      const w = await wyslijJeden(o.email, m.subject, m.html);
      await db.from("uchwaly_glosy").update(w.ok
        ? { wyslano_at: new Date().toISOString(), blad_wysylki: null }
        : { blad_wysylki: JSON.stringify(w.info).slice(0, 500) }).eq("id", ins.data.id);
      wyniki.push({ email: o.email, ok: w.ok, ...(w.ok ? {} : { blad: w.info }) });
    }
    await db.from("uchwaly").update({ status: "glosowanie", wyslano_at: new Date().toISOString(), wyslal: kto, updated_at: new Date().toISOString() })
      .eq("id", uch.id);

  } else {
    // ── przypomnienie: tylko do tych bez głosu ──
    if (uch.status !== "glosowanie") return json({ error: "glosowanie nie jest otwarte (status: " + uch.status + ")" }, 409);
    const gq = await db.from("uchwaly_glosy").select("id,imie_nazwisko,email,token,przypomnien").eq("uchwala_id", uch.id).is("glos", null);
    if (gq.error) return json({ error: gq.error.message }, 500);
    const brak = (gq.data ?? []) as Array<{ id: string; imie_nazwisko: string; email: string; token: string; przypomnien: number }>;
    if (!brak.length) return json({ ok: true, wyslane: 0, razem: 0, wyniki: [], info: "wszyscy juz zaglosowali" });
    for (const g of brak) {
      const m = mailGlosowania(uch, g.imie_nazwisko, g.token, true);
      const w = await wyslijJeden(g.email, m.subject, m.html);
      if (w.ok) await db.from("uchwaly_glosy").update({ przypomnienie_at: new Date().toISOString(), przypomnien: g.przypomnien + 1, blad_wysylki: null }).eq("id", g.id);
      else await db.from("uchwaly_glosy").update({ blad_wysylki: JSON.stringify(w.info).slice(0, 500) }).eq("id", g.id);
      wyniki.push({ email: g.email, ok: w.ok, ...(w.ok ? {} : { blad: w.info }) });
    }
  }

  const wyslane = wyniki.filter((w) => w.ok).length;
  console.log(`uchwala-wyslij: ${kto} [${tryb}] ${uch.id} -> ${wyslane}/${wyniki.length}`);
  return json({ ok: true, wyslane, razem: wyniki.length, wyniki });
});
