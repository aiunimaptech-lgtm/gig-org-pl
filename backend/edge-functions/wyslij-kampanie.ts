// ============================================================
// GIG — Edge Function: wyslij-kampanie (v8: wysyłka z serwera przez pg_cron, {{WYPIS}}, Reply-To kampanii;
//   v9 6.10.2026: rodzaj 'szkolenie' = zaplanowana wiadomość do uczestników szkolenia z panelu Zapisy,
//   stopka „zgłoszono Cię na szkolenie”, bez linku wypisu)
// Wysyła kampanię z kolejki (tabele `wysylki` + `wysylki_odbiorcy`) PORCJAMI.
// Panel woła ją wielokrotnie, aż zostanie 0 — dzięki temu:
//   • nie ma limitu czasu Edge Function (każde wywołanie robi kawałek),
//   • przerwana wysyłka wznawia się od miejsca przerwania,
//   • UNIQUE(wysylka_id, email) gwarantuje, że nikt nie dostanie maila dwa razy.
// Limit dzienny kampanii (`limit_dzienny`) służy rozgrzewce domeny — funkcja
// nigdy nie wyśle dziś więcej, niż on pozwala.
//
// Autoryzacja: Authorization: Bearer <access_token zalogowanego admina>
//   albo naglowek x-gig-cron = private.gig_sekrety 'kampanie_cron' (harmonogram w bazie:
//   gig_kampanie_tick() co minute wola te funkcje dla jednej kampanii z auto = true).
// Body: { wysylka_id: uuid, porcja?: number }  (porcja: ile maks. w tym wywołaniu)
// Zwraca: { ok, wyslane, bledy, zostalo, dzisiaj_zostalo, status }
//
// Sekrety: RESEND_API_KEY, FROM_EMAIL; SUPABASE_URL, SUPABASE_ANON_KEY,
//          SUPABASE_SERVICE_ROLE_KEY wstrzykiwane przez Supabase.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") ?? "biuro@gig.org.pl";
const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1";
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const RED = "#cc0a2b";
const BATCH = 100;              // limit Resend: 100 maili na jedno żądanie /emails/batch
const PORCJA_MAX = 1000;

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
/* Ladunek JWT bez weryfikacji podpisu (podpis sprawdzil juz auth.getUser). */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1] ?? "";
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch { return {}; }
}

