// ============================================================
// GIG — Edge Function: wizytowka
// Członek Izby sprawdza i uzupełnia swoją wizytówkę w katalogu /czlonkowie/
// z osobistego linku z maila (strona /wizytowka/?t=<token>). Bez logowania:
// uprawnienie daje sam token. Wdrożenie z verify_jwt = false. Pisze kluczem
// service_role - anon nie ma praw do tabeli wizytowki_weryfikacja.
//
//   GET  ?t=<token>          → obecne dane firmy + ostatnie zgłoszenie
//   POST { t, ...pola }      → zapis propozycji (status 'zgloszono')
//
// Zgłoszenie NIE zmienia katalogu. Biuro zatwierdza je w /admin/wizytowki.html,
// a o każdym nowym zgłoszeniu dostaje krótkiego maila (NOTIFY_EMAILS).
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

const WOJ = ["Dolnośląskie", "Kujawsko-pomorskie", "Lubelskie", "Lubuskie", "Łódzkie", "Małopolskie",
  "Mazowieckie", "Opolskie", "Podkarpackie", "Podlaskie", "Pomorskie", "Śląskie", "Świętokrzyskie",
  "Warmińsko-Mazurskie", "Wielkopolskie", "Zachodniopomorskie"];
const OPIS_MAX = 700;

const POLA_FIRMY = "id,name,person,phone,email,address,region,website,linkedin,facebook,description,nip,zweryfikowano_at";
const POLA_ZGL = "id,czlonek_id,status,zgloszono_at,otwarto_at,p_name,p_person,p_phone,p_email,p_address,p_region," +
  "p_website,p_linkedin,p_facebook,p_description,brak_www,brak_linkedin,brak_facebook,uwagi,rozpatrzono_at";

type Zgl = Record<string, unknown> & { id: string; czlonek_id: string; status: string; otwarto_at: string | null };

async function poTokenie(t: string): Promise<Zgl | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const r = await db().from("wizytowki_weryfikacja").select(POLA_ZGL).eq("token", t).maybeSingle();
  if (r.error) { console.error(r.error); return null; }
  return (r.data as Zgl | null) ?? null;
}
async function firma(id: string) {
  const r = await db().from("czlonkowie").select(POLA_FIRMY).eq("id", id).maybeSingle();
  return r.error ? null : r.data;
}

function czysc(v: unknown, max = 300): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
/* Adres strony: dopisujemy https://, gdy ktoś wkleił samo „www.firma.pl". */
function url(v: unknown): string {
  let s = czysc(v, 400);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  try { const u = new URL(s); return /\./.test(u.hostname) ? u.toString() : ""; } catch { return ""; }
}

function widok(z: Zgl, f: Record<string, unknown>) {
  const zgloszenie = z.status === "wyslano" ? null : {
    status: z.status, zgloszono_at: z.zgloszono_at, rozpatrzono_at: z.rozpatrzono_at,
    name: z.p_name, person: z.p_person, phone: z.p_phone, email: z.p_email, address: z.p_address,
    region: z.p_region, website: z.p_website, linkedin: z.p_linkedin, facebook: z.p_facebook,
    description: z.p_description, brak_www: z.brak_www, brak_linkedin: z.brak_linkedin,
    brak_facebook: z.brak_facebook, uwagi: z.uwagi,
  };
  return { ok: true, firma: f, zgloszenie, wojewodztwa: WOJ, opis_max: OPIS_MAX };
}

