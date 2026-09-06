// ============================================================
// GIG — Edge Function: panel-rejestracja
//
// Rejestracja w Supabase Auth jest WYLACZONA (i ma taka zostac) — inaczej
// kazdy zalozylby konto i przez RLS `auth.role() = 'authenticated'` czytal
// dane osobowe. Zamiast tego: wniosek trafia do biura, a konto powstaje
// dopiero po kliknieciu „Zatwierdz" w mailu.
//
// POST {akcja:"zloz", email, imie, uzasadnienie}  -> wniosek + mail do biura
// GET  ?token=<64hex>&akcja=akceptuj|odrzuc       -> strona HTML z wynikiem
//
// Token akcji zna tylko odbiorca maila (biuro@gig.org.pl) — jest jednorazowy
// (po rozpatrzeniu wniosek zmienia status i token przestaje dzialac).
// Po akceptacji zakladamy konto BEZ HASLA i wysylamy wnioskodawcy link
// „ustaw haslo" (generateLink typu recovery) — hasla nie ustala nikt inny.
//
// Wdrozenie z verify_jwt = false: wniosek sklada osoba niezalogowana,
// a link akceptacyjny klika sie z klienta poczty.
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
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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
      from: Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>",
      to, subject, html,
    };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Resend:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return false;
  }
}