/* Ta sama szata co w wyslij-mail: logo GIG, czerwona kreska, stopka z wypisem. */
function layout(title: string, body: string, unsubUrl: string, rodzaj = "baza", szkolenie = ""): string {
  const newsletter = rodzaj === "newsletter";
  /* Odbiorca ma wiedziec, SKAD mamy jego adres - inna odpowiedz dla kogos,
     kto sam zapisal sie na newsletter, inna dla adresu z bazy kontaktow. */
  const skad = rodzaj === "szkolenie"
    ? (szkolenie
      ? `Otrzymujesz tę wiadomość, ponieważ zgłoszono Cię na szkolenie GIG: <strong>${esc(szkolenie)}</strong>. Odpowiedź na ten mail trafi do biura Izby.`
      : "Otrzymujesz tę wiadomość jako uczestnik szkoleń Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.")
    : newsletter
    ? "Otrzymujesz tę wiadomość, ponieważ zapisałeś/-aś się do newslettera Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby."
    : "Otrzymujesz tę wiadomość, ponieważ Twój adres jest w bazie kontaktów Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.";
  const wypis = unsubUrl
    ? `<p style="margin:14px 0 0;font-size:12px;color:#9aa7b2;line-height:1.6;">${newsletter ? "Nie chcesz otrzymywać newslettera?" : "Nie chcesz otrzymywać wiadomości od Izby?"} <a href="${unsubUrl}" style="color:#9aa7b2;text-decoration:underline;">${newsletter ? "Wypisz się z newslettera" : "Wypisz się z listy"}</a>.</p>`
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
        <div style="margin:22px 0 0;padding-top:16px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">${skad}</div>
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:20px 34px;border-top:1px solid #e6ebef;">
        <p style="margin:0;font-size:12px;color:#7a8b97;line-height:1.7;">
          <strong style="color:#16202a;">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${RED};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${RED};text-decoration:none;">gig.org.pl</a>
        </p>
        <p style="margin:12px 0 0;font-size:12px;color:#7a8b97;line-height:1.7;">
          Więcej informacji o szkoleniach znajdziesz na stronie <a href="https://gig.org.pl/szkolenia/" style="color:${RED};text-decoration:none;">gig.org.pl/szkolenia</a>.<br>
          Chcesz być na bieżąco ze szkoleniami i wydarzeniami Izby? <a href="https://gig.org.pl/" style="color:${RED};text-decoration:none;">Zapisz się do newslettera GIG</a>.
        </p>
        ${wypis}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function oczyscHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<blockquote>/gi, `<blockquote style="margin:12px 0;padding:4px 0 4px 14px;border-left:3px solid #e6ebef;color:#6b7c8c;">`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  // ── harmonogram w bazie (pg_cron) albo zalogowany administrator panelu ──
  let kto = "";
  const cronTok = req.headers.get("x-gig-cron") ?? "";
  if (cronTok) {
    const { data: ok } = await admin.rpc("gig_cron_token_ok", { p_token: cronTok });
    if (ok !== true) return json({ error: "brak uprawnien" }, 401);
    kto = "serwer (harmonogram)";
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return json({ error: "brak uprawnien" }, 401);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u, error: uErr } = await sb.auth.getUser(jwt);
    if (uErr || !u?.user?.email) return json({ error: "brak uprawnien" }, 401);
    /* Audyt 8.09.2026: sesja musi byc na liscie panel_sesje_ok (przeszla kod z maila);
       sam poprawny JWT z publicznego grantu haslem to za malo. */
    const sid = String(jwtClaims(jwt).session_id ?? "");
    const s2 = /^[0-9a-f-]{36}$/i.test(sid)
      ? await admin.from("panel_sesje_ok").select("session_id").eq("session_id", sid).gt("wygasa", new Date().toISOString()).maybeSingle()
      : { data: null, error: null };
    if (s2.error || !s2.data) return json({ error: "sesja bez potwierdzenia kodem z e-maila - zaloguj sie ponownie" }, 401);
    kto = u.user.email;
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }
  const wysylkaId = String(body.wysylka_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(wysylkaId)) return json({ error: "brak wysylka_id" }, 400);
  const porcja = Math.min(PORCJA_MAX, Math.max(1, Number(body.porcja) || 300));

  const { data: kampania, error: kErr } = await admin.from("wysylki").select("*").eq("id", wysylkaId).maybeSingle();
  if (kErr || !kampania) return json({ error: "nie znaleziono kampanii" }, 404);
  if (kampania.status === "wstrzymana") return json({ error: "kampania wstrzymana" }, 409);

  const zostaloCzeka = async () => {
    const { count } = await admin.from("wysylki_odbiorcy").select("id", { count: "exact", head: true })
      .eq("wysylka_id", wysylkaId).in("status", ["czeka", "w_trakcie"]);
    return count ?? 0;
  };

  // ── limit dzienny (rozgrzewka domeny) ──
  const poczatekDnia = new Date(); poczatekDnia.setHours(0, 0, 0, 0);
  const { count: dzisWyslane } = await admin.from("wysylki_odbiorcy").select("id", { count: "exact", head: true })
    .eq("wysylka_id", wysylkaId).eq("status", "wyslany").gte("wyslano_at", poczatekDnia.toISOString());
  const dzisiajZostalo = Math.max(0, (kampania.limit_dzienny ?? 100) - (dzisWyslane ?? 0));
  if (dzisiajZostalo === 0) {
    return json({ ok: true, wyslane: 0, bledy: 0, zostalo: await zostaloCzeka(), dzisiaj_zostalo: 0, status: kampania.status, info: "limit dzienny wyczerpany" });
  }

  const ile = Math.min(porcja, dzisiajZostalo);
  /* Rezerwacja paczki w bazie (status 'w_trakcie', FOR UPDATE SKIP LOCKED): dwa równoległe
     wywołania (harmonogram i panel) nigdy nie dostaną tych samych adresów. */
  const { data: kolejka, error: oErr } = await admin.rpc("gig_wysylka_pobierz", { p_wysylka: wysylkaId, p_ile: ile });
  if (oErr) return json({ error: "blad odczytu kolejki: " + oErr.message }, 500);

  if (!kolejka || kolejka.length === 0) {
    const zost = await zostaloCzeka();
    if (zost === 0) {
      await admin.from("wysylki").update({ status: "zakonczona", updated_at: new Date().toISOString() }).eq("id", wysylkaId).neq("status", "wstrzymana");
    }
    return json({ ok: true, wyslane: 0, bledy: 0, zostalo: zost, dzisiaj_zostalo: dzisiajZostalo, status: zost === 0 ? "zakonczona" : kampania.status });
  }

  if (kampania.status !== "w_toku") {
    await admin.from("wysylki").update({ status: "w_toku", updated_at: new Date().toISOString() }).eq("id", wysylkaId);
  }

  /* Adres mogl zostac wypisany albo odbic sie juz po zbudowaniu kolejki
     (link wypisu, webhook Resend -> resend-webhook). Sprawdzamy stan tuz przed wysylka. */
  const nieaktywne = new Set<string>();
  const bazaIds = kolejka.map((r) => r.baza_email_id as string).filter(Boolean);
  for (let i = 0; i < bazaIds.length; i += 150) {
    const { data: st } = await admin.from("baza_email").select("id,status,usuniety_panel").in("id", bazaIds.slice(i, i + 150));
    for (const r of st ?? []) if ((r.status && r.status !== "active") || r.usuniety_panel) nieaktywne.add("b:" + r.id);
  }
  const nlIds = kolejka.map((r) => r.newsletter_id as string).filter(Boolean);
  for (let i = 0; i < nlIds.length; i += 150) {
    const { data: st } = await admin.from("submissions_newsletter").select("id,status").in("id", nlIds.slice(i, i + 150));
    for (const r of st ?? []) if (r.status === "unsubscribed") nieaktywne.add("n:" + r.id);
  }
  const pomin = (r: Record<string, unknown>) =>
    (r.baza_email_id && nieaktywne.has("b:" + r.baza_email_id)) || (r.newsletter_id && nieaktywne.has("n:" + r.newsletter_id));
  const pominiete = kolejka.filter(pomin);
  if (pominiete.length) {
    await admin.from("wysylki_odbiorcy").update({ status: "blad", blad: "pominiety: adres wypisany lub odbity" }).in("id", pominiete.map((r) => r.id as string));
  }
  const odbiorcy = kolejka.filter((r) => !pomin(r));
  // Reply-To z kampanii (panel: Edytuj -> „Odpowiedzi na adres”), inaczej REPLY_TO_EMAIL
  const replyTo = (kampania.reply_to && String(kampania.reply_to).trim()) || REPLY_TO;

  const tresc = oczyscHtml(String(kampania.html ?? ""));
  const temat = String(kampania.temat ?? "").trim();
  const rodzaj = kampania.rodzaj === "newsletter" || kampania.rodzaj === "szkolenie" ? kampania.rodzaj : "baza";
  const szkolenie = String(kampania.szkolenie ?? "").trim();
  let wyslane = 0, bledy = pominiete.length;

  for (let i = 0; i < odbiorcy.length; i += BATCH) {
    const paczka = odbiorcy.slice(i, i + BATCH);
    const payload = paczka.map((r) => {
      /* Link wypisu zalezy od tego, skad jest adres: Baza e-mail ma swoj
         (baza-wypis), zapis z newslettera swoj (newsletter-unsubscribe). */
      const wypis = r.baza_email_id
        ? `${FUNCTIONS_BASE}/baza-wypis?id=${encodeURIComponent(String(r.baza_email_id))}`
        : r.newsletter_id
          ? `${FUNCTIONS_BASE}/newsletter-unsubscribe?id=${encodeURIComponent(String(r.newsletter_id))}`
          : "";
      /* List-Unsubscribe: filtry (m.in. rspamd u polskich hostingow) traktuja
         masowa poczte BEZ tego naglowka jako podejrzana, a Gmail/Yahoo wymagaja
         go od nadawcow masowych. `List-Unsubscribe-Post` wlacza przycisk
         „Wypisz sie" w interfejsie poczty — dlatego oba naraz. */
      const naglowki: Record<string, string> = wypis
        ? {
          "List-Unsubscribe": `<${wypis}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
        : {};
      /* Link dla czlowieka (stopka i znacznik {{WYPIS}} w tresci): strona gig.org.pl/wypis/
         z potwierdzeniem. Samo otwarcie niczego nie zmienia, bo filtry pocztowe klikaja
         linki automatycznie. Naglowek List-Unsubscribe zostaje przy funkcji (POST jednym klikiem). */
      const strona = r.baza_email_id
        ? `https://gig.org.pl/wypis/?id=${encodeURIComponent(String(r.baza_email_id))}`
        : wypis;
      const trescOdb = tresc.replace(/\{\{WYPIS\}\}|%7B%7BWYPIS%7D%7D/gi, strona || "https://gig.org.pl/kontakt/");
      return {
        from: FROM_EMAIL,
        to: [r.email as string],
        subject: temat,
        reply_to: replyTo,
        headers: naglowki,
        html: layout(temat, trescOdb, strona, rodzaj, szkolenie),
      };
    });

    let ok = false, komunikat = "";
    if (i > 0) await new Promise((r) => setTimeout(r, 600));   // Resend: 2 zapytania na sekunde
    try {
      let res: Response | null = null;
      for (let proba = 0; proba < 3; proba++) {
        res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status !== 429) break;                          // chwilowa odmowa: odczekaj i ponow
        await new Promise((r) => setTimeout(r, 1500 * (proba + 1)));
      }
      const wynik = await res!.json().catch(() => ({}));
      ok = res!.ok;
      if (!ok) { komunikat = JSON.stringify(wynik).slice(0, 300); console.error("Resend batch:", komunikat); }
    } catch (err) {
      komunikat = String(err).slice(0, 300);
      console.error("Resend batch (wyjatek):", komunikat);
    }

    const ids = paczka.map((r) => r.id as string);
    if (ok) {
      await admin.from("wysylki_odbiorcy").update({ status: "wyslany", wyslano_at: new Date().toISOString(), blad: null }).in("id", ids);
      wyslane += paczka.length;
    } else {
      await admin.from("wysylki_odbiorcy").update({ status: "blad", blad: komunikat || "blad wysylki" }).in("id", ids);
      bledy += paczka.length;
    }
  }

  const zostalo = await zostaloCzeka();
  const nowyStatus = zostalo === 0 ? "zakonczona" : "w_toku";
  // .neq: pauza kliknięta w trakcie paczki zostaje pauzą
  await admin.from("wysylki").update({ status: nowyStatus, updated_at: new Date().toISOString() }).eq("id", wysylkaId).neq("status", "wstrzymana");

  console.log(`wyslij-kampanie: ${kto} kampania=${wysylkaId} wyslane=${wyslane} bledy=${bledy} (pominiete=${pominiete.length}) zostalo=${zostalo}`);
  return json({ ok: true, wyslane, bledy, pominiete: pominiete.length, zostalo, dzisiaj_zostalo: Math.max(0, dzisiajZostalo - wyslane), status: nowyStatus });
});