async function powiadomBiuro(nazwa: string, id: string, uwagi: string) {
  if (!RESEND_API_KEY || !NOTIFY_EMAILS.length) return;
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
    Firma <strong>${esc(nazwa)}</strong> przesłała zaktualizowaną wizytówkę do katalogu Członków.<br>
    ${uwagi ? `Wiadomość do biura: <em>${esc(uwagi)}</em><br>` : ""}<br>
    Przejrzyj zmiany i zatwierdź je: <a href="https://gig.org.pl/admin/wizytowki.html?id=${encodeURIComponent(id)}">panel GIG → Wizytówki członków</a>.
    Do czasu zatwierdzenia na stronie widać poprzednie dane.</p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAILS, subject: `[GIG] Wizytówka do zatwierdzenia: ${nazwa}`, html }),
    });
  } catch (e) { console.error("powiadomienie:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t") ?? "";
    const z = await poTokenie(t);
    const f = z ? await firma(z.czlonek_id) : null;
    if (!z || !f) return json({ error: "Ten link jest nieprawidłowy albo wygasł. Napisz do nas: biuro@gig.org.pl." }, 404);
    if (!z.otwarto_at) {
      await db().from("wizytowki_weryfikacja").update({ otwarto_at: new Date().toISOString() }).eq("id", z.id).is("otwarto_at", null);
    }
    return json(widok(z, f as Record<string, unknown>));
  }

  if (req.method !== "POST") return json({ error: "tylko GET/POST" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "nieprawidłowe dane" }, 400); }

  const z = await poTokenie(String(b.t ?? ""));
  const f = z ? await firma(z.czlonek_id) : null;
  if (!z || !f) return json({ error: "Ten link jest nieprawidłowy albo wygasł." }, 404);

  const name = czysc(b.name, 200);
  const email = czysc(b.email, 200).toLowerCase();
  const region = czysc(b.region, 40);
  const description = String(b.description ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const brak_www = b.brak_www === true, brak_linkedin = b.brak_linkedin === true, brak_facebook = b.brak_facebook === true;
  const website = brak_www ? "" : url(b.website);
  const linkedin = brak_linkedin ? "" : url(b.linkedin);
  const facebook = brak_facebook ? "" : url(b.facebook);

  if (!name) return json({ error: "Podaj nazwę firmy." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Podaj poprawny adres e-mail firmy." }, 400);
  if (region && !WOJ.includes(region)) return json({ error: "Wybierz województwo z listy." }, 400);
  if (description.length > OPIS_MAX) return json({ error: `Opis firmy może mieć najwyżej ${OPIS_MAX} znaków.` }, 400);
  if (!brak_www && czysc(b.website) && !website) return json({ error: "Adres strony internetowej wygląda na niepoprawny." }, 400);
  if (!brak_linkedin && czysc(b.linkedin) && !/linkedin\.com/i.test(linkedin)) return json({ error: "Link do LinkedIn powinien prowadzić do linkedin.com." }, 400);
  if (!brak_facebook && czysc(b.facebook) && !/(facebook\.com|fb\.com|fb\.me)/i.test(facebook)) return json({ error: "Link do Facebooka powinien prowadzić do facebook.com." }, 400);

  const uwagi = String(b.uwagi ?? "").trim().slice(0, 1000);
  const teraz = new Date().toISOString();
  const up = await db().from("wizytowki_weryfikacja").update({
    status: "zgloszono", zgloszono_at: teraz, updated_at: teraz,
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    p_name: name, p_person: czysc(b.person, 200), p_phone: czysc(b.phone, 60), p_email: email,
    p_address: czysc(b.address, 300), p_region: region || null,
    p_website: website || null, p_linkedin: linkedin || null, p_facebook: facebook || null,
    p_description: description || null, brak_www, brak_linkedin, brak_facebook,
    uwagi: uwagi || null, rozpatrzono_at: null, rozpatrzyl: null, notatka_biura: null,
  }).eq("id", z.id).select(POLA_ZGL).single();
  if (up.error) { console.error(up.error); return json({ error: "Nie udało się zapisać zmian. Spróbuj ponownie." }, 500); }

  await powiadomBiuro(name, z.id, uwagi);
  console.log(`wizytowka: zgloszenie ${z.czlonek_id} (${name})`);
  return json(widok(up.data as Zgl, f as Record<string, unknown>));
});
