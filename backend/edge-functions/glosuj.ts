// ============================================================
// GIG — Edge Function: glosuj
// Głosowanie członka Rady Izby nad uchwałą z osobistego linku z maila
// (strona /glosowanie/?t=<token>). Bez logowania: uprawnienie daje sam token
// (32 losowe znaki, jeden na osobę i uchwałę, tabela uchwaly_glosy).
// Wdrożenie z verify_jwt = false. Pisze kluczem service_role - anon nie ma
// żadnych praw do tabel uchwał.
//
//   GET  ?t=<token>                         → dane do wyświetlenia (uchwała, kto głosuje, czy już głosował)
//   POST { t, glos: 'za'|'przeciw', uzasadnienie? } → zapis głosu (jeden, ostateczny)
//
// Gdy po zapisie nie zostaje nikt bez głosu, biuro dostaje krótką wiadomość
// (NOTIFY_EMAILS), żeby nie musiało zaglądać do panelu.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const NOTIFY_EMAILS = (Deno.env.get("NOTIFY_EMAILS") ?? "biuro@gig.org.pl")
  .split(",").map((x) => x.trim()).filter(Boolean);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

type Glos = {
  id: string; uchwala_id: string; imie_nazwisko: string; email: string; glos: string | null;
  uzasadnienie: string | null; glosowano_at: string | null;
  uchwaly: { id: string; numer: string | null; kandydat_osoba: string | null; kandydat_firma: string | null;
             kandydat_adres: string | null; data_wejscia: string; tresc: string; status: string; wyslano_at: string | null } | null;
};

async function poTokenie(t: string): Promise<Glos | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const r = await db().from("uchwaly_glosy")
    .select("id,uchwala_id,imie_nazwisko,email,glos,uzasadnienie,glosowano_at,uchwaly(id,numer,kandydat_osoba,kandydat_firma,kandydat_adres,data_wejscia,tresc,status,wyslano_at)")
    .eq("token", t).maybeSingle();
  if (r.error) { console.error(r.error); return null; }
  return (r.data as unknown as Glos | null) ?? null;
}

function widok(g: Glos) {
  const u = g.uchwaly!;
  return {
    ok: true,
    glosujacy: { imie_nazwisko: g.imie_nazwisko },
    uchwala: { numer: u.numer, kandydat_osoba: u.kandydat_osoba, kandydat_firma: u.kandydat_firma,
               kandydat_adres: u.kandydat_adres, data_wejscia: u.data_wejscia, tresc: u.tresc, status: u.status, wyslano_at: u.wyslano_at },
    glos: g.glos ? { glos: g.glos, uzasadnienie: g.uzasadnienie, glosowano_at: g.glosowano_at } : null,
    otwarte: u.status === "glosowanie",
  };
}

/* Krótkie powiadomienie do biura, gdy głosowanie się domknęło. Błąd wysyłki
   nie może zepsuć odpowiedzi dla głosującego - jego głos jest już zapisany. */
async function powiadomBiuro(u: NonNullable<Glos["uchwaly"]>, za: number, przeciw: number) {
  if (!RESEND_API_KEY || !NOTIFY_EMAILS.length) return;
  const kogo = u.kandydat_osoba || u.kandydat_firma || "";
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">Wszyscy członkowie Rady oddali głos w sprawie uchwały
    ${u.numer ? "nr " + esc(u.numer) : "(bez numeru)"} o przyjęciu do GIG: <strong>${esc(kogo)}</strong>.<br>
    Wynik: <strong>${za} za</strong>, <strong>${przeciw} przeciw</strong>.<br><br>
    Raport i zamknięcie głosowania: <a href="https://gig.org.pl/admin/uchwaly.html">panel GIG → Uchwały Rady</a>.</p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAILS, subject: `[GIG] Głosowanie zakończone: ${kogo} (${za} za, ${przeciw} przeciw)`, html }),
    });
  } catch (e) { console.error("powiadomienie:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    const g = await poTokenie(t);
    if (!g || !g.uchwaly) return json({ error: "Ten link jest nieprawidłowy albo głosowanie zostało usunięte." }, 404);
    return json(widok(g));
  }

  if (req.method !== "POST") return json({ error: "tylko GET/POST" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidłowe dane" }, 400); }
  const t = String(body.t ?? "");
  const glos = String(body.glos ?? "");
  const uzasadnienie = String(body.uzasadnienie ?? "").trim().slice(0, 2000);
  if (!["za", "przeciw"].includes(glos)) return json({ error: "Wybierz: za albo przeciw." }, 400);

  const g = await poTokenie(t);
  if (!g || !g.uchwaly) return json({ error: "Ten link jest nieprawidłowy albo głosowanie zostało usunięte." }, 404);
  if (g.uchwaly.status !== "glosowanie") return json({ error: "Głosowanie nad tą uchwałą jest już zamknięte.", ...widok(g) }, 409);
  if (g.glos) return json({ error: "Głos w tej sprawie został już oddany i nie można go zmienić.", ...widok(g) }, 409);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const teraz = new Date().toISOString();
  // warunek `is('glos', null)` chroni przed podwójnym zapisem przy dwóch równoległych kliknięciach
  const up = await db().from("uchwaly_glosy")
    .update({ glos, uzasadnienie: uzasadnienie || null, glosowano_at: teraz, ip })
    .eq("id", g.id).is("glos", null).select("id");
  if (up.error) return json({ error: "Nie udało się zapisać głosu. Spróbuj ponownie." }, 500);
  if (!up.data || !up.data.length) return json({ error: "Głos w tej sprawie został już oddany." }, 409);

  // czy to był ostatni brakujący głos?
  const wszystkie = await db().from("uchwaly_glosy").select("glos").eq("uchwala_id", g.uchwala_id);
  const lista = (wszystkie.data ?? []) as Array<{ glos: string | null }>;
  if (lista.length && lista.every((x) => x.glos)) {
    await powiadomBiuro(g.uchwaly, lista.filter((x) => x.glos === "za").length, lista.filter((x) => x.glos === "przeciw").length);
  }

  console.log(`glosuj: ${g.email} -> ${glos} (${g.uchwala_id})`);
  const swiezy = await poTokenie(t);
  return json(swiezy ? widok(swiezy) : { ok: true });
});
