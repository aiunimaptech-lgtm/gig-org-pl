# Przekazanie sesji — gig.org.pl

**Stan na:** 3 września 2026 · ostatni commit `a56202c` · wszystko wypchnięte na `origin/main`
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

### A. Panel `/admin/` nie pokazuje zapisów na szkolenia ⚠️
Tabela `zapisy_szkolenia` nie ma widoku w panelu. Powiadomienia mailowe działają, więc nic nie
ginie, ale nie ma gdzie zobaczyć listy, oznaczyć obsłużonych ani wyeksportować uczestników do
faktur. Wzór do naśladowania: `strona/admin/formularze.html` (czyta `submissions_*`, liczniki
nieprzeczytanych w `_admin.js`). Statusy w tabeli: `new / read / confirmed / cancelled`.

### B. Nieobsłużone zgłoszenie
`submissions_kontakt`, 2 września 10:28 — **Agnieszka Horbaczewska**, zapis na szkolenie Hanusa,
status `new`. Sprzed uruchomienia powiadomień, więc nikt o nim nie wiedział. Wymaga odpowiedzi.

### C. `send-confirmation` przyjmuje klucz publiczny
Funkcja akceptuje wywołania z kluczem `anon`, który jest jawny w `gig-config.js`. Ktoś może ją
wywołać ręcznie i wysłać mail na dowolny adres oraz zaspamować skrzynki GIG. Zamknięcie:
wspólny sekret sprawdzany w nagłówku (kilkanaście linijek + jeden sekret).

### D. Sprzątanie „Poziom 3" (odłożone świadomie)
- `be.css` — 512 KB, w tym 79 reguł WooCommerce, 21 bbPress, 16 Tribe Events, 11 BuddyPress
  dla wtyczek, których nie ma. ~250–350 KB do odzyskania, ale wymaga testów strona po stronie.
- CF7 wskazuje na nieistniejące `/wp-json/` — skrypt może bić w 404.
- jQuery UI (`core`, `tabs`) — sprawdzić, czy w ogóle używane.

### E. Duże biuletyny PDF (>25 MB)
Pominięte przy mirrorze, linki zostały absolutne. Do dograna do `strona/biuletyn/` albo do
Supabase Storage.

---

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
