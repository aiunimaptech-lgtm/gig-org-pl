-- ============================================================
-- GIG — konsultacje: doraźne zapytania do organów Izby i do członków
--
-- Nie każda sprawa jest uchwałą Rady. Część pytań (czy Izba ma objąć wydarzenie
-- patronatem, czy zostajemy partnerem, jakie zajmujemy stanowisko) wymaga tylko
-- kolegialnego głosu. Tabela `uchwaly` jest związana z art. 12 Statutu i ma swój
-- dwuetapowy tryb, więc konsultacje dostają własny, prostszy mechanizm:
-- jedno pytanie, jedna runda, za/przeciw z uzasadnieniem, te same osobiste tokeny.
--
--   panel /admin/konsultacje.html: szkic → „Wyślij zapytanie"
--   → Edge Function `konsultacja-wyslij` (osobisty link dla każdego odbiorcy)
--   → odpowiedzi ze strony /ankieta/ (Edge Function `konsultacja-glosuj`)
--   → przypomnienia → „Zakończ i podsumuj" → eksport CSV.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration). Idempotentne.
-- Wdrożone jako migracja: konsultacje_ankiety_kolegialne.
-- ============================================================

create table if not exists public.konsultacje (
  id            uuid primary key default gen_random_uuid(),
  temat         text not null default '',
  tresc         text not null default '',          -- zwykły tekst, akapity po pustej linii
  grupa         text not null default 'prezydium', -- z jakiej grupy złożono listę odbiorców
  pytanie       text not null default 'Czy jest Pani/Pan za?',
  etykieta_za      text not null default 'Jestem ZA',
  etykieta_przeciw text not null default 'Jestem PRZECIW',
  termin        date,
  status        text not null default 'projekt'
                check (status in ('projekt','glosowanie','zakonczona','anulowana')),
  wyslano_at    timestamptz,
  wyslal        text,
  zamknieto_at  timestamptz,
  zamknal       text,
  wynik_za      int,
  wynik_przeciw int,
  podsumowanie  text,                              -- notatka biura po zamknięciu
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists konsultacje_status_idx on public.konsultacje(status);

create table if not exists public.konsultacje_glosy (
  id               uuid primary key default gen_random_uuid(),
  konsultacja_id   uuid not null references public.konsultacje(id) on delete cascade,
  imie_nazwisko    text not null,                  -- zrzut z chwili wysyłki, listy się zmieniają
  email            text not null,
  organizacja      text,                           -- nazwa firmy przy członkach Izby
  grupa            text,                           -- prezydium | rada | przedstawiciel | czlonek
  token            text not null unique,
  glos             text check (glos in ('za','przeciw')),
  uzasadnienie     text,
  glosowano_at     timestamptz,
  ip               text,
  wyslano_at       timestamptz,
  blad_wysylki     text,
  przypomnienie_at timestamptz,
  przypomnien      int not null default 0,
  unique (konsultacja_id, email)
);
create index if not exists konsultacje_glosy_kons_idx on public.konsultacje_glosy(konsultacja_id);

-- RLS jak reszta panelu: tylko administrator po kodzie z maila. Odpowiedzi z linku
-- zapisuje Edge Function kluczem service_role, więc anon nie ma tu żadnych praw.
alter table public.konsultacje       enable row level security;
alter table public.konsultacje_glosy enable row level security;

drop policy if exists "kons admin all" on public.konsultacje;
create policy "kons admin all" on public.konsultacje for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

drop policy if exists "konsg admin all" on public.konsultacje_glosy;
create policy "konsg admin all" on public.konsultacje_glosy for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- Jedna lista odbiorców z dwóch źródeł: organy Izby (rada_izby) i katalog członków.
-- Panel czyta ją zamiast sklejać dwa zapytania, a Edge Function rozwiązuje po niej
-- adresy, więc z panelu nie da się wysłać na dowolny adres.
create or replace view public.gig_odbiorcy_konsultacji as
  select 'rada:' || r.id::text as id,
         r.imie_nazwisko       as nazwa,
         lower(r.email)        as email,
         nullif(concat_ws(', ', r.funkcja, r.region), '') as opis,
         case when r.prezydium then 'prezydium'
              when r.rada      then 'rada'
              else 'przedstawiciel' end as grupa,
         r.kolejnosc           as kolejnosc
    from public.rada_izby r
   where r.aktywny and coalesce(r.email, '') <> ''
  union all
  select 'czlonek:' || c.id::text,
         coalesce(nullif(c.person, ''), c.name),
         lower(c.email),
         c.name,
         'czlonek',
         1000
    from public.czlonkowie c
   where c.status = 'published' and coalesce(c.email, '') <> '';

revoke all on public.gig_odbiorcy_konsultacji from anon;
grant select on public.gig_odbiorcy_konsultacji to authenticated;

-- kontrola
select grupa, count(*) from public.gig_odbiorcy_konsultacji group by grupa order by grupa;
