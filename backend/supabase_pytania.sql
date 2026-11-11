-- ============================================================
-- GIG: „Zapytaj Izbę” (Geodezja pyta, Izba odpowiada), 11.11.2026
--
-- Dwie tabele, celowo rozdzielone:
--   pytania  kolejka zgłoszeń z danymi osobowymi pytających. Dostęp WYŁĄCZNIE z panelu
--            (/admin/pytania.html, sesja po kodzie z maila) i z Edge Function `pytanie-zglos`
--            (service_role). Rola anon nie ma tu żadnych praw.
--   opinie   teksty publikowane na stronie (odpowiedź, opracowanie, stanowisko Izby), bez danych
--            osobowych pytających. Panel ma pełny dostęp, strona czyta kluczem publicznym tylko
--            wiersze ze status = 'opublikowana' (/pytania/, /pytania/<slug>/, /stanowiska/).
--
-- Skąd biorą się pytania:
--   formularz  /pytania/zadaj/ -> Edge Function `pytanie-zglos` (walidacja, pułapka na roboty,
--              limity, rozpoznanie członka, maile). Strona NIE pisze do tabeli bezpośrednio.
--              Aktualne limity, trigger trg_pytania_limit i kosz zablokowanych zgłoszeń:
--              backend/supabase_pytania_kosz.sql.
--   szkolenie  pytania z uwag zgłoszeń na szkolenia i ze spotkań (np. Forum GIG z GGK), wybierane
--              ręcznie w panelu; zapis_id wiąże wiersz ze zgłoszeniem (najwyżej jedno pytanie
--              na zgłoszenie), zrodlo_opis trzyma tytuł wydarzenia.
--   mail, inne dopisywane ręcznie w panelu.
--
-- Członek Izby (pierwszeństwo i odpowiedź indywidualna): NIP członków jest publiczny w katalogu,
-- więc sam NIP nie wystarcza. czlonek_potwierdzony = true tylko przy zgodnym adresie e-mail
-- albo przy zgodnym NIP-ie i firmowej domenie adresu; sam NIP daje czlonek_gig = true,
-- czlonek_potwierdzony = false, czlonek_sposob = 'nip (do potwierdzenia)'. Liczy to funkcja
-- `pytanie-zglos`, biuro może poprawić w panelu.
--
-- Numer zgłoszenia: 'P/RRRR/NNNN' z sekwencji pytania_numer_seq (rok wg czasu polskiego,
-- numeracja ciągła; sekwencja nie zeruje się sama z nowym rokiem, patrz PRZYDATNE na końcu).
--
-- updated_at: projekt nie ma triggerów „updated_at”, panel wpisuje tę kolumnę sam przy każdej
-- zmianie (tak jak w articles, czlonkowie, konsultacje).
--
-- Uruchom w: Supabase -> SQL Editor -> Run. Idempotentne. Zastosowane na żywym projekcie 11.11.2026.
-- ============================================================

-- ── 1. opinie: teksty publikowane ───────────────────────────────────────────
create table if not exists public.opinie (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  slug              text not null unique,            -- adres /pytania/<slug>/
  rodzaj            text not null default 'odpowiedz'
                    check (rodzaj in ('odpowiedz', 'opracowanie', 'stanowisko')),
  tytul             text not null,
  pytanie_publiczne text,                            -- pytanie zredagowane przez biuro, zwykły tekst
  pytajacy          text,                            -- np. 'pracownik administracji' albo podpis wybrany przez pytającego
  zrodlo            text,                            -- np. 'z Forum GIG z GGK 19.11.2026', 'z formularza'
  wydarzenie        text,                            -- nazwa wydarzenia do filtra; null, gdy z formularza
  temat             text,                            -- jedna z pozycji TEMATY (pytania-slownik.js)
  w_skrocie         text,                            -- 2-3 zdania, zwykły tekst
  tresc_html        text,                            -- odpowiedź, HTML z edytora panelu (jak articles.content)
  podstawa_prawna   text,                            -- zwykły tekst, jedna pozycja w linii
  autor             text,                            -- podpis z funkcją; puste = „Zespół Ekspercki GIG”
  autor_gosc        boolean not null default false,
  stan_prawny_na    date,
  status            text not null default 'szkic'
                    check (status in ('szkic', 'opublikowana', 'archiwalna')),
  opublikowano_at   timestamptz,
  constraint opinie_slug_format check (slug ~ '^[a-z0-9-]+$'),
  -- /pytania/zadaj/ i /pytania/odpowiedz/ to prawdziwe katalogi strony; wpis o takim slugu
  -- byłby przez nie zasłonięty.
  constraint opinie_slug_zarezerwowany check (slug not in ('zadaj', 'odpowiedz'))
);
comment on table public.opinie is
  'Zapytaj Izbę: teksty publikowane (odpowiedzi, opracowania, stanowiska). Bez danych osobowych pytających. Anon czyta tylko status = opublikowana.';

-- opinie.slug ma indeks z ograniczenia unique (opinie_slug_key).
create index if not exists opinie_status_idx on public.opinie(status, opublikowano_at desc);

-- ── 2. pytania: kolejka zgłoszeń (dane osobowe) ─────────────────────────────
create sequence if not exists public.pytania_numer_seq as bigint start with 1;

