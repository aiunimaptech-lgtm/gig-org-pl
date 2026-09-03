# Wdrożenie gig.org.pl (mirror + panel) — krok po kroku

Strona jest zmirrorowana do `strona/` i gotowa do publikacji. Backend (panel + formularze)
działa po podpięciu Supabase; do tego czasu formularze działają w trybie `mailto:`.

## ✅ Co już zrobione (autonomicznie)
- Mirror 20 stron + zasoby (Elementor/BeTheme), zlokalizowane do statyki.
- Usunięty cruft WP, ustawiony canonical, `sitemap.xml` (17 URL-i), `robots.txt`, `vercel.json`.
- Panel `/admin/`: logowanie, pulpit, formularze (newsletter+kontakt), artykuły (CRUD + Quill).
- `forms_integration.js` przechwytuje formularze CF7 → Supabase (fallback `mailto: biuro@gig.org.pl`).
- Backend: `backend/supabase_setup.sql` + edge functions (`send-confirmation`, `newsletter-unsubscribe`).

## ✏️ Do uzupełnienia przed pełnym działaniem panelu
1. `strona/admin/_admin.js` → `SUPABASE_URL`, `SUPABASE_ANON`
2. `strona/_assets/js/forms_integration.js` → `SUPABASE_URL`, `SUPABASE_ANON` (te same)
3. Sekrety Resend w Supabase + konto admina (patrz niżej).

## 1) Podgląd lokalny
```bash
cd "C:\Claude-projekty\Strona www\gig.org.pl\strona"
python -m http.server 8090   →  http://localhost:8090
```

## 2) GitHub + Vercel
```bash
cd "C:\Claude-projekty\Strona www\gig.org.pl"
git add -A && git commit -m "..."   # (repo już zainicjowane)
```
- Repo: **publiczne** (plan Vercel Hobby blokuje deploy z prywatnego repo dla commitów spoza właściciela — tak jak przy robertbryk.pl).
- Vercel → New Project → import repo → **Root Directory = `strona`** → Framework: Other → Deploy.

## 3) DNS — domena gig.org.pl jest na **kei.pl** (NIE cyberfolks!)
Obecnie: `A @ → 94.152.54.167`, poczta `MX → poczta.gig.org.pl`.

W panelu **kei.pl** (zarządzanie DNS domeny gig.org.pl) ustaw:

| Nazwa | Typ | Wartość |
|-------|-----|---------|
| `@`   | A   | `216.198.79.1` (IP poda Vercel po dodaniu domeny — użyj tego, które pokaże) |
| `www` | CNAME | wartość z Vercel (np. `xxxx.vercel-dns-017.com`) |

> ⚠️ Najpierw dodaj `gig.org.pl` + `www.gig.org.pl` w Vercel (Settings → Domains) i odczytaj **dokładne** rekordy, które Vercel pokaże — wstaw je 1:1 w kei.pl.
> 🔴 **NIE RUSZAJ poczty:** `MX (poczta.gig.org.pl)`, SPF (TXT `v=spf1`), DKIM (`*._domainkey`), DMARC (`_dmarc`), subdomena `poczta`.
> Zmieniasz tylko `@` (A) i `www` (CNAME).

## 4) Supabase (panel + zapis formularzy)
1. supabase.com → New project. Zapisz **Project URL** + klucz **anon** (`sb_publishable_...`).
2. SQL Editor → wklej `backend/supabase_setup.sql` → Run (tworzy `submissions_newsletter`, `submissions_kontakt`, `articles` + RLS).
3. Wpisz `SUPABASE_URL`/`SUPABASE_ANON` w `admin/_admin.js` ORAZ `_assets/js/forms_integration.js`.
4. Authentication → Users → Add user (e-mail admina + hasło). Wyłącz publiczną rejestrację.
5. Panel: `https://gig.org.pl/admin/` → zaloguj.

## 5) Resend (maile potwierdzające + wypis)
1. resend.com → klucz `re_...`. Domains → dodaj `gig.org.pl` → wpisz wskazane TXT (SPF/DKIM) **w kei.pl** (nie ruszając poczty głównej). Poczekaj na Verified.
2. Supabase → **Edge Functions → Secrets** (to NIE jest strona *API Keys*) — dodaj cztery:
   - `RESEND_API_KEY` — klucz `re_...` z Resend (jedyny prawdziwy sekret)
   - `FROM_EMAIL="Geodezyjna Izba Gospodarcza <biuro@gig.org.pl>"`
   - `NOTIFY_EMAILS="biuro@gig.org.pl,jerzy.bryk@gmail.com"` — adresy powiadomień o nowych
     zgłoszeniach z formularza (zmiana odbiorcy = zmiana sekretu, bez ponownego wdrożenia)
   - `NOTIFY_NEWSLETTER_EMAILS="jerzy.bryk@gmail.com"` — osobna lista dla powiadomień
     o nowych zapisach do newslettera (domyślnie ten adres, więc sekret jest opcjonalny)
   - `SITE_URL="https://gig.org.pl"`

   > `SUPABASE_URL`, `SUPABASE_ANON_KEY` i `SUPABASE_SERVICE_ROLE_KEY` Supabase wstrzykuje
   > do Edge Functions automatycznie — NIE ustawiaj ich ręcznie.
3. Wgraj funkcje: `supabase functions deploy send-confirmation` oraz `supabase functions deploy newsletter-unsubscribe` (Verify JWT = OFF dla unsubscribe).
4. Database → Webhooks → Create: tabela `submissions_newsletter` (INSERT) → `send-confirmation`; osobno `submissions_kontakt` (INSERT) → `send-confirmation`.

## 6) Do dokończenia (świadome braki)
- **Duże biuletyny PDF (>25 MB)** — pominięte; ich linki są absolutne (`gig.org.pl/biuletyn/...`). Po migracji DNS dograj je do `strona/biuletyn/` (lub Supabase Storage), żeby działały.
- **Publiczne wyświetlanie artykułów z panelu** — `articles` jest gotowe; trzeba dodać client-side render na stronach Aktualności/Artykuły (fetch z Supabase, klucz anon).
- Mirror to snapshot z dnia migracji.

## Struktura
```
gig.org.pl/
├── CLAUDE.md, README-WDROZENIE.md, .gitignore
├── strona/        ← DEPLOY (mirror + /admin/ + sitemap/robots/vercel.json)
├── backend/       ← supabase_setup.sql + edge-functions (NIE deployowane)
└── skrypty/       ← crawl.py / clean.py / gen_sitemap.py (NIE deployowane)
```
