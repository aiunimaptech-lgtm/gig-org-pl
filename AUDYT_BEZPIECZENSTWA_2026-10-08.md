# Audyt bezpieczeństwa gig.org.pl (8.10.2026)

Zakres: baza Supabase (RLS, funkcje, widoki, triggery), Edge Functions, strona i panel `/admin/`,
Vercel, GitHub, polityka prywatności, retencja danych. Cel: zapobiec wyciekowi danych osobowych
(zgłoszenia na szkolenia, baza e-mail, newsletter, formularze, głosowania organów).

## 1. Wynik w skrócie

- Dane osobowe w bazie są niedostępne dla niezalogowanych: wszystkie 25 tabel ma RLS, odczyt
  wymaga konta panelu i kodu z maila (2FA). Sprawdzone w praktyce z kluczem publicznym.
- Rejestracja kont jest wyłączona (signup_disabled). Konta: biuro@gig.org.pl, jerzy.bryk@gmail.com.
- Repozytorium nie zawiera zgłoszeń, bazy e-mail ani list uczestników (ani w historii).
- Znaleziono i naprawiono jedną poważną lukę: `send-confirmation` przyjmowała żądania bez tokenu,
  czyli każdy mógł wysyłać maile z biuro@gig.org.pl na dowolny adres (otwarty przekaźnik).
- Pozostałe znaleziska to utwardzenie (XSS w linkach WWW, nagłówki, uprawnienia funkcji)
  oraz sprawy organizacyjne i prawne, które wymagają decyzji (sekcja 3).

## 2. Zrobione 8.10.2026 (bez zmian w działaniu strony i panelu)

| Obszar | Zmiana | Weryfikacja |
|---|---|---|
| Edge `send-confirmation` v21 | nagłówek `x-gig-token` obowiązkowy; sprawdzany przez RPC `gig_hook_token_ok` (service_role), opcjonalnie przez sekret `GIG_HOOK_TOKEN` | bez tokenu 401, zły token 401, token z triggera 200 |
| Baza | EXECUTE odebrane public/anon/authenticated dla funkcji triggerów i `rls_auto_enable` | zapis na szkolenie dalej przechodzi przez triggery |
| Baza | `gig_uchwala_generuj` i `gig_opinia_generuj` wewnętrzne; panel woła `gig_uchwala_generuj_panel` z kontrolą 2FA | panel `uchwaly.html` zaktualizowany (7 wywołań) |
| Baza | widok `gig_odbiorcy_konsultacji` z `security_invoker` (RLS 2FA tabel źródłowych) | panel konsultacji czyta go po 2FA jak dotąd |
| Baza | `panel_2fa`, `panel_zaproszenia`: bez uprawnień dla anon/authenticated; `search_path` w 11 funkcjach | advisor Supabase |
| `/glosowanie/`, panel `czlonkowie.html` | link „Strona WWW” tylko dla http(s); `javascript:` zostaje tekstem (XSS z publicznego formularza „Dołącz do nas”) | kod |
| `_admin.js` | `toast()` bez HTML (textContent); eksport CSV neutralizuje formuły (`=`, `+`, `-`, `@`); `bezpiecznyUrl()` | `node --check` |
| `vercel.json` | nagłówki: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, HSTS; `/admin/` i strony z tokenem: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex` | `curl -I` po wdrożeniu |
| `.gitignore` | `#szkolenia/`, `dla Dawida/`, `*.xlsx`, `*.xls`, `*.csv`, `*.7z`, `*.zip` | `git ls-files -ci` pusty |

Skrypt SQL dokumentujący zmiany w bazie: `backend/supabase_audyt_2026_10_08.sql`.

## 3. Do decyzji lub zrobienia przez właściciela

### 3a. Ustawienia w panelach usług (wymagają logowania właściciela)
1. **Supabase → Authentication → Passwords: „Leaked password protection”** włączyć (sprawdza hasła panelu w HaveIBeenPwned).
2. **Supabase → Account → MFA** na kontach z dostępem do dashboardu (dashboard = pełny dostęp do danych).
3. **GitHub → Settings → Security: „Secret scanning” i „Push protection”** włączyć (repozytorium jest publiczne). Włączyć 2FA na kontach `jbryk` i `aiunimaptech-lgtm`.
4. **Vercel**: 2FA na koncie; podglądy wdrożeń są już chronione (SSO, tylko domena własna jest publiczna).
5. **Resend**: klucz API z uprawnieniem tylko „Sending access” do domeny gig.org.pl (nie „Full access”); 2FA na koncie.
6. **Supabase → Edge Functions → Secrets → `NOTIFY_EMAILS`**: dziś domyślnie `biuro@gig.org.pl,jerzy.bryk@gmail.com`. Powiadomienia z danymi do faktur (NIP, adresy, telefony) trafiają na prywatny Gmail. Zalecane: tylko `biuro@gig.org.pl` albo adres w domenie Izby.
7. **Kopie zapasowe**: plan darmowy Supabase nie robi kopii. Zalecane: cotygodniowy `pg_dump` na dysk biura (mogę przygotować skrypt) albo plan Pro (kopie dzienne).

