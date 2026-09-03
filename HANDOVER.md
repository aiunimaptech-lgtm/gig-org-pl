# Przekazanie sesji — gig.org.pl

**Stan na:** 4 września 2026 · ostatni commit `40673d4` · wszystko wypchnięte na `origin/main`
**Repo:** https://github.com/aiunimaptech-lgtm/gig-org-pl · **Deploy:** Vercel, Root Directory = `strona/`
**Supabase:** projekt `zlepwzeyjwpmhyxfnime` (org `jbryk's Org`, plan Free)

> Ten plik czytaj razem z `CLAUDE.md` (architektura) i `README-WDROZENIE.md` (kroki wdrożeniowe).
> Tutaj jest **stan bieżący, pułapki i co dalej** — rzeczy, których nie widać z samego kodu.

---

## 1. Co działa (zweryfikowane end-to-end)

### Formularze → baza → maile

Trzy formularze piszą do Supabase, każdy wpis wyzwala trigger `pg_net`, który woła Edge Function
`send-confirmation`, a ta wysyła maile przez Resend:

| formularz | tabela | powiadomienie do | potwierdzenie |
|---|---|---|---|
| kontakt / akces członkowski | `submissions_kontakt` | `biuro@gig.org.pl` + `jerzy.bryk@gmail.com` | tak |
| **zapis na szkolenie** | `zapisy_szkolenia` | j.w., z kompletem danych do faktury | tak |
| newsletter | `submissions_newsletter` | `jerzy.bryk@gmail.com` (osobna lista) | tak |

`Reply-To` w powiadomieniu wskazuje na zgłaszającego — odpowiedź idzie wprost do niego.

**Jak sprawdzić, czy wysyłka działa** (najszybsza diagnostyka):
```sql
select id, status_code, left(content,200), created
from net._http_response order by id desc limit 5;
```
Poprawna odpowiedź: `{"ok":true,"powiadomienie":"wyslane","potwierdzenie":"wyslane"}`.
`{"skipped":"tabela ..."}` = wdrożona funkcja nie zna tej tabeli (stara wersja).

