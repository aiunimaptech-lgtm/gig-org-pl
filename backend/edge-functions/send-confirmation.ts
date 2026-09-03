// ============================================================
// GIG — Edge Function: send-confirmation
// Wysyła potwierdzenie do klienta po zapisie (newsletter / kontakt).
// Wyzwalane przez Database Webhook (INSERT na submissions_*).
//
// Sekrety (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY = re_xxxxxxxx
//   FROM_EMAIL     = Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>  (domena zweryfikowana w Resend)
//   NOTIFY_EMAILS  = biuro@gig.org.pl,jerzy.bryk@gmail.com   (opcjonalny; adresy po przecinku)
//   NOTIFY_NEWSLETTER_EMAILS = jerzy.bryk@gmail.com           (opcjonalny; osobna lista)
//
// Przy zgloszeniu z formularza kontaktowego ida DWA maile:
//   1. powiadomienie do GIG (NOTIFY_EMAILS) z trescia zgloszenia, Reply-To = nadawca,
//   2. potwierdzenie do nadawcy.
// Przy zapisie do newslettera tak samo, ale powiadomienie idzie na OSOBNA liste
// (NOTIFY_NEWSLETTER_EMAILS) - zapisow bywa duzo i nie musza trafiac do biura.
// ============================================================

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>";
const FUNCTIONS_BASE = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1";

// Adresy, na ktore ida powiadomienia o nowych zgloszeniach. Trzymane w sekrecie,
// zeby dodanie/zmiana odbiorcy nie wymagala ponownego wdrozenia funkcji.
const NOTIFY_EMAILS = (Deno.env.get("NOTIFY_EMAILS") ?? "biuro@gig.org.pl,jerzy.bryk@gmail.com")
  .split(",").map((x) => x.trim()).filter(Boolean);

// Powiadomienia o zapisach do newslettera - osobna lista, bo to inny rodzaj ruchu
// niz zapytania z formularza i zwykle interesuje wezsze grono.
const NOTIFY_NEWSLETTER = (Deno.env.get("NOTIFY_NEWSLETTER_EMAILS") ?? "jerzy.bryk@gmail.com")
  .split(",").map((x) => x.trim()).filter(Boolean);

const C = { dark: "#16314a", mid: "#2f6f9f", light: "#cfe0ee", bg: "#eef4f9" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef0f3;font-family:'Segoe UI',Arial,sans-serif;color:#16314a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(22,49,74,.10);">
      <tr><td style="background:${C.dark};padding:24px 32px;color:#fff;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${C.mid};width:46px;height:46px;border-radius:8px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:15px;">GIG</td>
          <td style="padding-left:12px;font-weight:700;font-size:15px;">Geodezyjna Izba Gospodarcza<br><span style="font-weight:400;font-size:12px;color:rgba(255,255,255,.6);">gig.org.pl</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;background:${C.mid};"></td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:${C.dark};">${title}</h1>
        ${body}
      </td></tr>
      <tr><td style="background:#f6f8fa;padding:20px 32px;border-top:1px solid #e6ebf0;">
        <p style="margin:0;font-size:12px;color:#6b7c8c;line-height:1.6;">
          <strong style="color:${C.dark};">Geodezyjna Izba Gospodarcza</strong><br>
          ul. Czackiego 3/5, 00-043 Warszawa &middot; tel. 22 827 38 43<br>
          <a href="mailto:biuro@gig.org.pl" style="color:${C.mid};text-decoration:none;">biuro@gig.org.pl</a> &middot;
          <a href="https://gig.org.pl" style="color:${C.mid};text-decoration:none;">gig.org.pl</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function newsletterMail(rec: Record<string, unknown>) {
  const unsub = `${FUNCTIONS_BASE}/newsletter-unsubscribe?id=${rec.id ?? ""}`;
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Dziękujemy za zapisanie się do newslettera <strong>Geodezyjnej Izby Gospodarczej</strong>.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Będziesz otrzymywać informacje o aktualnościach, szkoleniach i biuletynach GIG.</p>
    <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e6ebf0;font-size:12px;color:#90a4b4;">
      Nie chcesz otrzymywać newslettera? <a href="${unsub}" style="color:#90a4b4;text-decoration:underline;">Wypisz się jednym kliknięciem</a>.
    </p>`;
  return { subject: "Potwierdzenie zapisu do newslettera GIG", html: layout("Zapis potwierdzony ✓", body) };
}

function kontaktMail(rec: Record<string, unknown>) {
  const name = (rec.name as string) || "";
  const greet = name && name !== "Anonim" ? `Szanowny/a ${esc(name)},` : "Dzień dobry,";
  const msg = (rec.message as string) || "";
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">${greet}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">dziękujemy za kontakt z Geodezyjną Izbą Gospodarczą. Odpowiemy najszybciej, jak to możliwe.</p>
    ${msg ? `<div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Twoja wiadomość:</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(msg)}</p></div>` : ""}`;
  return { subject: "Otrzymaliśmy Twoją wiadomość — GIG", html: layout("Wiadomość przyjęta ✓", body) };
}

