// ============================================================
// GIG — Edge Function: konsultacja-glosuj
// Odpowiedź na doraźne zapytanie Izby z osobistego linku z maila
// (strona /ankieta/?t=<token>). Bez logowania: uprawnienie daje sam token.
// Wdrożenie z verify_jwt = false. Pisze kluczem service_role - anon nie ma
// żadnych praw do tabel konsultacji.
//
//   GET  ?t=<token>                                 → treść zapytania i stan odpowiedzi
//   POST { t, glos: 'za'|'przeciw', uzasadnienie? } → zapis odpowiedzi (jednej, ostatecznej)
//
// Gdy odpowiedzą już wszyscy, biuro dostaje krótką wiadomość (NOTIFY_EMAILS).
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

type Konsultacja = {
  id: string; temat: string; tresc: string; pytanie: string;
  etykieta_za: string; etykieta_przeciw: string; termin: string | null; status: string;
};
type Glos = {
  id: string; konsultacja_id: string; imie_nazwisko: string; email: string; organizacja: string | null;
  glos: string | null; uzasadnienie: string | null; glosowano_at: string | null;
  konsultacje: Konsultacja | null;
};

const POLA = "id,temat,tresc,pytanie,etykieta_za,etykieta_przeciw,termin,status";

async function poTokenie(t: string): Promise<Glos | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const r = await db().from("konsultacje_glosy")
    .select(`id,konsultacja_id,imie_nazwisko,email,organizacja,glos,uzasadnienie,glosowano_at,konsultacje(${POLA})`)
    .eq("token", t).maybeSingle();
  if (r.error) { console.error(r.error); return null; }
  return (r.data as unknown as Glos | null) ?? null;
}

function widok(g: Glos) {
  const k = g.konsultacje!;
  return {
    ok: true,
    odpowiadajacy: { imie_nazwisko: g.imie_nazwisko, organizacja: g.organizacja },
    konsultacja: {
      temat: k.temat, tresc: k.tresc, pytanie: k.pytanie,
      etykieta_za: k.etykieta_za, etykieta_przeciw: k.etykieta_przeciw,
      termin: k.termin, status: k.status,
    },
    glos: g.glos ? { glos: g.glos, uzasadnienie: g.uzasadnienie, glosowano_at: g.glosowano_at } : null,
    otwarte: k.status === "glosowanie",
  };
}

/* Krótkie powiadomienie do biura po ostatniej odpowiedzi. Błąd wysyłki nie może
   zepsuć odpowiedzi dla głosującego - jego głos jest już zapisany. */
async function powiadomBiuro(k: Konsultacja, za: number, przeciw: number) {
  if (!RESEND_API_KEY || !NOTIFY_EMAILS.length) return;
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
    Wszyscy odbiorcy odpowiedzieli na konsultację: <strong>${esc(k.temat)}</strong>.<br>
    Wynik: <strong>${za} za</strong>, <strong>${przeciw} przeciw</strong>.<br><br>
    Zestawienie i zamknięcie: <a href="https://gig.org.pl/admin/konsultacje.html?id=${encodeURIComponent(k.id)}">panel GIG → Konsultacje</a>.</p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAILS, subject: `[GIG] Konsultacja zakończona: ${k.temat} (${za} za, ${przeciw} przeciw)`, html }),
    });
  } catch (e) { console.error("powiadomienie:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    const g = await poTokenie(t);
    if (!g || !g.konsultacje) return json({ error: "Ten link jest nieprawidłowy albo zapytanie zostało usunięte." }, 404);
    return json(widok(g));
  }

  if (req.method !== "POST") return json({ error: "tylko GET/POST" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidłowe dane" }, 400); }
  const t = String(body.t ?? "");
  const glos = String(body.glos ?? "");
  const uzasadnienie = String(body.uzasadnienie ?? "").trim().slice(0, 2000);
  if (!["za", "przeciw"].includes(glos)) return json({ error: "Wybierz jedną z dwóch odpowiedzi." }, 400);

  const g = await poTokenie(t);
  if (!g || !g.konsultacje) return json({ error: "Ten link jest nieprawidłowy albo zapytanie zostało usunięte." }, 404);
  if (g.konsultacje.status !== "glosowanie") {
    return json({ error: "To zapytanie jest już zamknięte.", ...widok(g) }, 409);
  }
  if (g.glos) {
    return json({ error: "Odpowiedź w tej sprawie została już zapisana i nie można jej zmienić.", ...widok(g) }, 409);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const teraz = new Date().toISOString();
  // warunek `is('glos', null)` chroni przed podwojnym zapisem przy dwoch rownoleglych klikniec
  const up = await db().from("konsultacje_glosy")
    .update({ glos, uzasadnienie: uzasadnienie || null, glosowano_at: teraz, ip })
    .eq("id", g.id).is("glos", null).select("id");
  if (up.error) return json({ error: "Nie udało się zapisać odpowiedzi. Spróbuj ponownie." }, 500);
  if (!up.data || !up.data.length) return json({ error: "Odpowiedź w tej sprawie została już zapisana." }, 409);

  const wszystkie = await db().from("konsultacje_glosy").select("glos").eq("konsultacja_id", g.konsultacja_id);
  const lista = (wszystkie.data ?? []) as Array<{ glos: string | null }>;
  if (lista.length && lista.every((x) => x.glos)) {
    await powiadomBiuro(g.konsultacje, lista.filter((x) => x.glos === "za").length, lista.filter((x) => x.glos === "przeciw").length);
  }

  console.log(`konsultacja-glosuj: ${g.email} -> ${glos} (${g.konsultacja_id})`);
  const swiezy = await poTokenie(t);
  return json(swiezy ? widok(swiezy) : { ok: true });
});
