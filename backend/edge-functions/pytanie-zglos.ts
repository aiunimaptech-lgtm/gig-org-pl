// ============================================================
// GIG: Edge Function pytanie-zglos (v8, 11.11.2026)
// „Zapytaj Izbę” (Geodezja pyta, Izba odpowiada): przyjmuje pytanie z formularza /pytania/zadaj/,
// zapisuje je w tabeli `pytania` (backend/supabase_pytania.sql) i wysyła dwa maile:
// powiadomienie do biura (Reply-To = pytający) oraz potwierdzenie z numerem do pytającego.
//
// Publiczna (verify_jwt = false). Wejście: POST JSON
//   rodzaj ('pytanie' | 'problem' | 'postulat'), tresc (10 do 5000 znaków), temat, rola, wojewodztwo,
//   imie, email, organizacja, nip, podpis_zakres ('anonim' | 'osoba' | 'organizacja' | 'oba'),
//   podpis_osoba, podpis_organizacja, tylko_dla_mnie, nie_ujawniac, zgoda (true),
//   www (pułapka, musi być puste), czas (ms od wejścia na stronę, liczba, co najmniej 20000).
// Wyjście: { ok: true, numer, czlonek: true | false, czlonek_do_potwierdzenia: true | false }
//   albo { error: "komunikat po polsku" }.
//
// Zabezpieczenia:
//   - pułapka na roboty: pole `www` niepuste, brak pola `czas` albo czas poniżej 20 s
//     -> odpowiedź { ok: true, numer: null }, pytania nie zapisujemy i nic nie wysyłamy,
//   - limity (liczone w tabeli pytania, zrodlo = 'formularz'):
//       łącznie: do 22.11.2026 włącznie (czas polski) 20 na godzinę i 40 na dobę, od 23.11.2026 6 na godzinę i 15 na dobę
//       (decyzja prezesa z 11.11.2026: do Forum spodziewamy się więcej pytań),
//       3 na adres e-mail na dobę, 6 na adres IP na dobę (v7: było 1; urzędy i biura wychodzą jednym adresem).
//     IP z nagłówka cf-connecting-ip (ustawia go Cloudflare, klient go nie podstawi), zapasowo OSTATNI element
//     x-forwarded-for (pierwszy pochodzi od klienta). Zgłoszenie bez adresu IP odrzucamy.
//     Te same limity sprawdza ponownie trigger trg_pytania_limit (backend/supabase_pytania_kosz.sql) pod blokadą
//     pg_advisory_xact_lock, bo liczenie tutaj i zapis nie są atomowe. Trigger zgłasza 'ZA_DUZO_ZGLOSZEN'
//     (w polu details: limit_laczny, limit_email albo limit_ip), a funkcja zamienia to na 429.
//     UWAGA: liczby limitów są w dwóch miejscach (stałe niżej i funkcja gig_pytania_limit w bazie), zmieniaj oba,
//   - v5: treść z jakimkolwiek linkiem albo adresem strony -> 400 z prośbą o usunięcie linku (człowiek poprawi, robot odpadnie);
//     link w polach imię, organizacja lub podpis oraz powtórzona treść (taka sama w ciągu 7 dni)
//     -> po cichu { ok: true, numer: null }, bez zapisu pytania i bez maili,
//   - v7: kosz. Każde zablokowane zgłoszenie (pułapka, za szybko, link, powtórzona treść, limity) trafia do tabeli
//     `pytania_odrzucone` z powodem; panel pokazuje je w zakładce Kosz i pozwala przywrócić. Wpisy starsze niż 30 dni
//     usuwa pg_cron. Zwykłych błędów walidacji (brak zgody, za krótka treść) nie zapisujemy. Zapis do kosza nigdy
//     nie zmienia odpowiedzi funkcji,
//   - v8: kosz trzyma też zastrzeżenia pytającego (nie ujawniać, tylko dla mnie), NIP, województwo, podpis i zgodę,
//     żeby przywrócone pytanie ich nie zgubiło. Ochrona kosza przed zalaniem: powody dzielą się na grupę „roboty”
//     (pulapka, za_szybko, link_w_podpisie) i „ludzie” (pozostałe); w każdej grupie najwyżej 200 wpisów na dobę
//     i najwyżej 10 z jednego adresu IP. Zalew z pułapki nie zabiera więc miejsca zgłoszeniom zatrzymanym limitem.
//     Przycinane teksty nie kończą się połową znaku (emoji), a samotne surogaty usuwamy, bo baza ich nie przyjmuje,
//   - strona nie pisze do tabeli sama: anon nie ma do `pytania` żadnych praw, zapis idzie stąd (service_role).
//
// Członek Izby: NIP członków jest publiczny w katalogu, więc sam NIP nie wystarcza.
//   czlonek_potwierdzony = true tylko gdy e-mail pytającego jest adresem członka z katalogu
//   albo gdy zgadza się NIP i domena adresu (domena nie może być publiczną skrzynką ani jej subdomeną).
//   Dopasowanie po samym adresie e-mail: adres jest w publicznym katalogu, a nadawcy nie weryfikujemy,
//   więc mail do biura przypomina, żeby odpowiadać wyłącznie na ten adres.
//   Sam NIP: czlonek_gig = true, czlonek_potwierdzony = false, czlonek_sposob = 'nip (do potwierdzenia)'.
//   `tylko_dla_mnie` przyjmujemy tylko przy czlonek_gig = true; gdy członka nie rozpoznano,
//   prośba trafia do pola `notatka`, żeby biuro widziało ją w panelu.
//
// Kolejność: najpierw INSERT, potem maile. Błąd maila tylko logujemy, pytanie i tak jest w panelu.
// Sekrety: RESEND_API_KEY, FROM_EMAIL; NOTIFY_PYTANIA (opcjonalny, adresy po przecinku), gdy go nie ma:
// biuro@, prezydium@ i dawid.sienkiewicz@gig.org.pl (stała DOMYSLNI). SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY wstrzykiwane.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const BIURO = "biuro@gig.org.pl";
// Decyzja prezesa z 11.11.2026: powiadomienia o pytaniach idą do biura, Prezydium i koordynatora.
const DOMYSLNI = [BIURO, "prezydium@gig.org.pl", "dawid.sienkiewicz@gig.org.pl"];
const PANEL = "https://gig.org.pl/admin/pytania.html";
const LOGO = "https://gig.org.pl/_assets/img/gig-logo-email.png";
const RED = "#cc0a2b", DARK = "#16202a";
const MIN_CZAS = 20000, LIMIT_EMAIL = 3, LIMIT_IP = 6, MIN_TRESC = 10, MAX_TRESC = 5000;
// Limity łączne zależą od daty: 23.11.2026 00:00 czasu polskiego (CET) to 22.11.2026 23:00 UTC.
const ZMIANA_LIMITOW = Date.parse("2026-11-22T23:00:00Z");
const limityLaczne = () => Date.now() < ZMIANA_LIMITOW ? { godz: 20, doba: 40 } : { godz: 6, doba: 15 };
// Kosz: limity zapisu na dobę, osobno w każdej z dwóch grup powodów (roboty i ludzie).
const KOSZ_MAX_GRUPA = 200, KOSZ_MAX_IP = 10, KOSZ_MAX_TRESC = 3000;
const KOSZ_ROBOTY = ["pulapka", "za_szybko", "link_w_podpisie"];
const KOSZ_LUDZIE = ["link_w_tresci", "powtorzona_tresc", "limit_laczny", "limit_email", "limit_ip"];
const KOMUNIKAT_LIMITU: Record<string, string> = {
  limit_laczny: "Formularz przyjął dziś wyjątkowo dużo zgłoszeń. Spróbuj później albo napisz do biura Izby: biuro@gig.org.pl.",
  limit_email: "Z tego adresu wysłano już dziś kilka pytań. Spróbuj jutro albo napisz do biura Izby: biuro@gig.org.pl.",
  limit_ip: "Z tego połączenia internetowego wysłano już dziś kilka pytań. Kolejne wyślij jutro albo napisz do biura Izby: biuro@gig.org.pl.",
};