/* Rodzaj zgloszenia rozpoznajemy po prefiksie tematu, ktory ustawia
   forms_integration.js: zapis na szkolenie, akces czlonkowski albo zwykly kontakt. */
function rodzaj(subject: string): string {
  if (/^Zapis na szkolenie:/i.test(subject)) return "Zapis na szkolenie";
  if (/^Zgłoszenie członkowskie:/i.test(subject)) return "Zgłoszenie członkowskie";
  return "Wiadomość z formularza kontaktowego";
}

/* Powiadomienie wewnetrzne dla GIG. Reply-To ustawiamy na adres nadawcy,
   wiec odpowiedz z klienta poczty trafia wprost do niego. */
function notifyMail(rec: Record<string, unknown>) {
  const subject = (rec.subject as string) || "";
  const typ = rodzaj(subject);
  const name = (rec.name as string) || "—";
  const from = (rec.email as string) || "—";
  const msg = (rec.message as string) || "";
  const kiedy = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

  const wiersz = (etykieta: string, wartosc: string) => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${etykieta}</td>
      <td style="padding:6px 0;font-size:14px;color:${C.dark};">${wartosc}</td>
    </tr>`;

  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Nowe zgłoszenie ze strony <strong>gig.org.pl</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">
      ${wiersz("Rodzaj", `<strong>${esc(typ)}</strong>`)}
      ${wiersz("Od", esc(name))}
      ${wiersz("E-mail", `<a href="mailto:${esc(from)}" style="color:${C.mid};">${esc(from)}</a>`)}
      ${subject ? wiersz("Temat", esc(subject)) : ""}
      ${wiersz("Otrzymano", esc(kiedy))}
    </table>
    ${msg ? `<div style="margin:0 0 18px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Treść zgłoszenia</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(msg)}</p></div>` : ""}
    <p style="margin:0;font-size:13px;color:#6b7c8c;">
      Odpowiadając na tego maila, piszesz bezpośrednio do nadawcy.
      Zgłoszenie jest też w <a href="https://gig.org.pl/admin/" style="color:${C.mid};">panelu GIG</a>.
    </p>`;

  return {
    subject: `[GIG] ${typ}${name && name !== "—" ? " — " + name : ""}`,
    html: layout("Nowe zgłoszenie", body),
  };
}

/* Powiadomienie o nowym zapisie do newslettera. Krotkie - liczy sie sam fakt
   i adres; Reply-To ustawiamy na zapisujacego sie, zeby dalo sie odpisac wprost. */
function notifyNewsletterMail(rec: Record<string, unknown>) {
  const adres = (rec.email as string) || "—";
  const kiedy = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Nowy zapis do newslettera <strong>gig.org.pl</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;">E-mail</td>
        <td style="padding:6px 0;font-size:14px;color:${C.dark};"><a href="mailto:${esc(adres)}" style="color:${C.mid};">${esc(adres)}</a></td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;">Zapisano</td>
        <td style="padding:6px 0;font-size:14px;color:${C.dark};">${esc(kiedy)}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6b7c8c;">
      Pelna lista zapisow jest w <a href="https://gig.org.pl/admin/" style="color:${C.mid};">panelu GIG</a>.
    </p>`;
  return { subject: `[GIG] Nowy zapis do newslettera — ${adres}`, html: layout("Nowy zapis do newslettera", body) };
}

