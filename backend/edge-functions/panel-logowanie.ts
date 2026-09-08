// ============================================================
// GIG - Edge Function: panel-logowanie (2FA kodem z e-maila)  v2
//
// Dlaczego przez funkcje, a nie w przegladarce:
// gdyby panel logowal sie sam (signInWithPassword), przegladarka dostawalaby
// sesje juz po samym hasle, a kod z maila bylby tylko zaslona w UI.
//
// Dlaczego v2 (audyt bezpieczenstwa, 8 wrzesnia 2026):
// samo trzymanie tokenow w funkcji nie wystarczalo, bo publiczny grant
// POST /auth/v1/token?grant_type=password dziala dla kazdego z kluczem
// publishable - sesja z samego hasla przechodzila kazda polityke RLS.
// Teraz po poprawnym kodzie session_id z JWT trafia do tabeli panel_sesje_ok
// (tylko service_role), a KAZDA polityka administratora i funkcje wysylkowe
// sprawdzaja public.gig_sesja_2fa(). Sesja z samego hasla ma inny session_id
// i nigdy nie trafia na liste. refreshSession zachowuje session_id, wiec
// odswiezanie tokenu w panelu nie wybija z listy. Sesja GoTrue zaparkowana
// na czas wyzwania jest uniewazniana przy zlym/przeterminowanym kodzie.
//
// POST {akcja:"start", email, haslo}    -> {ok, id}            (mail z kodem)
// POST {akcja:"potwierdz", id, kod}     -> {ok, session}       (tokeny sesji)
//
// Sekrety: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (wstrzykuje
//          Supabase), RESEND_API_KEY, FROM_EMAIL.
// Wdrozenie z verify_jwt = false - to jest wlasnie endpoint logowania.
// SQL: backend/supabase_panel_konta.sql, backend/supabase_2fa_sesje.sql
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WAZNOSC_MIN = 10;      // ile minut zyje kod
const MAX_PROB = 5;          // ile razy mozna sie pomylic, zanim wyzwanie przepada
const MAX_START_15MIN = 5;   // ile razy mozna wolac "start" na jeden adres
const SESJA_DNI = 14;        // jak dlugo sesja po kodzie zostaje na liscie panel_sesje_ok

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function anonKlient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function sha256(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rowneStalyCzas(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* Kod z generatora kryptograficznego, nie z Math.random. */
function kod6(): string {
  const t = new Uint32Array(1);
  crypto.getRandomValues(t);
  return String(t[0] % 1000000).padStart(6, "0");
}

/* Ladunek JWT bez weryfikacji podpisu: token wlasnie dostalismy z GoTrue,
   potrzebujemy tylko session_id, zeby wpisac sesje na liste. */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1] ?? "";
    const s = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(s) as Record<string, unknown>;
  } catch { return {}; }
}

const C = { dark: "#16202a", mid: "#cc0a2b", bg: "#fdecef" };
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";