const adresyZSekretu = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const NOTIFY: string[] = (() => {
  const a = adresyZSekretu(Deno.env.get("NOTIFY_PYTANIA") ?? "");
  if (a.length) return a;
  return DOMYSLNI;
})();

// Formy gramatyczne do maili, zależnie od rodzaju zgłoszenia.
const RODZAJE: Record<string, { nazwa: string; dzieki: string; zapis: string; dop: string; temat: string; tytul: string }> = {
  pytanie:  { nazwa: "Pytanie",  dzieki: "dziękujemy za pytanie skierowane",            zapis: "Zapisaliśmy je", dop: "pytania",    temat: "Otrzymaliśmy Twoje pytanie",    tytul: "Pytanie przyjęte ✓" },
  problem:  { nazwa: "Problem",  dzieki: "dziękujemy za zgłoszenie problemu skierowane", zapis: "Zapisaliśmy je", dop: "zgłoszenia", temat: "Otrzymaliśmy Twoje zgłoszenie", tytul: "Zgłoszenie przyjęte ✓" },
  postulat: { nazwa: "Postulat", dzieki: "dziękujemy za postulat skierowany",           zapis: "Zapisaliśmy go", dop: "postulatu",  temat: "Otrzymaliśmy Twój postulat",    tytul: "Postulat przyjęty ✓" },
};
const PODPISY = ["anonim", "osoba", "organizacja", "oba"];