### 3b. Decyzje prawne i organizacyjne (RODO)
8. **Polityka prywatności** (`/polityka-prywatnosci-rodo/`) jest z czasów WordPressa: wymienia Google Analytics, Facebook Pixel i reCAPTCHA, których strona nie używa, a nie wymienia faktycznych odbiorców: Supabase (baza, Sztokholm, UE), Resend (poczta, USA), Vercel (hosting, USA), Microsoft Teams (szkolenia online, raport obecności), Google Fonts. Brakuje celów: zapisy na szkolenia i faktury, zaświadczenia, głosowania organów, Węzeł Jakości, newsletter, kampanie do bazy kontaktów; okresów przechowywania; informacji o przekazywaniu poza EOG na podstawie DPF/SCC. Mogę przygotować projekt do akceptacji prawnika.
9. **Baza e-mail do kampanii (14 431 adresów)**: trigger dopisuje każdego zgłaszającego na szkolenie do listy „Uczestnicy szkoleń”, z której idą kampanie. To inny cel niż obsługa zgłoszenia. Do decyzji: zgoda (checkbox) albo udokumentowany uzasadniony interes w informacji RODO plus łatwy sprzeciw (jest link wypisu).
10. **Retencja**: brak automatycznego usuwania. Propozycja: zgłoszenia na szkolenia 5 lat (dokumenty księgowe) z anonimizacją danych uczestników po 2 latach; formularz kontaktowy 2 lata; odbiorcy kampanii i zdarzenia mailowe 12 miesięcy; sesje panelu po wygaśnięciu; adresy IP z głosowań 90 dni. Po decyzji ustawię zadanie pg_cron.
11. **Pliki DOCX na stronie** (`/dokumenty/06-08_*`): skład Rady i komisji z prywatnymi telefonami komórkowymi i e-mailami. Zostawić same nazwiska i funkcje albo uzyskać zgody. Plik `09_Czlonkowie_GIG_stan_na_03.07.2025.docx` jest nieaktualny (katalog `/czlonkowie/` go zastępuje); do usunięcia.
12. **Repozytorium publiczne**: poza stroną są w nim tylko dwa adresy prywatne (zbk.zenon@gmail.com w `backend/supabase_uchwaly.sql`, jerzy.bryk@gmail.com w HANDOVER/README/2 funkcjach). Decyzja: usunąć z plików (w historii zostaną) albo zmienić repozytorium na prywatne (limit 2000 min Actions/mies. na planie darmowym; prerender co godzinę zużywa ok. 700-1400 min, więc zmniejszyłbym częstotliwość).
13. **Konto admina na prywatnym Gmailu** (jerzy.bryk@gmail.com): zalecane konto w domenie Izby lub gigkc.onmicrosoft.com.

### 3c. Dalsze utwardzenie (do zaplanowania, nie blokuje)
14. **CAPTCHA (Cloudflare Turnstile) na formularzach**: dziś każdy może wstawić zgłoszenie bez limitu, a każde wstawienie wysyła mail potwierdzający na podany adres (możliwość zalewania cudzej skrzynki mailami z GIG). Wymaga konta Cloudflare i kluczy (interakcja właściciela), zapis przez Edge Function zamiast bezpośredniego INSERT. Double opt-in w newsletterze.
15. **Sesja panelu**: 14 dni ważności, brak wylogowania po bezczynności, refresh token w localStorage. Propozycja: 2 dni, wylogowanie po 30 min bezczynności, kasowanie sesji przy wylogowaniu.
16. **Limit prób kodu 2FA**: licznik zeruje się po 5 błędach, więc znając hasło można próbować w pętli (każda próba wysyła mail, więc atak jest widoczny). Propozycja: blokada konta po 15 błędnych kodach na dobę i limit per IP.
17. **Tokeny w linkach bez wygasania** (`/uczestnicy/`, `/glosowanie/`, `/ankieta/`, `/wizytowka/`): po zamknięciu sprawy link nadal pokazuje dane. Propozycja: po zamknięciu tylko status, bez danych; wygasanie 30 dni po terminie.
18. **Biblioteki z CDN bez przypiętej wersji i SRI** w panelu (supabase-js@2, quill@2). Propozycja: przypiąć wersje i dodać `integrity` albo serwować z `/_assets/vendor/`.
19. **Logi Edge Functions** zapisują adresy e-mail przy błędach (glosuj, konsultacja-glosuj, baza-wypis, resend-webhook, wyslij-mail). Propozycja: logować id rekordu zamiast adresu.
20. **CORS `*`** we wszystkich funkcjach: zawęzić do `https://gig.org.pl`.
21. **Pliki SQL w `backend/`** (setup, zapisy, czlonkowie, baza_email, wysylki, dmarc) przy ponownym uruchomieniu nadpisują polityki bez warunku 2FA. Oznaczyć jako historyczne albo dopisać `and public.gig_sesja_2fa()`.
22. **Czcionki Google Fonts** na każdej stronie (IP użytkownika do Google): hostować lokalnie.
23. **`newsletter-unsubscribe`** zmienia stan przez GET (skanery poczty mogą wypisać odbiorcę): zrobić jak `baza-wypis` (strona z przyciskiem).

## 4. Co jest zrobione dobrze (bez zmian)
- RLS na wszystkich tabelach; odczyt danych osobowych tylko po 2FA egzekwowanym w bazie (`gig_sesja_2fa`), nie tylko w interfejsie.
- Funkcje wysyłkowe z panelu sprawdzają JWT i sesję po kodzie; cron kampanii używa osobnego tokenu w `private.gig_sekrety` (schemat poza API).
- Tokeny w linkach: 192-256 bitów z CSPRNG, porównanie po równości, link sam niczego nie zmienia (głos, wypis, formularz uczestników wymagają kliknięcia).
- Sekrety (service_role, Resend) tylko w Supabase; na stronie wyłącznie klucz publishable; w repozytorium brak kluczy.
- `/admin/` i strony z tokenem mają `noindex`; `robots.txt` blokuje `/admin/`; Vercel chroni podglądy wdrożeń.
- Brak analityki śledzącej (GA, Pixel) na stronie.
