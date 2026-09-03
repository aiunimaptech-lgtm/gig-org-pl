# Projekt: gig.org.pl — migracja WordPress → statyka + panel

> 📌 **Stan bieżący, pułapki i lista zadań: [`HANDOVER.md`](HANDOVER.md)** — czytaj przy przejęciu projektu.

## Cel
Migracja strony **Geodezyjnej Izby Gospodarczej** (gig.org.pl) z WordPressa na **statykę
hostowaną na Vercel**, z panelem administracyjnym `/admin/` (Supabase + Resend) do obsługi
newslettera, formularza kontaktowego i artykułów (aktualności/biuletyn).

## Architektura
- **Frontend**: statyczny mirror WP (Elementor/BeTheme), katalog deployowany: `strona/`.
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions), maile przez Resend.
- **Panel**: `/admin/` — login, pulpit, formularze (newsletter+kontakt), artykuły (CRUD, edytor Quill).
- Formularze CF7 przechwytywane przez `_assets/js/forms_integration.js` → Supabase (fallback `mailto:`).
- **Zapisy na szkolenia**: osobna strona `/zapisy/` (ręczna, nie mirror) → tabela `zapisy_szkolenia`.
  Zbiera uczestników i dane do faktury (nabywca + odbiorca, znacznik JST). Przycisk „Zapisz się”
  w kalendarzu prowadzi tam z `?szkolenie=<tytuł>`.
- **Maile**: każdy wpis do `submissions_kontakt` / `submissions_newsletter` / `zapisy_szkolenia`
  wyzwala trigger `pg_net` → Edge Function `send-confirmation` → Resend. Idą dwa maile:
  powiadomienie do GIG (`Reply-To` = zgłaszający) i potwierdzenie do zgłaszającego.
  Definicje triggerów: `backend/supabase_webhooki_maile.sql`, `backend/supabase_zapisy.sql`.

## Jak powstał mirror (skrypty w `skrypty/`, POZA deployem)
1. `crawl.py` — pobrał strony + zasoby, zlokalizował URL-e (root-relative), zachował strukturę.
2. `clean.py` — usunął cruft WP (emoji, oEmbed, REST, generator), ustawił canonical, wstrzyknął `forms_integration.js`.
3. `gen_sitemap.py` — wygenerował `strona/sitemap.xml` (pomija /admin/ i strony demo).
Skrypty są **idempotentne** — można powtórzyć (np. po aktualizacji treści w WP przed ostatecznym odcięciem).

## Dane GIG (z mirrora)
- Geodezyjna Izba Gospodarcza, ul. Czackiego 3/5, 00-043 Warszawa
- tel. 22 827 38 43 · biuro@gig.org.pl · NIP 525-20-34-024 · REGON 010753536
- Menu: O nas / Baza wiedzy (Aktualności, Artykuły, Biuletyn) / Szkolenia / Dołącz do nas / Kontakt

## ⚠️ Konfiguracja Supabase
- **Jedno miejsce na klucze**: `strona/_assets/js/gig-config.js` (`window.GIG_CFG`).
  Plik wpięty bez `defer` przed wszystkimi skryptami GIG, na 31 stronach + w panelu.
  Po rotacji klucza `anon` zmieniasz tylko ten plik — reszta czyta z `GIG_CFG`.
- Sekrety Resend w Supabase (Edge Functions): `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Konto admina: Supabase → Authentication → Users → Add user (np. biuro@gig.org.pl)

## Żelazne zasady
- Front używa wyłącznie klucza `sb_publishable_` (anon), i to z `gig-config.js` — nie
  wklejaj kluczy do kolejnych plików. `service_role`/`re_...` tylko w sekretach Supabase.
- Katalog `skrypty/` i `backend/` NIE są deployowane (Root Directory na Vercel = `strona/`).
- Canonical i domena: **gig.org.pl bez www** (www → 301 na apex w `vercel.json`).

## Zależność od Supabase (ważne przy diagnozie awarii)
Jeden projekt Supabase (`zlepwzeyjwpmhyxfnime`) obsługuje: katalog **Członkowie**, kalendarz
**Szkoleń**, formularze + newsletter oraz panel `/admin/`. Gdy projekt zostanie **uśpiony**
(darmowy plan usypia po ~7 dniach bezczynności), jego host **przestaje się rozwiązywać w DNS
(NXDOMAIN)** — w przeglądarce widać `Failed to fetch`, a nie błąd HTTP. Szybki test:
`nslookup zlepwzeyjwpmhyxfnime.supabase.co` → „Non-existent domain" = projekt uśpiony/skasowany.
Naprawa: Supabase Dashboard → *Restore project* (dane po uśpieniu są zachowane).

- **Katalog Członkowie ma zabezpieczenie offline**: gdy baza nie odpowiada, `/czlonkowie/`
  renderuje statyczną kopię `strona/_assets/js/czlonkowie-fallback.js` (65 firm) — strona działa
  mimo awarii. Kopia to *snapshot*, więc po zmianach członków w panelu odśwież ją i zacommituj:
  `node skrypty/gen_czlonkowie_fallback.js --from-supabase`
  (bez flagi generuje z `skrypty/_czlonkowie.json`). Pola www/social/opis/współrzędne/NIP
  dokłada `czlonkowie-enrich.js`, więc fallback trzyma tylko dane podstawowe.

## Znane do dokończenia
- **Duże biuletyny PDF (>25 MB)** — pominięte przy mirrorze, linki zostały absolutne (`gig.org.pl/biuletyn/...`).
  Po migracji domeny trzeba je dograć ręcznie do `strona/biuletyn/` albo wrzucić do Supabase Storage.
- **Panel `/admin/` nie ma widoku zapisów na szkolenia** (`zapisy_szkolenia`) — powiadomienia
  mailowe działają, ale nie ma listy ani eksportu uczestników. Wzór: `strona/admin/formularze.html`.
- Mirror to snapshot — dynamiczne listy WP są „zamrożone".
