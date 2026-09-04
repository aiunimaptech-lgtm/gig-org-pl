// ============================================================
// GIG — Edge Function: pierwsze-haslo
// Ustawia hasło administratora bez maila. Wołana ze strony
// /admin/pierwsze-haslo.html?token=… (POST {email, password, token}).
//
// Brama: jednorazowy token z private.gig_sekrety ('setup_token'),
// sprawdzany funkcją SQL gig_pierwsze_haslo_sprawdz (tylko service_role).
// Po udanym ustawieniu hasła token jest kasowany — endpoint staje się
// bezużyteczny do czasu wstawienia nowego tokenu
// (backend/supabase_pierwsze_haslo.sql).
//
// Sekrety: SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY wstrzykuje Supabase.
// Wdrożenie z verify_jwt = false (klucz sb_publishable_ nie jest JWT);
// autoryzację robi token.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "nieprawidlowe dane" }, 400); }

  const email    = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const token    = String(body.token ?? "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "niepoprawny adres e-mail" }, 400);
  if (password.length < 8)                       return json({ error: "haslo musi miec co najmniej 8 znakow" }, 400);
  if (!/^[0-9a-f]{64}$/.test(token))             return json({ error: "brak uprawnien" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1) token + czy konto istnieje
  const chk = await admin.rpc("gig_pierwsze_haslo_sprawdz", { p_token: token, p_email: email });
  if (chk.error) {
    console.error("sprawdz:", chk.error.message);
    return json({ error: "brak uprawnien" }, 401);
  }
  const uid = (chk.data as string | null) ?? null;

  // 2) ustaw haslo (istniejace konto) albo zaloz konto z potwierdzonym e-mailem
  const r = uid
    ? await admin.auth.admin.updateUserById(uid, { password, email_confirm: true })
    : await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (r.error) {
    console.error("auth:", r.error.message);
    return json({ error: "nie udalo sie ustawic hasla: " + r.error.message }, 500);
  }

  // 3) token jednorazowy — kasujemy
  const del = await admin.rpc("gig_pierwsze_haslo_zuzyj", { p_token: token });
  if (del.error) console.error("zuzyj:", del.error.message);

  return json({ ok: true, utworzono: !uid, email });
});