create table if not exists public.pytania (
  id                   uuid primary key default gen_random_uuid(),
  -- 'FM9999990000' = co najmniej cztery cyfry z zerami wiodącymi, powyżej 9999 bez obcinania
  numer                text not null unique
                       default ('P/' || to_char((now() at time zone 'Europe/Warsaw'), 'YYYY') || '/'
                                || to_char(nextval('public.pytania_numer_seq'), 'FM9999990000')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  zrodlo               text not null default 'formularz'
                       check (zrodlo in ('formularz', 'szkolenie', 'mail', 'inne')),
  zrodlo_opis          text,                         -- np. tytuł szkolenia albo spotkania
  zapis_id             uuid references public.zapisy_szkolenia(id) on delete set null,
  rodzaj               text not null default 'pytanie'
                       check (rodzaj in ('pytanie', 'problem', 'postulat')),
  temat                text,
  rola                 text,
  wojewodztwo          text,
  tresc                text not null,
  imie                 text,
  email                text,
  organizacja          text,
  nip                  text,                         -- same cyfry
  podpis_zakres        text not null default 'anonim'
                       check (podpis_zakres in ('anonim', 'osoba', 'organizacja', 'oba')),
  podpis_osoba         text,
  podpis_organizacja   text,
  tylko_dla_mnie       boolean not null default false,  -- tylko członkowie: odpowiedź bez publikacji
  nie_ujawniac         boolean not null default false,
  czlonek_gig          boolean not null default false,
  czlonek_id           uuid references public.czlonkowie(id) on delete set null,
  czlonek_sposob       text,                         -- 'e-mail', 'nip + e-mail', 'nip + domena e-mail', 'nip (do potwierdzenia)'
  czlonek_potwierdzony boolean not null default false,
  status               text not null default 'nowe'
                       check (status in ('nowe', 'w_opracowaniu', 'odpowiedziano', 'zamkniete')),
  notatka              text,                         -- notatka biura
  opinia_id            uuid references public.opinie(id) on delete set null,
  zgoda_at             timestamptz,
  ip                   text
);
comment on table public.pytania is
  'Zapytaj Izbę: kolejka pytań z danymi osobowymi. Tylko panel (sesja 2FA) i Edge Function pytanie-zglos (service_role).';

alter sequence public.pytania_numer_seq owned by public.pytania.numer;

create unique index if not exists pytania_zapis_uq    on public.pytania(zapis_id) where zapis_id is not null;
create index        if not exists pytania_status_idx  on public.pytania(status);
create index        if not exists pytania_created_idx on public.pytania(created_at desc);
create index        if not exists pytania_email_idx   on public.pytania(email, created_at);   -- limit dobowy na e-mail
create index        if not exists pytania_ip_idx      on public.pytania(ip, created_at);      -- limit dobowy na IP
create index        if not exists pytania_opinia_idx  on public.pytania(opinia_id)  where opinia_id  is not null;
create index        if not exists pytania_czlonek_idx on public.pytania(czlonek_id) where czlonek_id is not null;

-- ── 3. RLS i uprawnienia ────────────────────────────────────────────────────
-- Panel: ten sam warunek co reszta tabel panelu (JWT + sesja po kodzie z maila).
alter table public.opinie  enable row level security;
alter table public.pytania enable row level security;

drop policy if exists "opi admin all" on public.opinie;
create policy "opi admin all" on public.opinie for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- Strona publiczna: tylko opublikowane (szkice i archiwalne są niewidoczne).
drop policy if exists "opi public read" on public.opinie;
create policy "opi public read" on public.opinie for select
  using (status = 'opublikowana');

drop policy if exists "pyt admin all" on public.pytania;
create policy "pyt admin all" on public.pytania for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- Uprawnienia tabel: anon nic w pytania, w opinie sam SELECT (RLS zawęża do opublikowanych).
revoke all on public.pytania from anon, authenticated;
grant select, insert, update, delete on public.pytania to authenticated;
grant all on public.pytania to service_role;

revoke all on public.opinie from anon, authenticated;
grant select on public.opinie to anon;
grant select, insert, update, delete on public.opinie to authenticated;
grant all on public.opinie to service_role;

-- Sekwencja numerów: panel dopisuje pytania ze szkoleń, więc authenticated musi móc pobrać numer.
revoke all on sequence public.pytania_numer_seq from anon, authenticated;
grant usage on sequence public.pytania_numer_seq to authenticated;
grant usage, select on sequence public.pytania_numer_seq to service_role;

-- PostgREST: odśwież pamięć schematu, żeby nowe tabele były od razu widoczne w REST.
notify pgrst, 'reload schema';

-- ── PRZYDATNE ───────────────────────────────────────────────────────────────
-- Kolejka: select numer, created_at, zrodlo, rola, czlonek_gig, czlonek_potwierdzony, status
--            from pytania order by created_at desc;
-- Numeracja od 0001 w nowym roku (opcjonalnie, w styczniu, zanim przyjdzie pierwsze pytanie):
--   alter sequence public.pytania_numer_seq restart with 1;
-- Opublikowane: select slug, rodzaj, tytul, opublikowano_at from opinie
--                 where status = 'opublikowana' order by opublikowano_at desc;