/* --- ZAPISY NA SZKOLENIA (tabela zapisy_szkolenia) --------------------- */

function wierszTabeli(etykieta: string, wartosc: string): string {
  if (!wartosc) return "";
  return `<tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7c8c;white-space:nowrap;vertical-align:top;">${etykieta}</td>
      <td style="padding:6px 0;font-size:14px;color:${C.dark};">${wartosc}</td>
    </tr>`;
}

/* Powiadomienie dla GIG: komplet danych potrzebnych do wystawienia faktury,
   zeby nie trzeba bylo wchodzic do panelu przy kazdym zgloszeniu. */
function zapisNotifyMail(rec: Record<string, unknown>) {
  const s = (k: string) => String(rec[k] ?? "").trim();
  const szkolenie = s("szkolenie") || "(nie podano)";
  const takiSam = rec.odbiorca_taki_sam !== false;
  const jst = rec.nabywca_jst === true;

  const blok = (tytul: string, tresc: string) => `
    <div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">${tytul}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${tresc}</table>
    </div>`;

  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Nowe zgłoszenie na szkolenie <strong>${esc(szkolenie)}</strong>.</p>

    ${blok("Uczestnicy",
      wierszTabeli("Liczba osób", esc(s("liczba_osob"))) +
      wierszTabeli("Imiona i nazwiska", esc(s("uczestnicy")).replace(/\n/g, "<br>")))}

    ${blok("Nabywca",
      wierszTabeli("Nazwa", esc(s("nabywca_nazwa"))) +
      wierszTabeli("Adres", esc(s("nabywca_adres"))) +
      wierszTabeli("NIP", esc(s("nabywca_nip"))) +
      wierszTabeli("Jednostka samorządu", jst ? "<strong>TAK</strong>" : "nie"))}

    ${takiSam
      ? blok("Odbiorca", wierszTabeli("Odbiorca", "taki sam jak nabywca"))
      : blok("Odbiorca",
          wierszTabeli("Nazwa", esc(s("odbiorca_nazwa"))) +
          wierszTabeli("Adres", esc(s("odbiorca_adres"))) +
          wierszTabeli("NIP / ID-wewn.", esc(s("odbiorca_nip"))))}

    ${blok("Kontakt",
      wierszTabeli("E-mail", `<a href="mailto:${esc(s("email"))}" style="color:${C.mid};">${esc(s("email"))}</a>`) +
      wierszTabeli("Telefon", esc(s("telefon"))) +
      wierszTabeli("Uwagi", esc(s("uwagi")).replace(/\n/g, "<br>")))}

    <p style="margin:0;font-size:13px;color:#6b7c8c;">
      Odpowiadając na tego maila, piszesz bezpośrednio do zgłaszającego.
      Zgłoszenie jest też w <a href="https://gig.org.pl/admin/" style="color:${C.mid};">panelu GIG</a>.
    </p>`;

  return {
    subject: `[GIG] Zapis na szkolenie — ${s("nabywca_nazwa") || s("email")}`,
    html: layout("Nowy zapis na szkolenie", body),
  };
}

/* Potwierdzenie dla zglaszajacego. */
function zapisPotwierdzenieMail(rec: Record<string, unknown>) {
  const szkolenie = String(rec.szkolenie ?? "").trim();
  const osoby = String(rec.uczestnicy ?? "").trim();
  const body = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Dzień dobry,</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">
      potwierdzamy przyjęcie zgłoszenia${szkolenie ? ` na szkolenie <strong>${esc(szkolenie)}</strong>` : ""}.
      Skontaktujemy się w sprawie szczegółów organizacyjnych i faktury.</p>
    ${osoby ? `<div style="margin:0 0 16px;padding:14px 18px;background:${C.bg};border-left:4px solid ${C.mid};border-radius:6px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${C.mid};text-transform:uppercase;">Zgłoszone osoby</p>
      <p style="margin:0;font-size:14px;line-height:1.6;">${esc(osoby).replace(/\n/g, "<br>")}</p></div>` : ""}
    <p style="margin:0;font-size:13px;color:#6b7c8c;">Jeśli któraś dana wymaga poprawki, odpisz na tę wiadomość.</p>`;
  return { subject: "Potwierdzenie zgłoszenia na szkolenie — GIG", html: layout("Zgłoszenie przyjęte ✓", body) };
}

