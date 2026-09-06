// ============================================================
// GIG — Edge Function: wyslij-kampanie
// Wysyła kampanię z kolejki (tabele `wysylki` + `wysylki_odbiorcy`) PORCJAMI.
// Panel woła ją wielokrotnie, aż zostanie 0 — dzięki temu:
//   • nie ma limitu czasu Edge Function (każde wywołanie robi kawałek),
//   • przerwana wysyłka wznawia się od miejsca przerwania,
//   • UNIQUE(wysylka_id, email) gwarantuje, że nikt nie dostanie maila dwa razy.
// Limit dzienny kampanii (`limit_dzienny`) służy rozgrzewce domeny — funkcja
// nigdy nie wyśle dziś więcej, niż on pozwala.
//
// Autoryzacja: Authorization: Bearer <access_token zalogowanego admina>.
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

/* Ta sama szata co w wyslij-mail: logo GIG, czerwona kreska, stopka z wypisem. */
function layout(title: string, body: string, unsubUrl: string): string {
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
        <div style="margin:22px 0 0;padding-top:16px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">Otrzymujesz tę wiadomość, ponieważ Twój adres jest w bazie kontaktów Geodezyjnej Izby Gospodarczej. Odpowiedź na ten mail trafi do biura Izby.</div>
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

  // ── tylko zalogowany administrator panelu ──
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ error: "brak uprawnien" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await sb.auth.getUser(jwt);
  if (uErr || !u?.user?.email) return json({ error: "brak uprawnien" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }
  const wysylkaId = String(body.wysylka_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(wysylkaId)) return json({ error: "brak wysylka_id" }, 400);
  const porcja = Math.min(PORCJA_MAX, Math.max(1, Number(body.porcja) || 300));

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: kampania, error: kErr } = await admin.from("wysylki").select("*").eq("id", wysylkaId).maybeSingle();
  if (kErr || !kampania) return json({ error: "nie znaleziono kampanii" }, 404);
  if (kampania.status === "wstrzymana") return json({ error: "kampania wstrzymana" }, 409);

  const zostaloCzeka = async () => {
    const { count } = await admin.from("wysylki_odbiorcy").select("id", { count: "exact", head: true })
      .eq("wysylka_id", wysylkaId).eq("status", "czeka");
    return count ?? 0;
  };

  // ── limit dzienny (rozgrzewka domeny) ──
  const poczatekDnia = new Date(); poczatekDnia.setHours(0, 0, 0, 0);
  const { count: dzisWyslane } = await admin.from("wysylki_odbiorcy").select("id", { count: "exact", head: true })
    .eq("wysylka_id", wysylkaId).eq("status", "wyslany").gte("wyslano_at", poczatekDnia.toISOString());
  const dzisiajZostalo = Math.max(0, (kampania.limit_dzienny ?? 200) - (dzisWyslane ?? 0));
  if (dzisiajZostalo === 0) {
    return json({ ok: true, wyslane: 0, bledy: 0, zostalo: await zostaloCzeka(), dzisiaj_zostalo: 0, status: kampania.status, info: "limit dzienny wyczerpany" });
  }

  const ile = Math.min(porcja, dzisiajZostalo);
  const { data: odbiorcy, error: oErr } = await admin.from("wysylki_odbiorcy")
    .select("id,email,baza_email_id").eq("wysylka_id", wysylkaId).eq("status", "czeka").limit(ile);
  if (oErr) return json({ error: "blad odczytu kolejki: " + oErr.message }, 500);

  if (!odbiorcy || odbiorcy.length === 0) {
    await admin.from("wysylki").update({ status: "zakonczona", updated_at: new Date().toISOString() }).eq("id", wysylkaId);
    return json({ ok: true, wyslane: 0, bledy: 0, zostalo: 0, dzisiaj_zostalo: dzisiajZostalo, status: "zakonczona" });
  }

  if (kampania.status !== "w_toku") {
    await admin.from("wysylki").update({ status: "w_toku", updated_at: new Date().toISOString() }).eq("id", wysylkaId);
  }

  const tresc = oczyscHtml(String(kampania.html ?? ""));
  const temat = String(kampania.temat ?? "").trim();
  let wyslane = 0, bledy = 0;

  for (let i = 0; i < odbiorcy.length; i += BATCH) {
    const paczka = odbiorcy.slice(i, i + BATCH);
    const payload = paczka.map((r) => {
      const wypis = r.baza_email_id
        ? `${FUNCTIONS_BASE}/baza-wypis?id=${encodeURIComponent(String(r.baza_email_id))}`
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
      return {
        from: FROM_EMAIL,
        to: [r.email as string],
        subject: temat,
        reply_to: REPLY_TO,
        headers: naglowki,
        html: layout(temat, tresc, wypis),
      };
    });

    let ok = false, komunikat = "";
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const wynik = await res.json().catch(() => ({}));
      ok = res.ok;
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
  await admin.from("wysylki").update({ status: nowyStatus, updated_at: new Date().toISOString() }).eq("id", wysylkaId);

  console.log(`wyslij-kampanie: ${u.user.email} kampania=${wysylkaId} wyslane=${wyslane} bledy=${bledy} zostalo=${zostalo}`);
  return json({ ok: true, wyslane, bledy, zostalo, dzisiaj_zostalo: Math.max(0, dzisiajZostalo - wyslane), status: nowyStatus });
});
