// ============================================================
// GIG: Edge Function resend-webhook
// Resend zgłasza tu zdarzenia pocztowe (webhook). Odbicia i skargi na spam
// od razu wyłączają adres z wysyłek (funkcja SQL gig_mail_zdarzenie):
//   email.bounced (Permanent) -> baza_email.status = 'bounced', kolejki kampanii pomijają adres
//   email.complained          -> baza_email.status = 'unsubscribed'
//   email.failed              -> ostatnia wysyłka na adres oznaczona jako błąd
//   pozostałe (np. Transient, delivery_delayed) -> tylko zapis w maile_zdarzenia
// Każde zdarzenie trafia do tabeli maile_zdarzenia (podgląd w panelu).
//
// Odbicia NIE przychodzą na biuro@gig.org.pl: adres zwrotny (Return-Path)
// to send.gig.org.pl, obsługiwany przez Resend.
//
// Uwierzytelnienie (verify_jwt = false, Resend nie ma naszego JWT):
//   - adres webhooka zawiera ?t=<token z private.gig_sekrety 'resend_webhook'>,
//   - gdy ustawiony jest sekret RESEND_WEBHOOK_SECRET (whsec_... z panelu Resend),
//     dodatkowo sprawdzamy podpis Svix.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const WHSEC = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
const JSONH = { "Content-Type": "application/json" };
const odp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSONH });

function rowne(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* Podpis Svix: HMAC-SHA256(klucz z whsec_, "id.timestamp.body"), base64; naglowek "v1,<sig> v1,<sig>". */
async function podpisOk(req: Request, body: string): Promise<boolean> {
  const id = req.headers.get("svix-id") ?? "", ts = req.headers.get("svix-timestamp") ?? "";
  const sig = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const klucz = Uint8Array.from(atob(WHSEC.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", klucz, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const oczek = btoa(String.fromCharCode(...mac));
  return sig.split(" ").some((s) => rowne(s.split(",")[1] ?? "", oczek));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return odp({ error: "tylko POST" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.text();
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const { data: tokenOk } = await admin.rpc("gig_resend_token_ok", { p_token: token });
  if (tokenOk !== true) return odp({ error: "brak uprawnien" }, 401);
  if (WHSEC && !(await podpisOk(req, body))) return odp({ error: "zly podpis" }, 401);

  let ev: Record<string, any>;
  try { ev = JSON.parse(body); } catch { return odp({ error: "nieprawidlowe dane" }, 400); }
  const typ = String(ev.type ?? "");
  const d = (ev.data ?? {}) as Record<string, any>;
  const adresy: string[] = (Array.isArray(d.to) ? d.to : [d.to]).filter(Boolean).map((x: string) => String(x).toLowerCase());
  const bounce = (d.bounce ?? {}) as Record<string, any>;
  const rodzaj = bounce.type ? String(bounce.type) : null;
  const opis = [bounce.subType, bounce.message, d.failed?.reason, d.reason].filter(Boolean).join(": ").slice(0, 500) || null;

  const wyniki: string[] = [];
  for (const email of adresy.length ? adresy : [""]) {
    let skutek = "bez zmian";
    if (email && ["email.bounced", "email.complained", "email.failed"].includes(typ)) {
      const { data, error } = await admin.rpc("gig_mail_zdarzenie", { p_email: email, p_typ: typ, p_rodzaj: rodzaj, p_opis: opis });
      skutek = error ? "blad: " + error.message : String(data);
    }
    await admin.from("maile_zdarzenia").insert({
      typ, rodzaj_odbicia: rodzaj, email: email || null, temat: d.subject ?? null,
      resend_id: d.email_id ?? null, opis, skutek, dane: ev,
    });
    wyniki.push(`${email || "-"}: ${skutek}`);
  }
  console.log(`resend-webhook: ${typ} ${wyniki.join("; ")}`);
  return odp({ ok: true });
});
