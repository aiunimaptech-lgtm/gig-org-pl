// ============================================================
// GIG — Edge Function: baza-wypis
// Rezygnacja z otrzymywania maili od Izby. Link z maila (wyslij-mail, rodzaj
// 'baza') prowadzi tu: GET ?id=<uuid wiersza baza_email>. Ustawia
// status='unsubscribed' i zwraca prostą stronę potwierdzenia.
//
// Bramą jest samo id (UUID, nieodgadywalne). Wdrożenie z verify_jwt = false
// (link klika odbiorca w kliencie poczty, bez logowania).
// Sekrety: SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY wstrzykiwane.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RED = "#cc0a2b";
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";

function strona(tytul: string, tresc: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tytul} — GIG</title></head>
<body style="margin:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <div style="max-width:540px;margin:60px auto;padding:0 16px;">
    <div style="background:#fff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(22,32,42,.06);">
      <div style="padding:26px 34px 18px;"><img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;"></div>
      <div style="height:3px;background:${RED};"></div>
      <div style="padding:30px 34px 34px;">
        <h1 style="margin:0 0 12px;font-size:22px;color:#16202a;">${tytul}</h1>
        <div style="font-size:15px;line-height:1.65;color:#38444e;">${tresc}</div>
        <p style="margin:26px 0 0;font-size:13px;"><a href="https://gig.org.pl" style="color:${RED};text-decoration:none;font-weight:600;">← Wróć na gig.org.pl</a></p>
      </div>
    </div>
    <p style="text-align:center;color:#9aa7b2;font-size:12px;margin:16px 0;">Geodezyjna Izba Gospodarcza · ul. Czackiego 3/5, 00-043 Warszawa</p>
  </div>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return strona("Nieprawidłowy link", `Ten link wypisu jest niekompletny lub nieprawidłowy. Jeśli chcesz zrezygnować z wiadomości, napisz na <a href="mailto:biuro@gig.org.pl" style="color:${RED};">biuro@gig.org.pl</a>.`, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: rekord, error: selErr } = await admin.from("baza_email").select("email,status").eq("id", id).maybeSingle();
  if (selErr) {
    console.error("select:", selErr.message);
    return strona("Coś poszło nie tak", "Nie udało się teraz przetworzyć rezygnacji. Spróbuj ponownie za chwilę lub napisz na biuro@gig.org.pl.", 500);
  }
  if (!rekord) {
    return strona("Nie znaleziono adresu", "Tego adresu nie ma już w naszej bazie — nie otrzymasz od nas kolejnych wiadomości.", 200);
  }
  if (rekord.status === "unsubscribed") {
    return strona("Już wypisany", `Adres <strong>${(rekord.email as string) || ""}</strong> był już wypisany. Nie będziemy wysyłać do Ciebie wiadomości.`, 200);
  }

  const { error: updErr } = await admin.from("baza_email")
    .update({ status: "unsubscribed", updated_at: new Date().toISOString() }).eq("id", id);
  if (updErr) {
    console.error("update:", updErr.message);
    return strona("Coś poszło nie tak", "Nie udało się teraz przetworzyć rezygnacji. Spróbuj ponownie za chwilę lub napisz na biuro@gig.org.pl.", 500);
  }
  console.log(`baza-wypis: ${(rekord.email as string) || id} -> unsubscribed`);
  return strona("Wypisano ✓", `Adres <strong>${(rekord.email as string) || ""}</strong> został wypisany. Nie będziesz już otrzymywać wiadomości od Geodezyjnej Izby Gospodarczej. Jeśli to pomyłka, napisz na <a href="mailto:biuro@gig.org.pl" style="color:${RED};">biuro@gig.org.pl</a>.`, 200);
});
