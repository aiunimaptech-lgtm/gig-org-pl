// ============================================================
// GIG — Edge Function: glosuj
// Obsługuje obie odpowiedzi z osobistego linku z maila (strona /glosowanie/?t=<token>):
//   etap 'opinia'  – opinia Prezydium Rady o kandydacie (art. 12 pkt 1 Statutu),
//   etap 'uchwala' – głos członka Rady nad uchwałą o przyjęciu.
// Bez logowania: uprawnienie daje sam token (32 losowe znaki, jeden na osobę,
// etap i sprawę, tabela uchwaly_glosy). Wdrożenie z verify_jwt = false.
// Pisze kluczem service_role - anon nie ma żadnych praw do tabel uchwał.
//
//   GET  ?t=<token>                         → dane do wyświetlenia (etap, sprawa, czy już odpowiedział)
//   POST { t, glos: 'za'|'przeciw', uzasadnienie? } → zapis odpowiedzi (jeden, ostateczny)
//
// Gdy po zapisie nie zostaje nikt bez odpowiedzi, biuro dostaje krótką wiadomość
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

type Sprawa = {
  id: string; numer: string | null; kandydat_osoba: string | null; kandydat_firma: string | null;
  kandydat_adres: string | null; kandydat_nip: string | null; kandydat_regon: string | null;
  kandydat_krs: string | null; kandydat_email: string | null; kandydat_telefon: string | null;
  kandydat_www: string | null; kandydat_opis: string | null; kandydat_pkd: string | null;
  kandydat_osob: string | null; data_wejscia: string; tresc: string; status: string;
  wyslano_at: string | null; opinia_status: string; opinia_termin: string | null;
  opinia_wyslano_at: string | null; dok_rodzaj: string | null; wpisowe_oplacone: boolean;
};

type Glos = {
  id: string; uchwala_id: string; imie_nazwisko: string; email: string; glos: string | null;
  uzasadnienie: string | null; glosowano_at: string | null; etap: string; rola: string | null;
  uchwaly: Sprawa | null;
};

const POLA = "id,numer,kandydat_osoba,kandydat_firma,kandydat_adres,kandydat_nip,kandydat_regon," +
  "kandydat_krs,kandydat_email,kandydat_telefon,kandydat_www,kandydat_opis,kandydat_pkd,kandydat_osob," +
  "data_wejscia,tresc,status,wyslano_at,opinia_status,opinia_termin,opinia_wyslano_at,dok_rodzaj,wpisowe_oplacone";

async function poTokenie(t: string): Promise<Glos | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const r = await db().from("uchwaly_glosy")
    .select(`id,uchwala_id,imie_nazwisko,email,glos,uzasadnienie,glosowano_at,etap,rola,uchwaly(${POLA})`)
    .eq("token", t).maybeSingle();
  if (r.error) { console.error(r.error); return null; }
  return (r.data as unknown as Glos | null) ?? null;
}

/* Czy w tym etapie wciąż można odpowiadać. Opinia zamyka się osobno od uchwały,
   więc sprawdzamy inny zestaw pól dla każdego etapu. */
function czyOtwarte(g: Glos): boolean {
  const u = g.uchwaly!;
  return g.etap === "opinia"
    ? u.status === "opiniowanie" && u.opinia_status === "glosowanie"
    : u.status === "glosowanie";
}

function widok(g: Glos) {
  const u = g.uchwaly!;
  return {
    ok: true,
    etap: g.etap,
    rola: g.rola,
    glosujacy: { imie_nazwisko: g.imie_nazwisko },
    uchwala: {
      numer: u.numer, kandydat_osoba: u.kandydat_osoba, kandydat_firma: u.kandydat_firma,
      kandydat_adres: u.kandydat_adres, kandydat_nip: u.kandydat_nip, kandydat_regon: u.kandydat_regon,
      kandydat_krs: u.kandydat_krs, kandydat_email: u.kandydat_email, kandydat_telefon: u.kandydat_telefon,
      kandydat_www: u.kandydat_www, kandydat_opis: u.kandydat_opis, kandydat_pkd: u.kandydat_pkd,
      kandydat_osob: u.kandydat_osob, data_wejscia: u.data_wejscia,
      tresc: g.etap === "opinia" ? "" : u.tresc,     // przy opinii uchwały jeszcze nie ma
      status: u.status, wyslano_at: u.wyslano_at,
      opinia_termin: u.opinia_termin, opinia_wyslano_at: u.opinia_wyslano_at,
      dok_rodzaj: u.dok_rodzaj, wpisowe_oplacone: u.wpisowe_oplacone,
    },
    glos: g.glos ? { glos: g.glos, uzasadnienie: g.uzasadnienie, glosowano_at: g.glosowano_at } : null,
    otwarte: czyOtwarte(g),
  };
}

