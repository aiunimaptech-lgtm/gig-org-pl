/* =====================================================================
   GIG — integracja formularzy (Contact Form 7) z Supabase
   ---------------------------------------------------------------------
   Przechwytuje wysyłkę formularzy CF7 i zapisuje do Supabase:
     - newsletter (pole your-newsletter-email)  -> submissions_newsletter
     - kontakt   (your-name/email/subject/message) -> submissions_kontakt
   Tryby:
     1) BACKEND: po uzupełnieniu SUPABASE_URL + SUPABASE_ANON zapisuje do bazy.
     2) FALLBACK: dopóki Supabase niepodpięte -> otwiera pocztę (mailto biuro@gig.org.pl).
   KONFIGURACJA: uzupełnij dwie stałe poniżej (Supabase → Settings → API; klucz anon).
   ===================================================================== */
(function () {
  "use strict";

  var SUPABASE_URL  = window.GIG_CFG.SUPABASE_URL;
  var SUPABASE_ANON = window.GIG_CFG.SUPABASE_ANON;
  var FALLBACK_EMAIL = "biuro@gig.org.pl";

  var configured = SUPABASE_URL.indexOf("TWOJ-PROJEKT") === -1 && SUPABASE_ANON.indexOf("XXXX") === -1;

  var dbPromise = null;
  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (window.supabase) return resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON));
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      s.onload = function () { resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)); };
      s.onerror = function () { reject(new Error("Supabase SDK load error")); };
      document.head.appendChild(s);
    });
    return dbPromise;
  }

  function val(form, sel) {
    var el = form.querySelector(sel);
    return el ? (el.value || "").trim() : "";
  }
  function isEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

  function showMsg(form, text, ok) {
    var box = form.querySelector(".wpcf7-response-output");
    if (!box) {
      box = document.createElement("div");
      box.className = "wpcf7-response-output";
      form.appendChild(box);
    }
    box.style.cssText = "margin-top:12px;padding:10px 14px;border-radius:6px;font-size:14px;" +
      (ok ? "background:#e8f3ec;color:#1f6b3b;border:1px solid #b6dcc4;"
          : "background:#fbeaea;color:#9b2222;border:1px solid #e6b8b8;");
    // CF7 ukrywa .wpcf7-response-output własnym CSS — wymuszamy widoczność
    box.style.setProperty("display", "block", "important");
    box.textContent = text;
  }

  function mailto(subject, body) {
    return "mailto:" + FALLBACK_EMAIL + "?subject=" + encodeURIComponent(subject) +
           "&body=" + encodeURIComponent(body);
  }

  function classify(form) {
    if (form.querySelector('[name="your-newsletter-email"]')) return "newsletter";
    if (form.querySelector('[name="company-name"], [name="company-email"]')) return "czlonkostwo";
    if (form.querySelector('[name="your-message"], [name="your-email"]')) return "kontakt";
    return null;
  }

  async function handleNewsletter(form) {
    var email = val(form, '[name="your-newsletter-email"]');
    var consent = form.querySelector('[name="newsletter-consent"]');
    if (!isEmail(email)) { showMsg(form, "Podaj poprawny adres e-mail.", false); return; }
    if (consent && !consent.checked) { showMsg(form, "Zaznacz zgodę na przetwarzanie danych.", false); return; }

    if (!configured) {
      window.location.href = mailto("Zapis do newslettera GIG", "Proszę o zapis do newslettera GIG:\nE-mail: " + email + "\n");
      showMsg(form, "Otworzyliśmy program pocztowy. Jeśli się nie otworzył, napisz na " + FALLBACK_EMAIL + ".", true);
      return;
    }
    try {
      var db = await getDb();
      var res = await db.from("submissions_newsletter").insert({ email: email, status: "new" });
      if (res.error && res.error.code !== "23505") throw res.error; // 23505 = duplikat = ok
      form.reset();
      showMsg(form, "✓ Dziękujemy! Zapisano do newslettera.", true);
    } catch (e) {
      console.error(e);
      showMsg(form, "Błąd zapisu — spróbuj ponownie lub napisz na " + FALLBACK_EMAIL + ".", false);
    }
  }

  async function handleKontakt(form) {
    var data = {
      name: val(form, '[name="your-name"]'),
      email: val(form, '[name="your-email"]'),
      subject: val(form, '[name="your-subject"]'),
      message: val(form, '[name="your-message"]')
    };
    var acc = form.querySelector('[name="acceptance-rodo"]');
    if (!data.email || !data.message) { showMsg(form, "Uzupełnij e-mail i treść wiadomości.", false); return; }
    if (!isEmail(data.email)) { showMsg(form, "Podaj poprawny adres e-mail.", false); return; }
    if (acc && !acc.checked) { showMsg(form, "Zaznacz zgodę RODO.", false); return; }

    if (!configured) {
      window.location.href = mailto("Wiadomość ze strony GIG: " + (data.subject || "kontakt"),
        "Imię: " + data.name + "\nE-mail: " + data.email + "\nTemat: " + (data.subject || "—") + "\n\n" + data.message + "\n");
      showMsg(form, "Otworzyliśmy program pocztowy. Jeśli się nie otworzył, napisz na " + FALLBACK_EMAIL + ".", true);
      return;
    }
    try {
      var db = await getDb();
      var res = await db.from("submissions_kontakt").insert({
        name: data.name || "Anonim", email: data.email,
        subject: data.subject || null, message: data.message, status: "new"
      });
      if (res.error) throw res.error;
      form.reset();
      showMsg(form, "✓ Wiadomość wysłana. Odpowiemy najszybciej, jak to możliwe.", true);
    } catch (e) {
      console.error(e);
      showMsg(form, "Błąd wysyłania — spróbuj ponownie lub napisz na " + FALLBACK_EMAIL + ".", false);
    }
  }

  async function handleCzlonkostwo(form) {
    var d = {
      company:   val(form, '[name="company-name"]'),
      address:   val(form, '[name="company-address"]'),
      phone:     val(form, '[name="company-phone"]'),
      email:     val(form, '[name="company-email"]'),
      person:    val(form, '[name="representative-name"]'),
      employees: val(form, '[name="employees-count"]'),
      business:  val(form, '[name="business-type"]')
    };
    var mc = form.querySelector('[name="membership-consent"]');
    var rodo = form.querySelector('[name="acceptance-rodo"]');
    if (!d.company || !d.email) { showMsg(form, "Uzupełnij nazwę firmy oraz adres e-mail.", false); return; }
    if (!isEmail(d.email)) { showMsg(form, "Podaj poprawny adres e-mail.", false); return; }
    if (mc && !mc.checked) { showMsg(form, "Zaznacz oświadczenie o akcesie członkowskim.", false); return; }
    if (rodo && !rodo.checked) { showMsg(form, "Zaznacz zgodę na przetwarzanie danych (RODO).", false); return; }

    var message =
      "ZGŁOSZENIE CZŁONKOWSKIE\n" +
      "Firma: " + d.company + "\n" +
      "Adres: " + (d.address || "—") + "\n" +
      "Telefon: " + (d.phone || "—") + "\n" +
      "E-mail: " + d.email + "\n" +
      "Osoba reprezentująca: " + (d.person || "—") + "\n" +
      "Liczba osób w firmie: " + (d.employees || "—") + "\n" +
      "Profil działalności: " + (d.business || "—") + "\n\n" +
      "Akces członkowski: TAK (wpisowe 75,00 zł + składki). Zgoda RODO: TAK.";

    if (!configured) {
      window.location.href = mailto("Zgłoszenie członkowskie GIG: " + d.company, message);
      showMsg(form, "Otworzyliśmy program pocztowy. Jeśli się nie otworzył, napisz na " + FALLBACK_EMAIL + ".", true);
      return;
    }
    var btn = form.querySelector('.wpcf7-submit, [type="submit"]');
    if (btn) btn.disabled = true;
    try {
      var db = await getDb();
      var res = await db.from("submissions_kontakt").insert({
        name: d.person || d.company, email: d.email,
        subject: "Zgłoszenie członkowskie: " + d.company, message: message, status: "new"
      });
      if (res.error) throw res.error;
      form.reset();
      showMsg(form, "✓ Dziękujemy! Zgłoszenie zostało wysłane. Skontaktujemy się z Państwem.", true);
    } catch (e) {
      console.error(e);
      showMsg(form, "Błąd wysyłania — spróbuj ponownie lub napisz na " + FALLBACK_EMAIL + ".", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* Jedno wejście dla obu ścieżek (klik w przycisk i Enter w polu), z blokadą
     podwójnego wysłania. */
  function obsluz(form) {
    if (form.dataset.gigBusy === "1") return;
    form.dataset.gigBusy = "1";
    var kind = classify(form);
    var p = kind === "newsletter"   ? handleNewsletter(form)
          : kind === "czlonkostwo"  ? handleCzlonkostwo(form)
          : kind === "kontakt"      ? handleKontakt(form)
          : null;
    Promise.resolve(p).catch(function () {}).then(function () { form.dataset.gigBusy = ""; });
  }

  function hook(form) {
    if (form.dataset.gigHooked) return;
    form.dataset.gigHooked = "1";

    // Enter w polu / programowy submit
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopImmediatePropagation(); // zablokuj własny handler CF7
      obsluz(form);
    }, true); // capture

    var btn = form.querySelector('.wpcf7-submit, [type="submit"]');
    if (!btn) return;

    /* Cloudflare Turnstile (z czasów WordPressa) trzyma przycisk wyłączony do czasu
       rozwiązania testu. Na statycznym mirrorze nie ma backendu CF7, który by go
       zweryfikował, więc przycisk potrafi zostać wyłączony na zawsze i formularz
       „nie działa”. Wysyłkę i tak obsługujemy sami (Supabase), więc odblokowujemy
       przycisk — i pilnujemy, gdyby CF7 wyłączył go ponownie (asynchronicznie). */
    var wlacz = function () { if (btn.disabled) btn.disabled = false; };
    wlacz();
    try {
      new MutationObserver(wlacz).observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    } catch (_) { setInterval(wlacz, 1000); }

    /* Klik obsługujemy sami — dzięki preventDefault natywny submit się nie odpali,
       więc handler powyżej nie zadziała drugi raz. */
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      obsluz(form);
    }, true);
  }

  // Wstępne wypełnienie formularza po przyjściu z „Zapisz się” (/kontakt/?szkolenie=...)
  function prefillFromSzkolenie() {
    var m = location.search.match(/[?&]szkolenie=([^&]+)/);
    if (!m) return;
    var title = decodeURIComponent(m[1].replace(/\+/g, " "));
    var subj = document.querySelector('[name="your-subject"]');
    var msg = document.querySelector('[name="your-message"]');
    /* CF7 po inicjalizacji woła form.reset() (klasa „resetting") i skasowałoby samo `value`.
       Ustawiamy też `defaultValue` — to właśnie jego przywraca reset, więc treść zostaje. */
    function wstaw(el, tekst) {
      if (!el || el.value) return;
      el.value = tekst;
      el.defaultValue = tekst;
    }
    wstaw(subj, "Zapis na szkolenie: " + title);
    wstaw(msg, "Chcę zgłosić udział w szkoleniu: " + title + ".\n\nImię i nazwisko / firma:\nTelefon:\n");
  }

  function init() {
    document.querySelectorAll("form.wpcf7-form, form").forEach(function (f) {
      if (classify(f)) hook(f);
    });
    prefillFromSzkolenie();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