### Strona zapisu `/zapisy/`
Ręcznie zbudowana (jak `/wpis/`, `/czlonkowie/`, `/nadchodzace-wydarzenia/`), **nie** mirror WP.
Pola: liczba osób, imiona i nazwiska, nabywca (nazwa/adres/NIP + znacznik JST),
odbiorca (nazwa/adres/**NIP / ID-wewn.**, domyślnie ukryty), e-mail, telefon, uwagi, RODO.
Przycisk „Zapisz się" w kalendarzu szkoleń prowadzi tu z `?szkolenie=<tytuł>`.

### Sekrety w Supabase (Edge Functions → Secrets)
`RESEND_API_KEY`, `FROM_EMAIL`, `NOTIFY_EMAILS`, `NOTIFY_NEWSLETTER_EMAILS`, `SITE_URL`.
`SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` Supabase wstrzykuje **automatycznie** — nie ustawiać.

### DNS / Resend
Domena `gig.org.pl` zweryfikowana w Resend przez **subdomenę** `send.gig.org.pl` (SPF + MX zwrotek)
oraz DKIM `resend._domainkey`. Poczta firmowa (MX `poczta.gig.org.pl`) i SPF domeny głównej
(zawiera MailerLite `_spf.mlsend.com`) **nietknięte** — i tak ma zostać.

---

## 2. Pułapki — przeczytaj, zanim stracisz na nie godzinę

**Panel Supabase połyka błędy wdrożenia.** Dialog „Confirm to deploy updates" zamyka się bez
komunikatu, a znacznik czasu zostaje stary. Wygląda jak zawieszony dashboard — a to może być
błąd składni w kodzie. Komunikat pojawia się jako **toast w prawym górnym rogu**, często
poza kadrem zrzutu. Zdiagnozowałem to trzykrotnie błędnie jako awarię panelu; faktycznie
`.replace(/\n/g,...)` miało prawdziwy znak nowej linii zamiast `\n` → *Unterminated regexp literal*.
**Zawsze weryfikuj wdrożenie testem zapisu do bazy, nie tym, co pokazuje panel.**

**Vercel Security Checkpoint wywala aplikację Claude Code.** Wejście panelem Browser na
`https://gig.org.pl/` powtarzalnie kończyło sesję. Nie wchodź tam wbudowaną przeglądarką.
Do weryfikacji produkcji używaj `curl` z nagłówkiem przeglądarki:
```bash
curl -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" https://gig.org.pl/...
```
Bez tego dostaniesz 403 (checkpoint), co łatwo pomylić z błędem wdrożenia.

**Cache przeglądarki maskuje zmiany w JS przy testach lokalnych.** `Ctrl+Shift+F5` nie wystarczy
dla podzasobów. Uruchamiaj serwer na **nowym porcie** (`python -m http.server 8xxx`) — inne
origin = pusty cache. Weryfikacja: `performance.getEntriesByType('resource')` → `decodedBodySize`.

**Klucz `anon` nie może czytać zgłoszeń — RLS zwraca pustą listę, nie błąd.** `[]` z REST API
**nie znaczy**, że tabela jest pusta. Do odczytu użyj SQL Editora (zalogowany admin).

**Skróty klawiszowe w przeglądarce:** `key` z `text:"ctrl+a"` działa; `text:"a"` + `modifiers:"ctrl"`
wpisuje literę `a`. W polach formularzy Supabase `ctrl+a` bywa wpisywane dosłownie — sprawdzaj efekt.

**Duży kod wklejaj przez schowek**, nie przez wpisywanie — edytory autouzupełniają cudzysłowy
i backticki, co niszczy szablony:
```powershell
Set-Clipboard -Value (Get-Content -LiteralPath <plik> -Raw -Encoding UTF8)
```

**Historia sesji rośnie od odczytów PDF.** Jedna sesja urosła do **4,14 GB** (458 odczytów PDF),
przekraczając limit sterty Node (4288 MB) i wywalając aplikację przy starcie. Plik przeniesiony
do `C:\Claude-projekty\_archiwum-sesji\`. W tym repo jest 98 MB PDF-ów w `strona/biuletyn/` —
**nie czytaj ich masowo w jednej sesji.**

**Integracja „Database Webhooks" nie jest zainstalowana** w tym projekcie (`schema
supabase_functions does not exist`). Triggery wołają `pg_net` wprost — patrz
`backend/supabase_webhooki_maile.sql`. Nie próbuj instalować integracji; panel integracji się zawiesza.

---

## 3. Do zrobienia — w kolejności ważności

### ✅ A. Panel `/admin/` — zapisy na szkolenia — ZROBIONE
`admin/zapisy.html`: podsumowanie (zgłoszenia, uczestnicy, nieobsłużone, rozbicie na szkolenia),
filtry, modal ze szczegółami i osobnymi blokami Nabywca/Odbiorca, statusy
`new/read/confirmed/cancelled`, kopiowanie danych do faktury, dwa eksporty CSV
(uczestnicy — wiersz na osobę; dane do faktur — wiersz na zgłoszenie). Licznik
nieobsłużonych w menu bocznym wszystkich stron panelu.
**Nie testowane na żywych danych — tabela `zapisy_szkolenia` jest pusta.**

### ~~B. Nieobsłużone zgłoszenie~~ — nieaktualne
Zgłoszenie Agnieszki Horbaczewskiej to **mail testowy** (Agnieszka jest pracownicą biura).
Nie wymaga odpowiedzi.

### ⚠️ C. `send-confirmation` przyjmuje klucz publiczny — CZĘŚCIOWO
**Zrobione:** schemat `private` + tabela `gig_sekrety` z tokenem wygenerowanym w bazie
(`gen_random_bytes(32)`), trigger dokłada nagłówek `x-gig-token`
(`backend/supabase_sekret_hooka.sql`, migracja już zastosowana). W kodzie funkcji
(`backend/edge-functions/send-confirmation.ts`) jest brama z porównaniem o stałym czasie.

**Zostało — dwa kroki, w tej kolejności:**
1. **Wdrożyć funkcję** z pliku w repo. Nie przez przepisywanie — schowkiem:
   ```powershell
   Set-Clipboard -Value (Get-Content -LiteralPath 'backend\edge-functions\send-confirmation.ts' -Raw -Encoding UTF8)
   ```
   Brama jest bezczynna, dopóki sekret nie istnieje, więc wdrożenie **nie przerwie wysyłki**.
2. **Dodać sekret** `GIG_HOOK_TOKEN` w Supabase → Edge Functions → Secrets. Wartość:
   ```sql
   select wartosc from private.gig_sekrety where klucz = 'hook_token';
   ```
   Dopiero ten krok włącza ochronę. Odwrotna kolejność zablokowałaby maile.

Weryfikacja: wyślij testowe zgłoszenie i sprawdź `net._http_response` — ma być
`{"ok":true,...}`. `401` i `{"error":"brak uprawnien"}` = sekret różni się od tokenu w bazie.

### ✅ D. Sprzątanie „Poziom 3" — ZROBIONE (141 KB)
`be.css` 516→464 KB oraz inline CSS na 26 stronach (−100 KB). Usunięte reguły WooCommerce,
bbPress, Tribe Events, BuddyPress, portfolio, koszyka i wishlisty. Cięcie na **selektorach**,
nie na blokach. Dowód bezpieczeństwa: dla 360 usuniętych selektorów sprawdzono kolizję
z 1447 klasami i id używanymi w HTML — **zero kolizji**, więc żaden nie mógł niczego dopasować.

**Skorygowany szacunek:** wcześniejsze 250–350 KB było optymistyczne (liczyło reguły, a te są
krótkie). Prawdziwy ciężar to własny kod BeTheme — `mfn-*` to 22% arkusza i **jest używany**.
Więcej odzyska dopiero dokończenie migracji stron z mirrora na strony autorskie.
Nietknięte, do sprawdzenia kiedyś: CF7 bijący w nieistniejące `/wp-json/`, jQuery UI.

### ⚠️ E. Duże biuletyny PDF — PRAWIE ZROBIONE
Audyt 24 odnośników wykazał trzy usterki, dwie naprawione:
- `02_Regulamin_Pracy_Rady_GIG` — plik miał w **nazwie** dosłowne `%20`; przeglądarka
  dekodowała je na spację i szukała innego pliku. Przemianowany.
- `04_Regulamin Przedstawiciela Regionalnego` — pliku nie było w repo, odnośnik wskazywał
  na stary serwer. Odnaleziony w `dokumenty izby/`, dograny, odnośnik względny.
- **`biuletyn/Biuletyn-Informacyjny-GIG-nr-8.pdf` — PLIKU BRAK.** Nie ma go ani w repo,
  ani w katalogach na dysku. Wymaga dostarczenia przez GIG. Odnośnik jest już względny,
  więc zadziała od razu po wgraniu pliku pod tą nazwą.

Zero odnośników `http://` do starej domeny (były też niezabezpieczone na stronie po https).
23 z 24 plików PDF na miejscu.

**Pułapka z tej pracy:** przy naprawie odnośników szeroki wzorzec na `https://gig.org.pl/...`
zamienił na względne również `canonical` i `og:url`. `og:url` **musi** być bezwzględny
(wymóg Facebooka i LinkedIna). Cofnięte — podmieniaj adresy punktowo, nie regexem po domenie.

## 4. Historia zmian w tej sesji

| commit | co |
|---|---|
| `a4ea280` | newsletter: powiadomienie o zapisie na `jerzy.bryk@gmail.com` |
| `3c6c2f6` | strona `/zapisy/` + tabela `zapisy_szkolenia` + maile |
| `c891f3a` | pole odbiorcy jako „NIP / ID-wewn." |
| `182dcf1` | klawiatura alfanumeryczna dla tego pola |
| `a56202c` | **fix:** rozerwane literały regex blokowały wdrożenie funkcji |

Wcześniej w sesji: sprzątanie długu po WordPressie (usunięte duplikaty stron + 301,
deduplikacja Font Awesome, centralizacja kluczy do `gig-config.js`), naprawa terminu
szkolenia EGiB na 22.10.2026, trzy błędy w obsłudze szkoleń (`map` przekazujący indeks,
brak obsługi pola `links` na stronie głównej, CF7 kasujący podstawione pola).

---

## 5. Czego nie ma w repo, a jest potrzebne

- **Klucz `service_role`** — nigdzie na dysku, i tak ma zostać. Do operacji admina używaj
  SQL Editora w panelu Supabase (przez zalogowaną przeglądarkę).
- **Klucz Resend `re_...`** — tylko w sekretach Supabase.
- Klucz publiczny `anon` jest w `strona/_assets/js/gig-config.js` i **to jest w porządku** —
  dostępu pilnuje RLS.