/* Krótkie powiadomienie do biura, gdy etap się domknął. Błąd wysyłki nie może
   zepsuć odpowiedzi dla głosującego - jego głos jest już zapisany. */
async function powiadomBiuro(u: Sprawa, etap: string, za: number, przeciw: number) {
  if (!RESEND_API_KEY || !NOTIFY_EMAILS.length) return;
  const kogo = u.kandydat_firma || u.kandydat_osoba || "";
  const opinia = etap === "opinia";
  const co = opinia ? "Prezydium wydało opinię" : "Rada zakończyła głosowanie";
  const jak = opinia ? `${za} pozytywnych, ${przeciw} negatywnych` : `${za} za, ${przeciw} przeciw`;
  const dalej = opinia
    ? "Po pozytywnej opinii panel odblokuje projekt uchwały Rady o przyjęciu."
    : "Raport i zamknięcie głosowania czekają w panelu.";
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">${esc(co)} w sprawie przyjęcia do GIG:
    <strong>${esc(kogo)}</strong>${u.numer ? " (uchwała nr " + esc(u.numer) + ")" : ""}.<br>
    Wynik: <strong>${esc(jak)}</strong>.<br><br>${esc(dalej)}<br>
    <a href="https://gig.org.pl/admin/uchwaly.html?id=${encodeURIComponent(u.id)}">panel GIG → Uchwały Rady</a></p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL, to: NOTIFY_EMAILS,
        subject: `[GIG] ${opinia ? "Opiniowanie" : "Głosowanie"} zakończone: ${kogo} (${jak})`, html,
      }),
    });
  } catch (e) { console.error("powiadomienie:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    const g = await poTokenie(t);
    if (!g || !g.uchwaly) return json({ error: "Ten link jest nieprawidłowy albo sprawa została usunięta." }, 404);
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
  if (!g || !g.uchwaly) return json({ error: "Ten link jest nieprawidłowy albo sprawa została usunięta." }, 404);
  const opinia = g.etap === "opinia";
  if (!czyOtwarte(g)) {
    return json({ error: opinia ? "Opiniowanie tego kandydata jest już zamknięte." : "Głosowanie nad tą uchwałą jest już zamknięte.", ...widok(g) }, 409);
  }
  if (g.glos) {
    return json({ error: opinia ? "Opinia w tej sprawie została już wydana i nie można jej zmienić." : "Głos w tej sprawie został już oddany i nie można go zmienić.", ...widok(g) }, 409);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const teraz = new Date().toISOString();
  // warunek `is('glos', null)` chroni przed podwójnym zapisem przy dwóch równoległych kliknięciach
  const up = await db().from("uchwaly_glosy")
    .update({ glos, uzasadnienie: uzasadnienie || null, glosowano_at: teraz, ip })
    .eq("id", g.id).is("glos", null).select("id");
  if (up.error) return json({ error: "Nie udało się zapisać odpowiedzi. Spróbuj ponownie." }, 500);
  if (!up.data || !up.data.length) return json({ error: "Odpowiedź w tej sprawie została już zapisana." }, 409);

  // czy to była ostatnia brakująca odpowiedź w tym etapie?
  const wszystkie = await db().from("uchwaly_glosy").select("glos").eq("uchwala_id", g.uchwala_id).eq("etap", g.etap);
  const lista = (wszystkie.data ?? []) as Array<{ glos: string | null }>;
  if (lista.length && lista.every((x) => x.glos)) {
    await powiadomBiuro(g.uchwaly, g.etap, lista.filter((x) => x.glos === "za").length, lista.filter((x) => x.glos === "przeciw").length);
  }

  console.log(`glosuj: ${g.email} [${g.etap}] -> ${glos} (${g.uchwala_id})`);
  const swiezy = await poTokenie(t);
  return json(swiezy ? widok(swiezy) : { ok: true });
});
