-- ============================================================
-- GIG: zapytania o wycenę z kalkulatora /ile-kosztuje-geodezja/ (15.10.2026)
-- Klient wybiera usługę i województwo, zaznacza firmy członkowskie z regionu i wysyła
-- jedno zapytanie. Zapis i wysyłka idą WYŁĄCZNIE przez Edge Function `zapytanie-wycena`
-- (service_role): adresy firm bierze z tabeli czlonkowie po id, więc strony nie da się
-- użyć do wysyłania maili na dowolne adresy. Limity: 3 zapytania na e-mail i 10 na IP
-- w ciągu doby, maksymalnie 8 firm w jednym zapytaniu.
-- Panel: /admin/wyceny.html (podgląd, status, eksport CSV).
-- ============================================================

create table if not exists public.zapytania_wyceny (
  id            uuid primary key default gen_random_uuid(),
  usluga        text not null,
  usluga_nazwa  text,
  wojewodztwo   text not null,
  miejscowosc   text,
  parametry     jsonb not null default '{}'::jsonb,
  opis          text,
  termin        text,
  imie          text not null,
  email         text not null,
  telefon       text,
  firmy         jsonb not null default '[]'::jsonb,   -- [{id, nazwa, email, ok}]
  wyslano_do    int not null default 0,
  ip            text,
  status        text not null default 'new' check (status in ('new', 'read', 'archiwum', 'spam')),
  created_at    timestamptz not null default now()
);
create index if not exists zapytania_wyceny_email on public.zapytania_wyceny(lower(email), created_at);
create index if not exists zapytania_wyceny_ip on public.zapytania_wyceny(ip, created_at);

alter table public.zapytania_wyceny enable row level security;
drop policy if exists "zw admin all" on public.zapytania_wyceny;
create policy "zw admin all" on public.zapytania_wyceny for all
  using (auth.role() = 'authenticated' and gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and gig_sesja_2fa());
revoke all on public.zapytania_wyceny from anon;
grant select, update, delete on public.zapytania_wyceny to authenticated;
