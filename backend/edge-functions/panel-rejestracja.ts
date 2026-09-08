// ============================================================
// GIG - Edge Function: panel-rejestracja  v3
//
// Rejestracja w Supabase Auth jest WYLACZONA (i ma taka zostac). Zamiast tego:
// wniosek trafia mailem do biura, a konto powstaje dopiero po decyzji.
//
// Zmiany po audycie (8 wrzesnia 2026):
// - token akceptacji lezy w bazie TYLKO jako skrot sha256; tabela panel_wnioski
//   nie ma juz zadnej polityki ani grantu dla anon/authenticated, wiec sesja panelu
//   nie moze go odczytac i sama sobie zatwierdzic konta,
// - link z maila (GET) nie ma skutkow ubocznych: przekierowuje na
//   /admin/wniosek.html z tokenem we fragmencie adresu; decyzje wykonuje
//   POST {akcja:"rozpatrz"} z tej strony - skaner linkow w poczcie niczego
//   nie zatwierdzi,
// - zapisujemy skad przyszla decyzja (rozpatrzyl, rozpatrzono_ip).
//
// POST {akcja:"zloz", email, imie, uzasadnienie}     -> wniosek + mail do biura
// GET  ?token=<64hex>&akcja=akceptuj|odrzuc          -> 302 na wniosek.html#t=...
// POST {akcja:"podglad", token}                       -> {ok, imie, email, ...}
// POST {akcja:"rozpatrz", token, decyzja}             -> {ok, wynik}
//
// Po akceptacji zakladamy konto BEZ HASLA i wysylamy wnioskodawcy wlasny
// jednorazowy link "ustaw haslo" (panel_zaproszenia + funkcja panel-haslo).
// Wdrozenie z verify_jwt = false.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const BIURO = Deno.env.get("PANEL_AKCEPTACJA_EMAIL") ?? "biuro@gig.org.pl";
const STRONA = "https://gig.org.pl";
const FUNKCJA = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1/panel-rejestracja";

const C = { dark: "#16202a", mid: "#cc0a2b", bg: "#fdecef" };
const LOGO = STRONA + "/_assets/img/gig-logo-email.png";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function sha256(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function nowyToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

function ramka(tytul: string, tresc: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:26px 34px 18px;"><img src="${LOGO}" width="196" alt="GIG" style="display:block;border:0;height:auto;"></td></tr>
      <tr><td style="height:3px;background:${C.mid};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:30px 34px 26px;font-size:15px;line-height:1.65;">
        <h1 style="margin:0 0 14px;font-size:21px;color:${C.dark};font-weight:800;">${tytul}</h1>
        ${tresc}
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:${C.dark};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; biuro@gig.org.pl</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function wyslij(to: string[], subject: string, html: string, replyTo?: string): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = {
      from: Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>", to, subject, html,
    };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Resend:", await res.text());
    return res.ok;
  } catch (err) { console.error("Resend (wyjatek):", err); return false; }
}

/* Brama Supabase wymusza text/plain na odpowiedziach funkcji, wiec HTML
   pokazuje statyczna strona w serwisie - funkcja tylko tam kieruje. */
