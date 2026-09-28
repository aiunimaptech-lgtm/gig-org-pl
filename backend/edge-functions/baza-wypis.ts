// ============================================================
// GIG: Edge Function baza-wypis (v2, 28.09.2026)
// Rezygnacja z wiadomości wysyłanych do adresów z Bazy e-mail.
//
//   GET  ?id=<uuid>  -> 302 na stronę https://gig.org.pl/wypis/?id=<uuid>
//        (Supabase podaje HTML z funkcji jako text/plain, więc strona żyje na gig.org.pl;
//         samo otwarcie linku NICZEGO nie zmienia, bo filtry pocztowe klikają linki same)
//   POST ?id=<uuid>, body "List-Unsubscribe=One-Click"  -> wypis jednym kliknięciem
//        z programu pocztowego (RFC 8058, nagłówek List-Unsubscribe-Post)
//   POST JSON {id, tryb:'info'}  -> {ok, email, status}   (strona /wypis/ pokazuje adres)
//   POST JSON {id, powod}        -> wypis; powód trafia do baza_email.uwagi
// Wypis: baza_email.status = 'unsubscribed', czekające kolejki kampanii pomijają adres.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const STRONA = "https://gig.org.pl/wypis/";
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const tekst = await req.text();
  let id = idUrl, powod = "", tryb = "", jednoklik = false;
  if (/List-Unsubscribe=One-Click/i.test(tekst)) {
    jednoklik = true;
    powod = "jednym kliknięciem w programie pocztowym";
  } else {
    try {
      const b = JSON.parse(tekst || "{}");
      id = String(b.id ?? idUrl);
      tryb = String(b.tryb ?? "");
      powod = String(b.powod ?? "").slice(0, 120);
    } catch { return json({ error: "nieprawidlowe dane" }, 400); }
  }
  if (!UUID.test(id)) return json({ error: "Ten link jest niekompletny." }, 400);

  const { data: rek, error } = await admin.from("baza_email").select("id,email,status,uwagi").eq("id", id).maybeSingle();
  if (error) { console.error("baza-wypis select:", error.message); return json({ error: "Błąd serwera. Spróbuj ponownie za chwilę." }, 500); }
  if (!rek) return json({ error: "Tego adresu nie ma już w naszej bazie, więc nie otrzymasz od nas kolejnych wiadomości." }, 404);

  if (tryb === "info") return json({ ok: true, email: rek.email, status: rek.status });

  if (rek.status !== "unsubscribed") {
    const dzis = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
    const wpis = `${dzis} wypisany przez link${powod ? ": " + powod : ""}`;
    const { error: e2 } = await admin.from("baza_email").update({
      status: "unsubscribed", updated_at: new Date().toISOString(),
      uwagi: rek.uwagi ? `${rek.uwagi}\n${wpis}` : wpis,
    }).eq("id", id);
    if (e2) { console.error("baza-wypis update:", e2.message); return json({ error: "Błąd serwera. Spróbuj ponownie za chwilę." }, 500); }
    await admin.from("wysylki_odbiorcy").update({ status: "blad", blad: "wypisany przez link" })
      .eq("baza_email_id", id).eq("status", "czeka");
    console.log(`baza-wypis: ${rek.email} -> unsubscribed (${powod || "bez powodu"})`);
  }
  return jednoklik ? new Response("ok", { headers: CORS }) : json({ ok: true });
});