/* Jedno wywolanie Resend. Zwraca blad zamiast rzucac, zeby niepowodzenie
   jednego maila nie blokowalo wyslania drugiego. */
async function wyslij(
  to: string[],
  mail: { subject: string; html: string },
  replyTo?: string,
): Promise<{ ok: boolean; info: unknown }> {
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL, to, subject: mail.subject, html: mail.html,
  };
  if (replyTo) payload.reply_to = replyTo;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const wynik = await res.json();
    if (!res.ok) console.error("Resend:", wynik);
    return { ok: res.ok, info: wynik };
  } catch (err) {
    console.error("Resend (wyjatek):", err);
    return { ok: false, info: String(err) };
  }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const table = payload.table as string;
    const rec = (payload.record ?? {}) as Record<string, unknown>;
    const nadawca = (rec.email as string) || "";
    if (!nadawca) return new Response(JSON.stringify({ skipped: "brak email" }), { status: 200 });

    const wyniki: Record<string, unknown> = {};

    if (table === "submissions_kontakt") {
      // 1) powiadomienie do GIG — Reply-To na nadawce, zeby dalo sie odpisac wprost
      if (NOTIFY_EMAILS.length) {
        const r = await wyslij(NOTIFY_EMAILS, notifyMail(rec), nadawca);
        wyniki.powiadomienie = r.ok ? "wyslane" : r.info;
      }
      // 2) potwierdzenie dla nadawcy
      const p = await wyslij([nadawca], kontaktMail(rec));
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else if (table === "zapisy_szkolenia") {
      // 1) powiadomienie do GIG z kompletem danych do faktury
      if (NOTIFY_EMAILS.length) {
        const r = await wyslij(NOTIFY_EMAILS, zapisNotifyMail(rec), nadawca);
        wyniki.powiadomienie = r.ok ? "wyslane" : r.info;
      }
      // 2) potwierdzenie dla zglaszajacego
      const p = await wyslij([nadawca], zapisPotwierdzenieMail(rec));
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else if (table === "submissions_newsletter") {
      // 1) powiadomienie o nowym zapisie — osobna lista odbiorcow
      if (NOTIFY_NEWSLETTER.length) {
        const r = await wyslij(NOTIFY_NEWSLETTER, notifyNewsletterMail(rec), nadawca);
        wyniki.powiadomienie = r.ok ? "wyslane" : r.info;
      }
      // 2) potwierdzenie dla zapisujacego sie
      const p = await wyslij([nadawca], newsletterMail(rec));
      wyniki.potwierdzenie = p.ok ? "wyslane" : p.info;

    } else {
      return new Response(JSON.stringify({ skipped: `tabela ${table}` }), { status: 200 });
    }

    // 200 nawet przy czesciowym niepowodzeniu: webhook Supabase nie ma sensownego
    // ponawiania, a szczegoly i tak trafiaja do logow funkcji.
    return new Response(JSON.stringify({ ok: true, ...wyniki }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