function mailKod(kod: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:26px 34px 18px;"><img src="${LOGO}" width="196" alt="GIG" style="display:block;border:0;height:auto;"></td></tr>
      <tr><td style="height:3px;background:${C.mid};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;font-size:15px;line-height:1.65;">
        <h1 style="margin:0 0 14px;font-size:21px;color:${C.dark};font-weight:800;">Kod logowania do panelu</h1>
        <p style="margin:0 0 18px;">Wpisz ten kod w oknie logowania, aby dokończyć logowanie do panelu GIG:</p>
        <div style="margin:0 0 18px;padding:18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;text-align:center;">
          <span style="font-size:32px;font-weight:800;letter-spacing:8px;color:${C.dark};">${kod}</span>
        </div>
        <p style="margin:0 0 10px;font-size:14px;">Kod jest ważny <strong>${WAZNOSC_MIN} minut</strong> i działa tylko raz.</p>
        <p style="margin:0;font-size:13px;color:#6b7c8c;">
          Jeśli to nie Ty próbowałeś się zalogować, ktoś zna Twoje hasło. <strong>Zmień je natychmiast</strong>
          i powiadom biuro@gig.org.pl. Bez tego kodu nikt do panelu nie wejdzie.</p>
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:${C.dark};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; biuro@gig.org.pl</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function wyslijKod(email: string, kod: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>",
        to: [email],
        subject: `Kod logowania do panelu GIG: ${kod}`,
        html: mailKod(kod),
      }),
    });
    if (!res.ok) console.error("Resend:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }

  const db = admin();
  await db.rpc("gig_2fa_sprzataj");

  // ── KROK 1: e-mail + haslo -> kod na skrzynke ──────────────────────────
  if (body.akcja === "start") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const haslo = String(body.haslo ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !haslo) {
      return json({ error: "Błędny e-mail lub hasło." }, 401);
    }

    // Hamulec na zgadywanie i na zasypywanie czyjejs skrzynki kodami.
    const odKiedy = new Date(Date.now() - 15 * 60_000).toISOString();
    const ile = await db.from("panel_2fa").select("id", { count: "exact", head: true })
      .eq("email", email).gte("created_at", odKiedy);
    if ((ile.count ?? 0) >= MAX_START_15MIN) {
      return json({ error: "Zbyt wiele prób logowania. Spróbuj za kilkanaście minut." }, 429);
    }

    // Hasla nie sprawdzamy sami - robi to Supabase Auth, kluczem publicznym.
    const logow = await anonKlient().auth.signInWithPassword({ email, password: haslo });
    if (logow.error || !logow.data.session) {
      return json({ error: "Błędny e-mail lub hasło." }, 401);
    }

    const kod = kod6();
    const wpis = await db.from("panel_2fa").insert({
      email,
      kod_hash: await sha256(kod + "|" + email),
      refresh_token: logow.data.session.refresh_token,
      wygasa: new Date(Date.now() + WAZNOSC_MIN * 60_000).toISOString(),
    }).select("id").single();

    if (wpis.error || !wpis.data) {
      console.error("insert 2fa:", wpis.error?.message);
      await db.rpc("gig_2fa_uniewaznij", { p_refresh: logow.data.session.refresh_token });
      return json({ error: "Nie udało się rozpocząć logowania." }, 500);
    }

    if (!await wyslijKod(email, kod)) {
      await db.from("panel_2fa").delete().eq("id", wpis.data.id);
      await db.rpc("gig_2fa_uniewaznij", { p_refresh: logow.data.session.refresh_token });
      return json({ error: "Nie udało się wysłać kodu. Spróbuj ponownie." }, 502);
    }
    return json({ ok: true, id: wpis.data.id, waznosc_min: WAZNOSC_MIN });
  }

  // ── KROK 2: kod -> sesja ───────────────────────────────────────────────
  if (body.akcja === "potwierdz") {
    const id  = String(body.id ?? "").trim();
    const kod = String(body.kod ?? "").replace(/\s/g, "");
    if (!/^[0-9a-f-]{36}$/.test(id) || !/^\d{6}$/.test(kod)) {
      return json({ error: "Nieprawidłowy kod." }, 400);
    }

    const w = await db.from("panel_2fa").select("*").eq("id", id).maybeSingle();
    if (w.error || !w.data) return json({ error: "Kod wygasł. Zaloguj się jeszcze raz." }, 401);
    if (new Date(w.data.wygasa).getTime() < Date.now()) {
      await db.rpc("gig_2fa_uniewaznij", { p_refresh: w.data.refresh_token });
      await db.from("panel_2fa").delete().eq("id", id);
      return json({ error: "Kod wygasł. Zaloguj się jeszcze raz." }, 401);
    }

    if (!rowneStalyCzas(await sha256(kod + "|" + w.data.email), w.data.kod_hash)) {
      const proby = (w.data.proby ?? 0) + 1;
      if (proby >= MAX_PROB) {
        await db.rpc("gig_2fa_uniewaznij", { p_refresh: w.data.refresh_token });
        await db.from("panel_2fa").delete().eq("id", id);
        return json({ error: "Za dużo błędnych prób. Zaloguj się jeszcze raz." }, 401);
      }
      await db.from("panel_2fa").update({ proby }).eq("id", id);
      return json({ error: `Nieprawidłowy kod. Pozostało prób: ${MAX_PROB - proby}.` }, 401);
    }

    // Kod dobry - zamieniamy przechowany refresh token na sesje.
    const sesja = await anonKlient().auth.refreshSession({ refresh_token: w.data.refresh_token });
    await db.from("panel_2fa").delete().eq("id", id);
    if (sesja.error || !sesja.data.session) {
      return json({ error: "Sesja wygasła. Zaloguj się jeszcze raz." }, 401);
    }

    /* Dopiero teraz sesja dostaje prawo do danych: wpis na liste panel_sesje_ok,
       ktora sprawdzaja polityki RLS i funkcje wysylkowe. */
    const claims = jwtClaims(sesja.data.session.access_token);
    const sid = String(claims.session_id ?? "");
    const wpisS = /^[0-9a-f-]{36}$/i.test(sid)
      ? await db.from("panel_sesje_ok").upsert({
          session_id: sid, email: w.data.email,
          wygasa: new Date(Date.now() + SESJA_DNI * 86_400_000).toISOString(),
        })
      : { error: { message: "brak session_id w JWT" } };
    if (wpisS.error) {
      console.error("panel_sesje_ok:", wpisS.error.message);
      await db.rpc("gig_2fa_uniewaznij", { p_refresh: sesja.data.session.refresh_token });
      return json({ error: "Nie udało się otworzyć sesji. Spróbuj jeszcze raz." }, 500);
    }

    return json({
      ok: true,
      session: {
        access_token: sesja.data.session.access_token,
        refresh_token: sesja.data.session.refresh_token,
      },
    });
  }

  return json({ error: "nieznana akcja" }, 400);
});