// Publiczne i współdzielone skrzynki: zgodność samej domeny niczego nie dowodzi.
// Liczą się też subdomeny (np. ko.onet.pl, vip.interia.pl), patrz publiczna().
const PUBLICZNE = new Set([
  "gmail.com", "googlemail.com", "wp.pl", "wp.eu", "o2.pl", "onet.pl", "onet.eu", "poczta.onet.pl", "poczta.onet.eu",
  "vp.pl", "op.pl", "interia.pl", "interia.eu", "interia.com", "poczta.fm", "tlen.pl", "go2.pl", "gazeta.pl", "int.pl",
  "autograf.pl", "spoko.pl", "buziaczek.pl", "amorki.pl", "outlook.com", "outlook.pl", "hotmail.com", "live.com", "live.pl",
  "msn.com", "icloud.com", "me.com", "mac.com", "yahoo.com", "yahoo.pl", "protonmail.com", "proton.me", "pm.me",
  "aol.com", "gmx.com", "gmx.net", "tutanota.com", "yandex.com", "mail.com",
  "onet.com.pl", "prokonto.pl", "pino.pl", "o2.eu", "hotmail.pl", "yahoo.co.uk", "t-online.de", "neostrada.pl",
  "orange.pl", "plusnet.pl", "vectra.pl", "upcpoczta.pl", "home.pl", "tutamail.com", "geodeta.org",
]);
const publiczna = (d: string) => { for (const p of PUBLICZNE) if (d === p || d.endsWith("." + p)) return true; return false; };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// samotne surogaty UTF-16 (np. emoji rozcięte przez slice): Postgres odrzuca JSON z takim znakiem
const bezSierot = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
// tekst wielowierszowy: bez znaków sterujących, z zachowaniem nowych linii
const tekst = (v: unknown, max: number) =>
  bezSierot((typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max));
// pole jednowierszowe: białe znaki zwinięte do spacji
const linia = (v: unknown, max: number) => bezSierot(tekst(v, max * 2).replace(/\s+/g, " ").slice(0, max)).trim();
const EMAIL_RE = /^[^@\s<>(),;:"\\]+@[^@\s<>(),;:"\\]+\.[^@\s<>(),;:"\\]{2,}$/;
const adresy = (s: unknown) => String(s ?? "").toLowerCase().split(/[\s,;]+/).filter((x) => x.includes("@"));
const domena = (a: string) => a.slice(a.lastIndexOf("@") + 1);
const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));

function layout(title: string, body: string, stopka: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b3a45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e6ebef;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:26px 34px 18px;"><img src="${LOGO}" width="196" alt="Geodezyjna Izba Gospodarcza" style="display:block;border:0;height:auto;"></td></tr>
      <tr><td style="height:3px;background:${RED};font-size:0;line-height:3px;">&nbsp;</td></tr>
      <tr><td style="padding:28px 34px 24px;font-size:15px;line-height:1.65;color:#38444e;">
        <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${DARK};font-weight:800;">${esc(title)}</h1>
        ${body}
        <div style="margin:22px 0 0;padding-top:14px;border-top:1px solid #edf1f4;font-size:12.5px;color:#9aa7b2;line-height:1.6;">${stopka}</div>
      </td></tr>
      <tr><td style="background:#f5f8fa;padding:18px 34px;border-top:1px solid #e6ebef;font-size:12px;color:#7a8b97;line-height:1.7;">
        <strong style="color:${DARK};">Geodezyjna Izba Gospodarcza</strong><br>
        ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43 &middot;
        <a href="mailto:biuro@gig.org.pl" style="color:${RED};text-decoration:none;">biuro@gig.org.pl</a> &middot;
        <a href="https://gig.org.pl" style="color:${RED};text-decoration:none;">gig.org.pl</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// `v` to gotowy HTML: wartości z formularza escapuje wywołujący.
const wiersz = (k: string, v: string) => v
  ? `<tr><td style="padding:5px 14px 5px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:5px 0;font-size:14px;color:${DARK};">${v}</td></tr>`
  : "";

async function wyslij(to: string[], subject: string, html: string, replyTo: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("pytanie-zglos: brak sekretu RESEND_API_KEY"); return false; }
  for (let proba = 0; proba < 3; proba++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, reply_to: replyTo }),
    });
    if (res.status === 429) { await pauza(1500 * (proba + 1)); continue; }
    const w = await res.json().catch(() => ({}));
    if (!res.ok) console.error("Resend:", res.status, w);
    return res.ok;
  }
  return false;
}

