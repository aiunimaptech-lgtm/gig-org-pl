# Przekazanie sesji — gig.org.pl

**Stan na:** 4 września 2026 (sesja 2) · ostatni commit `67706fb` · wszystko wypchnięte na `origin/main`
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

### Panel `/admin/` — szkolenia i zapisy (stan po sesji 2)
Jedno konto administratora: `biuro@gig.org.pl` (Supabase → Authentication → Users).
Widoki związane ze szkoleniami: **Pulpit** (karta „Zapisów na szkolenia" + zapisy w „Ostatnich
zgłoszeniach"), **Szkolenia** (CRUD + kolumna „Zgłoszeń" z linkiem do przefiltrowanych zapisów),
**Zapisy na szkolenia** (`zapisy.html` — podsumowanie, filtry, modal, statusy, dwa eksporty CSV;
otwarcie szczegółów zdejmuje status „nowe"). Zgłoszenia łączą się ze szkoleniem **po tytule**
(tekst z `?szkolenie=`), nie po kluczu — zmiana tytułu szkolenia w panelu „odłącza" wcześniejsze
zgłoszenia (porównanie ignoruje wielkość liter i spacje na końcach, ale nie więcej).

**Skąd „puste" zapisy:** do 3 września przycisk „Zapisz się" prowadził na formularz kontaktowy,
więc 4 zgłoszenia z 2–3.09 (wszystkie testowe: Agnieszka H. z biura i J. Bryk) siedzą w
`submissions_kontakt` z tematem „Zapis na szkolenie: …" — widać je w zakładce **Kontakt**, nie
w Zapisach. Od 3.09 nowe zgłoszenia idą do `zapisy_szkolenia`.

Formularz na `/szkolenia/`, który wygląda jak zapis, to **newsletter w stopce** (przycisk „Zapisz
się" jest na każdej stronie). Zapis na szkolenie to „Zapisz się →" na kafelku → `/zapisy/`.

### Baza e-mail (`admin/baza-email.html`, tabela `baza_email`)
3791 adresów z listy MailerLite wzbogaconych researchem (plik `dane_firm_z_maili_GIG.xlsx`
z 4.09.2026 — **nie ma go w repo, repo jest publiczne; dane żyją tylko w bazie**). Filtry
**wielokrotnego wyboru** (checkbox-dropdown, komponent `multiSelect` w kodzie strony): Pochodzenie /
Grupa / Rodzaj-branża — można zaznaczyć dowolną kombinację wartości (np. MailerLite + prospecting),
z licznikami; do tego filtr statusu, „dane firmy", „edycja", szukanie i przycisk „Wyczyść filtry".
Kafelki nad tabelą ustawiają filtr grupy. Bieżący, złożony filtr jest zarazem listą do wysyłki
(przycisk „Wyślij e-mail", limit 200 — masówki w MailerLite) i do eksportu CSV. Słowniki `GRUPY`,
`RODZAJE`, `POCHODZENIA` (z „prospecting") tylko dla formularza edycji; filtry biorą wartości z danych.
**Ponowny import / aktualizacja:** uruchom `backend/supabase_baza_email.sql` (wstawi nowy
`import_token`), odczytaj token zapytaniem z końca pliku, potem
`GIG_IMPORT_TOKEN=<token> python skrypty/import_baza_email.py <plik.xlsx>` — upsert po e-mailu,
puste pola nie nadpisują. Token kasuje się po imporcie (skrypt nie — zrób to zapytaniem z pliku SQL,
jeśli import przerwano).

**Do 3 adresów na firmę:** `baza_email` ma `email` (główny, unikalny — klucz dopasowania importu)
plus `email2`, `email3` (opcjonalne). Panel: trzy pola w edycji, dodatkowe adresy widać w tabeli pod
głównym („+ …"), wyszukiwarka i CSV je obejmują, a **wysyłka rozwija każdą firmę na wszystkie jej
adresy** (ten sam `id`, więc wypis dotyczy całej firmy). Import (RPC + `skrypty/import_baza_email.py`)
czyta też kolumny „E-mail 2"/„E-mail 3", jeśli plik je ma.

**Ochrona ręcznych zmian przy imporcie (kolumny `edytowany_panel`, `usuniety_panel`):** każdy
zapis w panelu ustawia `edytowany_panel`, a „Usuń" robi **miękkie usunięcie** (`usuniety_panel`,
wiersz-nagrobek ukryty w panelu). Import (`gig_baza_email_import`) **pomija** wiersze z którymkolwiek
z tych znaczników — dzięki temu ręczne poprawki nie są nadpisywane, a usunięte adresy nie wracają.
Rekordy spoza MailerLite dostały `edytowany_panel` przy migracji. W panelu: tag „✎ panel" przy
chronionych, filtr „Edycja", kolumna w CSV. Zweryfikowane na żywej bazie (edytowany/nagrobek pominięte,
nowy adres wchodzi).

### Sekrety w Supabase (Edge Functions → Secrets)
`RESEND_API_KEY`, `FROM_EMAIL`, `NOTIFY_EMAILS`, `NOTIFY_NEWSLETTER_EMAILS`, `SITE_URL`.
`SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` Supabase wstrzykuje **automatycznie** — nie ustawiać.

### DNS / Resend
Domena `gig.org.pl` zweryfikowana w Resend przez **subdomenę** `send.gig.org.pl` (SPF + MX zwrotek)
oraz DKIM `resend._domainkey`. Poczta firmowa (MX `poczta.gig.org.pl`) i SPF domeny głównej
(zawiera MailerLite `_spf.mlsend.com`) **nietknięte** — i tak ma zostać.

---

## 2. Pułapki — przeczytaj, zanim stracisz na nie godzinę

**Jest konektor MCP do Supabase w Claude Code** (projekt `zlepwzeyjwpmhyxfnime`): `execute_sql`,
`list_tables`, `get_edge_function`, `deploy_edge_function`, `apply_migration`. Zapytania SQL,
podgląd wdrożonego kodu funkcji i wdrożenie nowej wersji idą **bez panelu Supabase i bez schowka**
— większość pułapek poniżej dotyczy pracy przez dashboard. Konektor nie zmienia ustawień Auth
(np. rejestracji kont) — to nadal tylko dashboard.

**Vercel Checkpoint łapie też `curl` po kilku zapytaniach.** Odpowiedź ma nagłówek
`X-Vercel-Mitigated: challenge` i treść strony-wyzwania, więc `grep -c` zwraca 0 i wygląda to jak
brak wdrożenia. Sprawdzaj nagłówki (`curl -D -`) i stan wdrożenia konektorem Vercel
(`list_deployments`, projekt `prj_S8elWsI7MkgSH2cK35yFZfCdXv88`, team `team_SVIUxNaDzlEbBHcHVxBpGFGa`)
zamiast pętli odpytującej produkcję.

**Panel przeglądarki: zrzuty ekranu bywają time-outem, JS działa.** Przy testach panelu
`computer.screenshot` potrafił przekraczać 5 s, gdy JS i `read_page` działały normalnie.
Weryfikuj stan strony przez `javascript_tool` (odczyt DOM), zrzut rób na końcu i z `scale`.

**Testy panelu bez logowania:** atrapa `supabase-js` (plik `_mock_supabase.js` podstawiony
w miejsce skryptu CDN, `from().select/eq/neq/order/limit/update` + `auth.getSession`) pozwala
obejrzeć każdy widok na danych testowych bez konta i bez dotykania bazy. Tak przetestowano
`zapisy.html`, `dashboard.html`, `szkolenia.html`. Atrapa była w scratchpadzie sesji — jeśli
będzie potrzebna ponownie, odtworzenie to ~80 linii.

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

### 🔴 F. Bezpieczeństwo: każdy może założyć konto admina — DO ZAMKNIĘCIA NATYCHMIAST
`GET /auth/v1/settings` zwraca `disable_signup: false` przy włączonym logowaniu e-mailem, a wszystkie
polityki RLS (`submissions_*`, `zapisy_szkolenia`, `szkolenia`, `czlonkowie`, `articles`) dają
pełny dostęp warunkiem `auth.role() = 'authenticated'`. Klucz publiczny jest w źródle strony, więc
każdy może wywołać `/auth/v1/signup`, potwierdzić własny e-mail i **czytać oraz edytować wszystko**.

1. **Dashboard Supabase → Authentication → Sign In / Providers → Email → wyłącz „Allow new users
   to sign up"** (tego nie da się zrobić konektorem MCP).
2. Druga warstwa (opcjonalnie, przez `apply_migration`): w politykach zastąpić
   `auth.role() = 'authenticated'` warunkiem na listę adresów, np.
   `(auth.jwt() ->> 'email') in ('biuro@gig.org.pl')`. Uwaga: pomyłka w adresie zablokuje panel —
   sprawdź logowanie zaraz po migracji.

### ✅ A. Panel `/admin/` — zapisy na szkolenia — ZROBIONE i rozszerzone (sesja 2)
`admin/zapisy.html` + pulpit + kolumna „Zgłoszeń" na liście szkoleń (szczegóły w sekcji 1).
Przetestowane na atrapie danych (7 zgłoszeń, wszystkie statusy, odbiorca ≠ nabywca, wstrzyknięty
HTML w polach): podsumowania, filtry, modal, zmiana statusu, oba CSV, escapowanie — bez błędów.
**Nadal nie testowane na żywych danych — `zapisy_szkolenia` wciąż pusta.** Test bez maili:
`ALTER TABLE zapisy_szkolenia DISABLE TRIGGER on_zapis_insert; INSERT …; ALTER TABLE … ENABLE
TRIGGER on_zapis_insert;` w jednej transakcji (inaczej trigger wyśle maile do biura).

### ~~B. Nieobsłużone zgłoszenie~~ — nieaktualne
Zgłoszenie Agnieszki Horbaczewskiej to **mail testowy** (Agnieszka jest pracownicą biura).
Nie wymaga odpowiedzi.

### ⚠️ C. `send-confirmation` przyjmuje klucz publiczny — CZĘŚCIOWO
**Zrobione:** schemat `private` + tabela `gig_sekrety` z tokenem wygenerowanym w bazie
(`gen_random_bytes(32)`), trigger dokłada nagłówek `x-gig-token`
(`backend/supabase_sekret_hooka.sql`, migracja już zastosowana). W kodzie funkcji
(`backend/edge-functions/send-confirmation.ts`) jest brama z porównaniem o stałym czasie.

**Krok 1 ZROBIONY (4.09, sesja 2):** funkcja z repo wdrożona przez MCP jako **wersja 4** (brama
+ czerwona paleta). Brama jest bezczynna, dopóki sekret nie istnieje — maile chodzą jak dotąd.
Zapasowa droga wdrożenia (schowkiem) nadal działa:
   ```powershell
   Set-Clipboard -Value (Get-Content -LiteralPath 'backend\edge-functions\send-confirmation.ts' -Raw -Encoding UTF8)
   ```

**Został krok 2:** **dodać sekret** `GIG_HOOK_TOKEN` w Supabase → Edge Functions → Secrets. Wartość:
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

## 4. Historia zmian

### Sesja 2 (4 września 2026)

| commit | co |
|---|---|
| `67706fb` | panel: zapisy na pulpicie, kolumna „Zgłoszeń" na liście szkoleń, filtr z `?szkolenie=`, auto-„przeczytane" |
| `4cb90a5` | logowanie: „Nie pamiętasz hasła?" (mail z linkiem) + `nowe-haslo.html`; wymaga Redirect URL w Supabase Auth |
| `ce798c7` | `pierwsze-haslo.html?token=…` + Edge Function `pierwsze-haslo` + `backend/supabase_pierwsze_haslo.sql` — hasło bez maila, token jednorazowy |
| `513bb43` | kreator e-maili do uczestników (Edge Function `wyslij-mail`, Resend, tylko z sesją admina), paleta czerwona GIG, ikona 🎓 |
| `a21d784` | kreator wspólny w `_admin.js` (`gigKreatorMaila`), „Odpowiedz" do jednej osoby w zapisach i kontakcie (status `replied`), liczniki znikają po wejściu do zakładki, siatka kafelków, checkbox RODO w kalendarzu `/szkolenia/`, maile w czerwieni (`send-confirmation` v4 z bramą, `wyslij-mail` v2) |

| `7f64ee2` | linki Newsletter/Kontakt w menu przełączają zakładkę (hashchange) |
| `3fcd9f2` | zakładka **Baza e-mail**: tabela `baza_email`, import 3791 adresów przez RPC z tokenem, filtry/edycja/CSV/mail; `wyslij-mail` v3 (stopka `baza`) |

**Kreator e-maili:** `gigKreatorMaila({odbiorcy, temat, rodzaj, szkolenie, opis, cytat, poWyslaniu})` w `_admin.js`;
strona musi ładować Quill. Backend `wyslij-mail` (v4) sprawdza sesję admina (`auth.getUser`), wysyła osobno
do każdego adresu, stopka wg `rodzaj` (`szkolenie` / `kontakt` / `baza`). Limit 200 adresów.
**Szata maila:** jasna, z logo `strona/_assets/img/gig-logo-email.png` (PNG, bo SVG nie renderuje się
w mailach — wyrenderowane sharpem z `gig-logo-new-poziom-dark.svg`) i czerwoną kreską zamiast ciemnego pasa.
`send-confirmation` ma jeszcze starszą (ciemną) szatę — do ujednolicenia kiedyś.

### Kampanie mailowe (`admin/wysylki.html`, tabele `wysylki` + `wysylki_odbiorcy`)
Do wysyłek masowych (tysiące adresów), bo `wyslij-mail` ma limit 200 i wysyła po jednym.
Kampanię tworzy się w **Bazie e-mail** → ustaw filtr → **„📣 Kampania z filtra"** → temat + treść.
Powstaje kampania i **kolejka** (jeden wiersz na adres, `UNIQUE(wysylka_id,email)`).
Wysyłka: zakładka **Wysyłki** → „▶ Wyślij" — panel woła Edge Function `wyslij-kampanie`
w pętli; każde wywołanie bierze porcję (300), wysyła **batchem Resend po 100** i zapisuje status.
Przerwanie niczego nie psuje — wznawia od miejsca przerwania, bez dubletów.
**`limit_dzienny` (domyślnie 200) = rozgrzewka domeny** — funkcja nigdy nie wyśle dziś więcej.
Nowa domena: 200 → 500 → 1000 → 2000 co kilka dni; nagły strzał tysięcy maili z „zimnej" domeny
to spam-filtr **i popsute maile transakcyjne** (idą z tej samej domeny). Schemat i przydatne
zapytania (np. ponowna próba dla błędów): `backend/supabase_wysylki.sql`.
**Wymaga Resend Pro** ($20/mies., 50 tys./mies., bez dziennego limitu) — na Free (100/dobę)
kampania do 3,8 tys. adresów szłaby ponad miesiąc.

**Rezygnacja z maili (unsubscribe):** wysyłki `rodzaj:'baza'` dostają w stopce link „Wypisz się" →
Edge Function `baza-wypis?id=<uuid wiersza>` (verify_jwt=false), która ustawia `status='unsubscribed'`
i pokazuje stronę potwierdzenia. `id` bierze się z `baza_email` (panel przekazuje je w `recipients`).
Wypisani wypadają z wysyłek (filtr `status==='active'`); w panelu widać ich filtrem **Status → wypisane**
i po przekreślonym badge'u. Import nie rusza `status`, więc wypis jest trwały. Sprawdzone end-to-end.

Konta: użytkownik ustawił hasło przez `pierwsze-haslo` i jest zalogowany. Token setup zużyty —
nowy: ponownie `backend/supabase_pierwsze_haslo.sql` (insert) i zapytanie z końca pliku.
Edge Functions w projekcie: `send-confirmation` (v3, bez bramy), `newsletter-unsubscribe`,
`pierwsze-haslo`, `wyslij-mail` — dwie ostatnie z `verify_jwt=false` (autoryzacja w kodzie).

Poza kodem: audyt stanu (produkcja = repo, formularz `/zapisy/` i panel działają, tabela pusta),
odkrycie otwartej rejestracji kont (punkt F), porównanie wdrożonej funkcji z repo (punkt C).

### Sesja 1

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
