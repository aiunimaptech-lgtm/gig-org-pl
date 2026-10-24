// ============================================================
// GIG: Edge Function newsletter-unsubscribe (v2, 24.10.2026)
// Rezygnacja z newslettera (tabela submissions_newsletter). Do v1 samo otwarcie linku
// wypisywało adres, a filtry pocztowe (Safe Links, Gmail) otwierają linki same, więc
// część osób mogła zostać wypisana bez swojej wiedzy. Teraz jak w baza-wypis:
//
//   GET  ?id=<uuid>  -> 302 na https://gig.org.pl/wypis-newsletter/?id=<uuid>
//        (strona z przyciskiem; samo otwarcie niczego nie zmienia)
//   POST ?id=<uuid>, body "List-Unsubscribe=One-Click"  -> wypis jednym kliknięciem
//        z programu pocztowego (RFC 8058)
//   POST JSON {id, tryb:'info'}  -> {ok, email, status}
//   POST JSON {id}               -> wypis
// Verify JWT = OFF. Sekrety: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = (Deno.env.get("SITE_URL") ?? "https://gig.org.pl").replace(/\/$/, "");
const STRONA = `${SITE}/wypis-newsletter/`;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const idUrl = url.searchParams.get("id") ?? "";

  if (req.method === "GET") {
    const cel = UUID.test(idUrl) ? `${STRONA}?id=${encodeURIComponent(idUrl)}` : STRONA;
    return new Response(null, { status: 302, headers: { Location: cel } });
  }
  if (req.method !== "POST") return json({ error: "nieobslugiwana metoda" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const tekst = await req.text();
  let id = idUrl, tryb = "", jednoklik = false;
  if (/List-Unsubscribe=One-Click/i.test(tekst)) {
    jednoklik = true;
  } else {
    try {
      const b = JSON.parse(tekst || "{}");
      id = String(b.id ?? idUrl);
      tryb = String(b.tryb ?? "");
    } catch { return json({ error: "nieprawidlowe dane" }, 400); }
  }
  if (!UUID.test(id)) return json({ error: "Ten link jest niekompletny." }, 400);

  const { data: rek, error } = await db.from("submissions_newsletter").select("id,email,status").eq("id", id).maybeSingle();
  if (error) { console.error("newsletter-unsubscribe select:", error.message); return json({ error: "Błąd serwera. Spróbuj ponownie za chwilę." }, 500); }
  if (!rek) return json({ error: "Tego adresu nie ma już na liście newslettera." }, 404);

  if (tryb === "info") return json({ ok: true, email: rek.email, status: rek.status });

  if (rek.status !== "unsubscribed") {
    const { error: e2 } = await db.from("submissions_newsletter").update({ status: "unsubscribed" }).eq("id", id);
    if (e2) { console.error("newsletter-unsubscribe update:", e2.message); return json({ error: "Błąd serwera. Spróbuj ponownie za chwilę." }, 500); }
    await db.from("wysylki_odbiorcy").update({ status: "blad", blad: "wypisany z newslettera" })
      .eq("newsletter_id", id).eq("status", "czeka");
    console.log(`newsletter-unsubscribe: ${rek.email} -> unsubscribed${jednoklik ? " (one-click)" : ""}`);
  }
  return jednoklik ? new Response("ok", { headers: CORS }) : json({ ok: true });
});