// Klient bazy (service_role) tworzony przy pierwszym użyciu.
// deno-lint-ignore no-explicit-any
let _db: any = null;
const baza = () => _db ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });

// adres IP: cf-connecting-ip ustawia Cloudflare; w x-forwarded-for prawdziwy adres jest na końcu,
// a początek może dopisać klient
function adresIp(req: Request): string | null {
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return ((req.headers.get("cf-connecting-ip") ?? "").trim() || xff[xff.length - 1] || "").slice(0, 60) || null;
}

// Kosz: zapis zablokowanego zgłoszenia do `pytania_odrzucone`. Pola bierzemy wprost z żądania (pułapka i czas
// są sprawdzane przed walidacją), przycięte jak w formularzu. Błąd tylko w logu: odpowiedź funkcji się nie zmienia.
async function doKosza(powod: string, b: Record<string, unknown>, ip: string | null): Promise<void> {
  try {
    const db = baza();
    const doba = new Date(Date.now() - 86400000).toISOString();
    // limity liczone w grupie powodów: zalew robotów nie blokuje zapisu zgłoszeń zatrzymanych limitem
    const grupa = KOSZ_ROBOTY.includes(powod) ? KOSZ_ROBOTY : KOSZ_LUDZIE;
    const licz = () => db.from("pytania_odrzucone").select("id", { count: "exact", head: true })
      .in("powod", grupa).gte("created_at", doba);
    const [lG, lI] = await Promise.all([licz(), ip ? licz().eq("ip", ip) : licz().is("ip", null)]);
    if (lG.error) throw new Error(lG.error.message);
    if (lI.error) throw new Error(lI.error.message);
    if ((lG.count ?? 0) >= KOSZ_MAX_GRUPA) { console.error(`pytanie-zglos: kosz pełny (limit dobowy grupy, powód ${powod}), wpisu nie zapisano`); return; }
    if ((lI.count ?? 0) >= KOSZ_MAX_IP) { console.error(`pytanie-zglos: kosz: limit dobowy na adres IP (powód ${powod}), wpisu nie zapisano`); return; }
    const ins = await db.from("pytania_odrzucone").insert({
      powod, rodzaj: linia(b.rodzaj, 40) || null, temat: linia(b.temat, 120) || null, rola: linia(b.rola, 80) || null,
      tresc: tekst(b.tresc, KOSZ_MAX_TRESC).replace(/\r\n?/g, "\n") || null, imie: linia(b.imie, 120) || null,
      email: linia(b.email, 160).toLowerCase() || null, organizacja: linia(b.organizacja, 200) || null, ip,
      wojewodztwo: linia(b.wojewodztwo, 40) || null, nip: linia(b.nip, 40) || null,
      podpis_zakres: linia(b.podpis_zakres, 40) || null, podpis_osoba: linia(b.podpis_osoba, 160) || null,
      podpis_organizacja: linia(b.podpis_organizacja, 200) || null,
      tylko_dla_mnie: b.tylko_dla_mnie === true, nie_ujawniac: b.nie_ujawniac === true, zgoda: b.zgoda === true,
    });
    if (ins.error) throw new Error(ins.error.message);
  } catch (e) { console.error("pytanie-zglos: kosz:", (e as Error).message); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "tylko POST" }, 405);

  let b: Record<string, unknown>;
  try {
    const surowe = await req.text();
    if (surowe.length > 100000) return json({ error: "Zgłoszenie jest za duże." }, 413);
    const p = JSON.parse(surowe);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("oczekiwano obiektu");
    b = p as Record<string, unknown>;
  } catch { return json({ error: "Nieprawidłowe dane." }, 400); }

  // pułapka i czas wypełniania: roboty wypełniają wszystko i wysyłają od razu
  const czas = Number(b.czas);
  const pulapka = b.www != null && String(b.www).trim() !== "";
  const ip = adresIp(req);
  if (pulapka || !Number.isFinite(czas) || czas < MIN_CZAS) {
    await doKosza(pulapka ? "pulapka" : "za_szybko", b, ip);
    return json({ ok: true, numer: null });
  }

  const rodzaj = linia(b.rodzaj, 40) || "pytanie";
  const tresc = tekst(b.tresc, 20000).replace(/\r\n?/g, "\n");
  const temat = linia(b.temat, 120);
  const rola = linia(b.rola, 80);
  const woj = linia(b.wojewodztwo, 40);
  const imie = linia(b.imie, 120);
  const email = linia(b.email, 160).toLowerCase();
  const organizacja = linia(b.organizacja, 200);
  const nipWpisany = linia(b.nip, 40);
  const nip = nipWpisany.replace(/\D/g, "");
  const podpisZakres = linia(b.podpis_zakres, 40) || "anonim";
  const zOsoba = podpisZakres === "osoba" || podpisZakres === "oba";
  const zOrg = podpisZakres === "organizacja" || podpisZakres === "oba";
  const podpisOsoba = zOsoba ? linia(b.podpis_osoba, 160) : "";
  const podpisOrg = zOrg ? linia(b.podpis_organizacja, 200) : "";
  const chceTylkoDlaSiebie = b.tylko_dla_mnie === true;
  const nieUjawniac = b.nie_ujawniac === true;

  if (!RODZAJE[rodzaj]) return json({ error: "Nieprawidłowy rodzaj zgłoszenia." }, 400);
  if (tresc.length < MIN_TRESC) return json({ error: `Opisz sprawę: co najmniej ${MIN_TRESC} znaków.` }, 400);
  if (tresc.length > MAX_TRESC) return json({ error: `Treść jest za długa: najwyżej ${MAX_TRESC} znaków. Skróć ją albo wyślij w dwóch częściach.` }, 400);
  if (!rola) return json({ error: "Wybierz, kim jesteś (rola pytającego)." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Podaj poprawny adres e-mail." }, 400);
  if (nipWpisany && nip.length !== 10) return json({ error: "NIP powinien mieć 10 cyfr. Popraw go albo zostaw pole puste." }, 400);
  if (!PODPISY.includes(podpisZakres)) return json({ error: "Nieprawidłowy sposób podpisu." }, 400);
  if (zOsoba && !podpisOsoba) return json({ error: "Podaj imię i nazwisko do podpisu albo wybierz pytanie anonimowe." }, 400);
  if (zOrg && !podpisOrg) return json({ error: "Podaj nazwę organizacji do podpisu albo wybierz inny sposób podpisu." }, 400);
  if (b.zgoda !== true) return json({ error: "Zaznacz wymaganą zgodę, żeby wysłać zgłoszenie." }, 400);

  // v5: żadnych linków ani adresów stron w treści (adresy e-mail są dozwolone).
  const LINK = /https?:\/\/|www\.|\[url|<a\s|\b[a-z0-9-]+\.(pl|com|net|org|eu|info|biz|ru|xyz|top|online|site|shop|io)\b(?!\s*@)/i;
  if (LINK.test(tresc.replace(/[^\s@]+@[^\s@]+/g, " "))) {
    await doKosza("link_w_tresci", b, ip);
    return json({ error: "Usuń z treści linki i adresy stron internetowych. Przepis albo dokument opisz słowami, np. podając numer artykułu." }, 400);
  }
  if ([imie, organizacja, podpisOsoba, podpisOrg, temat, rola].some((x) => /https?:\/\/|www\./i.test(x))) {
    console.error("pytanie-zglos: odrzucono po cichu (linki)");
    await doKosza("link_w_podpisie", b, ip);
    return json({ ok: true, numer: null });
  }

  try {
    const db = baza();
    if (!ip) return json({ error: "Nie udało się przyjąć zgłoszenia z tego połączenia. Napisz do biura Izby: biuro@gig.org.pl." }, 400);

    // limity (tylko zgłoszenia z formularza; wpisy dodane w panelu się nie liczą)
    const doba = new Date(Date.now() - 86400000).toISOString();
    const godz = new Date(Date.now() - 3600000).toISOString();
    const lG = await db.from("pytania").select("id", { count: "exact", head: true })
      .eq("zrodlo", "formularz").gte("created_at", godz);
    if (lG.error) throw new Error("limit godzinowy: " + lG.error.message);
    const lD = await db.from("pytania").select("id", { count: "exact", head: true })
      .eq("zrodlo", "formularz").gte("created_at", doba);
    if (lD.error) throw new Error("limit dobowy: " + lD.error.message);
    const LL = limityLaczne();
    if ((lG.count ?? 0) >= LL.godz || (lD.count ?? 0) >= LL.doba) {
      console.error(`pytanie-zglos: limit łączny (godzina ${lG.count}/${LL.godz}, doba ${lD.count}/${LL.doba})`);
      await doKosza("limit_laczny", b, ip);
      return json({ error: KOMUNIKAT_LIMITU.limit_laczny }, 429);
    }
    const lE = await db.from("pytania").select("id", { count: "exact", head: true })
      .eq("zrodlo", "formularz").eq("email", email).gte("created_at", doba);
    if (lE.error) throw new Error("limit e-mail: " + lE.error.message);
    if ((lE.count ?? 0) >= LIMIT_EMAIL) { await doKosza("limit_email", b, ip); return json({ error: KOMUNIKAT_LIMITU.limit_email }, 429); }
    const lI = await db.from("pytania").select("id", { count: "exact", head: true })
      .eq("zrodlo", "formularz").eq("ip", ip).gte("created_at", doba);
    if (lI.error) throw new Error("limit IP: " + lI.error.message);
    if ((lI.count ?? 0) >= LIMIT_IP) { await doKosza("limit_ip", b, ip); return json({ error: KOMUNIKAT_LIMITU.limit_ip }, 429); }

    // v4: ta sama treść wysłana ponownie w ciągu 7 dni (robot albo podwójne kliknięcie): po cichu, bez zapisu
    const tydz = new Date(Date.now() - 7 * 86400000).toISOString();
    const lT = await db.from("pytania").select("id", { count: "exact", head: true })
      .eq("tresc", tresc).gte("created_at", tydz);
    if (lT.error) throw new Error("powtórzona treść: " + lT.error.message);
    if ((lT.count ?? 0) > 0) {
      console.error("pytanie-zglos: odrzucono po cichu (powtórzona treść)");
      await doKosza("powtorzona_tresc", b, ip);
      return json({ ok: true, numer: null });
    }

    // rozpoznanie członka: po adresie e-mail albo po NIP-ie (tylko opublikowani w katalogu)
    const cq = await db.from("czlonkowie").select("id,name,email,nip").eq("status", "published");
    if (cq.error) throw new Error("czlonkowie: " + cq.error.message);
    const czlonkowie = (cq.data ?? []) as Array<{ id: string; name: string | null; email: string | null; nip: string | null }>;
    const poEmailu = czlonkowie.find((c) => adresy(c.email).includes(email));
    const poNipie = nip ? czlonkowie.find((c) => String(c.nip ?? "").replace(/\D/g, "") === nip) : undefined;
    const dom = domena(email);
    let czlonek: { id: string; name: string | null } | null = null;
    let sposob: string | null = null;
    let potwierdzony = false;
    if (poEmailu) {
      czlonek = poEmailu; potwierdzony = true;
      sposob = poNipie && poNipie.id === poEmailu.id ? "nip + e-mail" : "e-mail";
    } else if (poNipie) {
      czlonek = poNipie;
      potwierdzony = !publiczna(dom) && adresy(poNipie.email).some((a) => domena(a) === dom);
      sposob = potwierdzony ? "nip + domena e-mail" : "nip (do potwierdzenia)";
    }
    const czlonekGig = !!czlonek;
    const tylkoDlaMnie = chceTylkoDlaSiebie && czlonekGig;
    // prośba osoby, której nie rozpoznaliśmy jako członka: ślad dla biura w panelu
    const notatka = chceTylkoDlaSiebie && !czlonekGig
      ? "Pytający zaznaczył odpowiedź tylko dla siebie, bez publikacji. Członkostwa nie rozpoznano, więc opcji nie zapisano."
      : null;

    // ── zapis (najpierw baza, potem maile) ──
    const ins = await db.from("pytania").insert({
      zrodlo: "formularz", rodzaj, temat: temat || null, rola, wojewodztwo: woj || null, tresc,
      imie: imie || null, email, organizacja: organizacja || null, nip: nip || null,
      podpis_zakres: podpisZakres, podpis_osoba: podpisOsoba || null, podpis_organizacja: podpisOrg || null,
      tylko_dla_mnie: tylkoDlaMnie, nie_ujawniac: nieUjawniac,
      czlonek_gig: czlonekGig, czlonek_id: czlonek?.id ?? null, czlonek_sposob: sposob, czlonek_potwierdzony: potwierdzony,
      zgoda_at: new Date().toISOString(), ip, notatka,
    }).select("id,numer").single();
    // v7: trigger trg_pytania_limit przeliczył limity pod blokadą i odrzucił zapis (zgłoszenia równoległe)
    if (ins.error && /ZA_DUZO_ZGLOSZEN/.test(ins.error.message ?? "")) {
      const szczegol = String(ins.error.details ?? "").trim();
      const powod = KOMUNIKAT_LIMITU[szczegol] ? szczegol : "limit_laczny";
      console.error(`pytanie-zglos: limit z triggera (${powod})`);
      await doKosza(powod, b, ip);
      return json({ error: KOMUNIKAT_LIMITU[powod] }, 429);
    }
    if (ins.error || !ins.data) throw new Error("zapis: " + (ins.error?.message ?? "brak wiersza"));
    const numer = String(ins.data.numer);
    const R = RODZAJE[rodzaj];

    // ── mail do biura ──
    const dopisek = potwierdzony ? " (CZŁONEK GIG)" : czlonekGig ? " (członek do potwierdzenia)" : "";
    const czlonekOpis = potwierdzony
      ? `<strong style="color:#1a7f37;">TAK</strong>: ${esc(czlonek?.name)} (rozpoznano po: ${esc(sposob)})`
        + (sposob === "e-mail" ? `<br><span style="font-size:13px;color:#6b7c8c;">Adres jest w publicznym katalogu Członków, nadawca nie był weryfikowany. Odpowiedź wysyłaj wyłącznie na ten adres.</span>` : "")
      : czlonekGig
        ? `<strong style="color:#b26a00;">DO POTWIERDZENIA</strong>: podany NIP należy do firmy ${esc(czlonek?.name)}, ale adresu e-mail nie rozpoznano jako firmowego`
        : "nie rozpoznano";
    const podpisOpis = podpisZakres === "anonim" ? "anonimowo (bez podpisu)"
      : podpisZakres === "osoba" ? `imię i nazwisko: ${podpisOsoba}`
      : podpisZakres === "organizacja" ? `organizacja: ${podpisOrg}`
      : `imię i nazwisko: ${podpisOsoba}; organizacja: ${podpisOrg}`;
    const tylkoOpis = tylkoDlaMnie
      ? (potwierdzony ? "TAK: odpowiedź indywidualna, bez publikacji" : "TAK, o ile biuro potwierdzi członkostwo")
      : chceTylkoDlaSiebie ? "zaznaczono, ale nie rozpoznano członka Izby, więc opcji nie zapisano (uwaga jest w notatce pytania)" : "";
    const doBiura = layout(`${R.nazwa} ${numer}`,
      `<p style="margin:0 0 16px;">Nowe zgłoszenie z formularza „Zapytaj Izbę” na stronie gig.org.pl.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;">
         ${wiersz("Numer", `<strong>${esc(numer)}</strong>`)}
         ${wiersz("Rodzaj", esc(R.nazwa))}
         ${wiersz("Temat", esc(temat))}
         ${wiersz("Kto pyta", esc(rola))}
         ${wiersz("Województwo", esc(woj))}
         ${wiersz("Członek GIG", czlonekOpis)}
       </table>
       <div style="margin:0 0 16px;padding:12px 16px;background:#fdecef;border-left:4px solid ${RED};border-radius:6px;font-size:14px;white-space:pre-wrap;">${esc(tresc)}</div>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">
         ${wiersz("Imię i nazwisko", esc(imie))}
         ${wiersz("E-mail", `<a href="mailto:${esc(email)}" style="color:${RED};">${esc(email)}</a>`)}
         ${wiersz("Organizacja", esc(organizacja))}
         ${wiersz("NIP", esc(nip))}
         ${wiersz("Podpis przy publikacji", esc(podpisOpis))}
         ${wiersz("Tylko dla mnie", esc(tylkoOpis))}
         ${wiersz("Nie ujawniać", nieUjawniac ? "TAK (zaznaczono w formularzu)" : "")}
       </table>
       <p style="margin:0;"><a href="${PANEL}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;font-size:14px;">Otwórz pytania w panelu</a></p>`,
      "Wiadomość automatyczna z formularza „Zapytaj Izbę”. Odpowiedź na nią trafi bezpośrednio do pytającego.");
    let okBiuro = false, okPytajacy = false;
    try { okBiuro = await wyslij(NOTIFY, `[GIG] Pytanie ${numer}${dopisek}`, doBiura, email); }
    catch (e) { console.error("pytanie-zglos: mail do biura:", (e as Error).message); }

    // ── potwierdzenie dla pytającego (bez cytowania treści) ──
    const publikacja = podpisZakres === "anonim"
      ? "w zredagowanej formie i bez danych pytającego"
      : "w zredagowanej formie, z podpisem wskazanym w formularzu";
    const linkPytania = `<a href="https://gig.org.pl/pytania/" style="color:${RED};">gig.org.pl/pytania/</a>`;
    let dalej: string;
    if (potwierdzony) {
      dalej = `<p style="margin:0 0 14px;">Rozpoznaliśmy firmę członkowską Izby (<strong>${esc(czlonek?.name)}</strong>). Zgłoszenia członków rozpatrujemy w pierwszej kolejności i na każde odpowiadamy indywidualnie, na ten adres e-mail.</p>`
        + (tylkoDlaMnie
          ? `<p style="margin:0 0 14px;">Zgodnie z Twoim wyborem odpowiedź trafi tylko do Ciebie: nie opublikujemy jej na stronie.</p>`
          : `<p style="margin:0 0 14px;">Odpowiedzi przydatne dla innych publikujemy też na stronie ${linkPytania}, ${publikacja}.</p>`);
    } else {
      dalej = `<p style="margin:0 0 14px;">Odpowiedzi publikujemy na stronie ${linkPytania}, ${publikacja}. Damy znać na ten adres, gdy opublikujemy odpowiedź albo gdy ${R.dop} nie wybierzemy do opracowania.</p>`
        + (czlonekGig
          ? `<p style="margin:0 0 14px;">Podany NIP należy do firmy członkowskiej Izby, ale adresu e-mail nie rozpoznaliśmy jako firmowego. Biuro potwierdzi członkostwo, a wtedy zgłoszenie dostanie pierwszeństwo i odpowiedź indywidualną.${tylkoDlaMnie ? " Prośbę o odpowiedź tylko dla Ciebie uwzględnimy po potwierdzeniu." : ""}</p>`
          : `<p style="margin:0 0 14px;">Członkowie Izby mają pierwszeństwo i zawsze dostają odpowiedź indywidualną: <a href="https://gig.org.pl/dolacz-do-nas/" style="color:${RED};">zobacz, jak dołączyć do Izby</a>.</p>`);
    }
    const doPytajacego = layout(R.tytul,
      `<p style="margin:0 0 14px;">Dzień dobry,</p>
       <p style="margin:0 0 14px;">${R.dzieki} do Geodezyjnej Izby Gospodarczej. ${R.zapis} pod numerem <strong>${esc(numer)}</strong>. Podaj ten numer, jeśli będziesz pisać do nas w tej sprawie.</p>
       ${dalej}`,
      "Wiadomość wysłaliśmy, bo ten adres podano w formularzu „Zapytaj Izbę” na stronie gig.org.pl. Jeśli to pomyłka, napisz do biura Izby: biuro@gig.org.pl.");
    try {
      await pauza(600);
      okPytajacy = await wyslij([email], `${R.temat} ${numer} - GIG`, doPytajacego, BIURO);
    } catch (e) { console.error("pytanie-zglos: potwierdzenie:", (e as Error).message); }

    console.log(`pytanie-zglos: ${numer} rodzaj=${rodzaj} czlonek=${potwierdzony ? "tak" : czlonekGig ? "do potwierdzenia" : "nie"} maile=${okBiuro ? 1 : 0}+${okPytajacy ? 1 : 0}`);
    return json({ ok: true, numer, czlonek: potwierdzony, czlonek_do_potwierdzenia: czlonekGig && !potwierdzony });
  } catch (e) {
    console.error("pytanie-zglos:", (e as Error).message);
    return json({ error: "Nie udało się zapisać zgłoszenia. Spróbuj ponownie za chwilę albo napisz na biuro@gig.org.pl." }, 500);
  }
});