function przekieruj(url: string): Response {
  return new Response(null, { status: 302, headers: { ...CORS, "Location": url } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();

  /* Link z maila: ZERO skutkow ubocznych. Token jedzie we fragmencie adresu,
     wiec nie trafia do logow serwera www; strona pokazuje wniosek i pyta o decyzje. */
  if (req.method === "GET") {
    const u = new URL(req.url);
    const token = (u.searchParams.get("token") ?? "").trim();
    const akcja = (u.searchParams.get("akcja") ?? "").trim();
    if (!/^[0-9a-f]{64}$/.test(token) || !["akceptuj", "odrzuc"].includes(akcja)) {
      return przekieruj(`${STRONA}/admin/wniosek.html?wynik=brak`);
    }
    return przekieruj(`${STRONA}/admin/wniosek.html?akcja=${akcja}#t=${token}`);
  }

  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }

  /* Podglad i decyzja - obie za tokenem z linku, porownanie po skrocie. */
  if (body.akcja === "podglad" || body.akcja === "rozpatrz") {
    const token = String(body.token ?? "").trim();
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, wynik: "brak" });
    const w = await db.from("panel_wnioski").select("*").eq("token_akcji", await sha256(token)).maybeSingle();
    if (w.error || !w.data) return json({ ok: false, wynik: "brak" });
    if (w.data.status !== "oczekuje") return json({ ok: false, wynik: "juz" });

    if (body.akcja === "podglad") {
      return json({ ok: true, imie: w.data.imie, email: w.data.email, uzasadnienie: w.data.uzasadnienie, created_at: w.data.created_at });
    }

    const decyzja = String(body.decyzja ?? "");
    if (!["akceptuj", "odrzuc"].includes(decyzja)) return json({ error: "nieznana decyzja" }, 400);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const kto = `link z maila do ${BIURO}`;

    if (decyzja === "odrzuc") {
      await db.from("panel_wnioski").update({ status: "odrzucony", rozpatrzono: new Date().toISOString(), rozpatrzyl: kto, rozpatrzono_ip: ip }).eq("id", w.data.id);
      return json({ ok: true, wynik: "odrzucony" });
    }

    // Konto zakladamy BEZ hasla - ustawi je sam wnioskodawca linkiem ponizej.
    const nowy = await db.auth.admin.createUser({ email: w.data.email, email_confirm: true });
    if (nowy.error && !/already/i.test(nowy.error.message)) {
      console.error("createUser:", nowy.error.message);
      return json({ ok: false, wynik: "blad" });
    }

    const tokenHasla = nowyToken();
    const zapr = await db.from("panel_zaproszenia").insert({
      email: w.data.email, token: tokenHasla, wygasa: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });
    if (zapr.error) { console.error("zaproszenie:", zapr.error.message); return json({ ok: false, wynik: "bez-linku" }); }
    const linkHaslo = `${STRONA}/admin/ustaw-haslo.html?token=${tokenHasla}`;

    await wyslij([w.data.email], "Twoje konto w panelu GIG jest gotowe", ramka("Konto zatwierdzone ✓", `
      <p style="margin:0 0 14px;">Dzień dobry,</p>
      <p style="margin:0 0 14px;">Twój wniosek o dostęp do panelu Geodezyjnej Izby Gospodarczej został zatwierdzony. Ostatni krok to ustawienie własnego hasła:</p>
      <p style="margin:0 0 18px;"><a href="${linkHaslo}" style="display:inline-block;background:${C.mid};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Ustaw hasło</a></p>
      <p style="margin:0 0 14px;font-size:14px;">Link jest ważny 7 dni i działa tylko raz. Jeśli wygaśnie, użyj „Nie pamiętasz hasła?" na stronie <a href="${STRONA}/admin/" style="color:${C.mid};">${STRONA}/admin/</a>.</p>
      <p style="margin:0;font-size:13px;color:#6b7c8c;">Przy każdym logowaniu wyślemy dodatkowo kod na ten adres. To drugi składnik logowania, chroniący dane osobowe w panelu.</p>`));

    await db.from("panel_wnioski").update({ status: "zaakceptowany", rozpatrzono: new Date().toISOString(), rozpatrzyl: kto, rozpatrzono_ip: ip }).eq("id", w.data.id);
    return json({ ok: true, wynik: "zatwierdzony" });
  }

  /* Zlozenie wniosku z /admin/rejestracja.html */
  const email = String(body.email ?? "").trim().toLowerCase();
  const imie = String(body.imie ?? "").trim().slice(0, 120);
  const uzasadnienie = String(body.uzasadnienie ?? "").trim().slice(0, 1000);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Podaj poprawny adres e-mail." }, 400);
  if (!imie) return json({ error: "Podaj imię i nazwisko." }, 400);

  const token = nowyToken();
  const ins = await db.from("panel_wnioski")
    .insert({ email, imie, uzasadnienie, token_akcji: await sha256(token) }).select("id").single();
  // Unikalny indeks na oczekujacych = ktos juz zlozyl wniosek tym adresem.
  // Odpowiadamy tak samo jak przy sukcesie, zeby formularz nie zdradzal,
  // ktore adresy czekaja na akceptacje.
  if (ins.error) {
    if (ins.error.code === "23505") return json({ ok: true, zlozony: true });
    console.error("insert wniosek:", ins.error.message);
    return json({ error: "Nie udało się złożyć wniosku." }, 500);
  }

  const linkTak = `${FUNKCJA}?token=${token}&akcja=akceptuj`;
  const linkNie = `${FUNKCJA}?token=${token}&akcja=odrzuc`;
  await wyslij([BIURO], `[GIG] Wniosek o dostęp do panelu: ${imie}`, ramka("Wniosek o konto w panelu", `
    <p style="margin:0 0 16px;">Ktoś prosi o dostęp do panelu administracyjnego gig.org.pl.</p>
    <div style="margin:0 0 18px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:14px;"><strong>${esc(imie)}</strong></p>
      <p style="margin:0 0 6px;font-size:14px;">${esc(email)}</p>
      ${uzasadnienie ? `<p style="margin:8px 0 0;font-size:14px;white-space:pre-wrap;">${esc(uzasadnienie)}</p>` : ""}
    </div>
    <p style="margin:0 0 18px;font-size:14px;"><strong>Zatwierdź tylko wtedy, gdy znasz tę osobę</strong> i wiesz, że ma prawo widzieć dane osobowe zgromadzone w panelu (zapisy na szkolenia, kontakt, baza adresów).</p>
    <p style="margin:0 0 22px;">
      <a href="${linkTak}" style="display:inline-block;background:${C.mid};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;margin-right:10px;">Rozpatrz wniosek</a>
      <a href="${linkNie}" style="display:inline-block;background:#8a99a3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Odrzuć</a>
    </p>
    <p style="margin:0;font-size:12.5px;color:#6b7c8c;">Link otwiera stronę z podglądem wniosku. Nic się nie stanie, dopóki nie klikniesz tam przycisku decyzji.</p>`), email);

  return json({ ok: true, zlozony: true });
});