function strona(tytul: string, tresc: string, kolor = C.mid): Response {
  return new Response(
    `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${tytul} — panel GIG</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <div style="max-width:520px;background:#fff;border:1px solid #e6ebef;border-radius:14px;padding:34px;text-align:center;">
    <img src="${LOGO}" width="180" alt="GIG" style="display:block;margin:0 auto 20px;height:auto;">
    <h1 style="margin:0 0 12px;font-size:21px;color:${kolor};">${tytul}</h1>
    <div style="font-size:15px;line-height:1.65;">${tresc}</div>
  </div>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();

  // ── Klikniecie w mailu do biura: zatwierdzenie albo odrzucenie ─────────
  if (req.method === "GET") {
    const u = new URL(req.url);
    const token = (u.searchParams.get("token") ?? "").trim();
    const akcja = (u.searchParams.get("akcja") ?? "").trim();
    if (!/^[0-9a-f]{64}$/.test(token) || !["akceptuj", "odrzuc"].includes(akcja)) {
      return strona("Nieprawidłowy link", "<p>Ten link jest niepełny albo został już wykorzystany.</p>", "#8a99a3");
    }

    const w = await db.from("panel_wnioski").select("*").eq("token_akcji", token).maybeSingle();
    if (w.error || !w.data) {
      return strona("Nie znaleziono wniosku", "<p>Wniosek nie istnieje albo został usunięty.</p>", "#8a99a3");
    }
    if (w.data.status !== "oczekuje") {
      const co = w.data.status === "zaakceptowany" ? "zatwierdzony" : "odrzucony";
      return strona("Wniosek już rozpatrzony",
        `<p>Wniosek dla <strong>${esc(w.data.email)}</strong> został wcześniej <strong>${co}</strong>.</p>`, "#8a99a3");
    }

    if (akcja === "odrzuc") {
      await db.from("panel_wnioski").update({
        status: "odrzucony", rozpatrzono: new Date().toISOString(), rozpatrzyl: BIURO,
      }).eq("id", w.data.id);
      return strona("Wniosek odrzucony",
        `<p>Konto dla <strong>${esc(w.data.email)}</strong> <strong>nie</strong> zostało założone.
         Wnioskodawca nie dostaje powiadomienia.</p>`, "#8a99a3");
    }

    // Konto zakladamy BEZ hasla — ustawi je sam wnioskodawca z linku ponizej.
    const nowy = await db.auth.admin.createUser({ email: w.data.email, email_confirm: true });
    if (nowy.error && !/already/i.test(nowy.error.message)) {
      console.error("createUser:", nowy.error.message);
      return strona("Nie udało się założyć konta", `<p>${esc(nowy.error.message)}</p>`, C.mid);
    }

    const link = await db.auth.admin.generateLink({
      type: "recovery",
      email: w.data.email,
      options: { redirectTo: STRONA + "/admin/nowe-haslo.html" },
    });
    if (link.error) {
      console.error("generateLink:", link.error.message);
      return strona("Konto założone, ale bez linku",
        `<p>Konto <strong>${esc(w.data.email)}</strong> istnieje, ale nie udało się wysłać linku do ustawienia hasła.
         Poproś tę osobę o użycie „Nie pamiętasz hasła?" na stronie logowania.</p>`, C.mid);
    }

    await wyslij([w.data.email], "Twoje konto w panelu GIG jest gotowe", ramka("Konto zatwierdzone ✓", `
      <p style="margin:0 0 14px;">Dzień dobry,</p>
      <p style="margin:0 0 14px;">Twój wniosek o dostęp do panelu Geodezyjnej Izby Gospodarczej został zatwierdzony.
        Ostatni krok to ustawienie własnego hasła:</p>
      <p style="margin:0 0 18px;"><a href="${link.data.properties?.action_link}"
        style="display:inline-block;background:${C.mid};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Ustaw hasło</a></p>
      <p style="margin:0 0 14px;font-size:14px;">Link jest ważny 24 godziny i działa raz. Jeśli wygaśnie, użyj
        „Nie pamiętasz hasła?" na stronie <a href="${STRONA}/admin/" style="color:${C.mid};">${STRONA}/admin/</a>.</p>
      <p style="margin:0;font-size:13px;color:#6b7c8c;">Przy każdym logowaniu wyślemy dodatkowo kod na ten adres —
        to drugi składnik logowania, chroniący dane osobowe w panelu.</p>`));

    await db.from("panel_wnioski").update({
      status: "zaakceptowany", rozpatrzono: new Date().toISOString(), rozpatrzyl: BIURO,
    }).eq("id", w.data.id);

    return strona("Konto zatwierdzone ✓",
      `<p>Założyliśmy konto <strong>${esc(w.data.email)}</strong> i wysłaliśmy link do ustawienia hasła.</p>`);
  }

  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  // ── Zlozenie wniosku z formularza /admin/rejestracja.html ──────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }

  const email = String(body.email ?? "").trim().toLowerCase();
  const imie = String(body.imie ?? "").trim().slice(0, 120);
  const uzasadnienie = String(body.uzasadnienie ?? "").trim().slice(0, 1000);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Podaj poprawny adres e-mail." }, 400);
  if (!imie) return json({ error: "Podaj imię i nazwisko." }, 400);

  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  const ins = await db.from("panel_wnioski")
    .insert({ email, imie, uzasadnienie, token_akcji: token }).select("id").single();

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

  await wyslij([BIURO], `[GIG] Wniosek o dostęp do panelu — ${imie}`, ramka("Wniosek o konto w panelu", `
    <p style="margin:0 0 16px;">Ktoś prosi o dostęp do panelu administracyjnego gig.org.pl.</p>
    <div style="margin:0 0 18px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:14px;"><strong>${esc(imie)}</strong></p>
      <p style="margin:0 0 6px;font-size:14px;">${esc(email)}</p>
      ${uzasadnienie ? `<p style="margin:8px 0 0;font-size:14px;white-space:pre-wrap;">${esc(uzasadnienie)}</p>` : ""}
    </div>
    <p style="margin:0 0 18px;font-size:14px;"><strong>Zatwierdź tylko wtedy, gdy znasz tę osobę</strong> i wiesz,
      że ma prawo widzieć dane osobowe zgromadzone w panelu (zapisy na szkolenia, kontakt, baza adresów).</p>
    <p style="margin:0 0 22px;">
      <a href="${linkTak}" style="display:inline-block;background:${C.mid};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;margin-right:10px;">Zatwierdź konto</a>
      <a href="${linkNie}" style="display:inline-block;background:#8a99a3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Odrzuć</a>
    </p>
    <p style="margin:0;font-size:12.5px;color:#6b7c8c;">Nic się nie stanie, dopóki nie klikniesz.
      Zignorowany wniosek nie zakłada konta.</p>`), email);

  return json({ ok: true, zlozony: true });
});
