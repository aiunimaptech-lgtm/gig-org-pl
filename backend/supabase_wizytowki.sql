-- ============================================================
-- GIG — weryfikacja wizytówek członków w katalogu /czlonkowie/
--
-- Biuro wysyła każdej firmie osobisty link. Członek widzi swoje obecne dane,
-- poprawia je, dopisuje opis firmy i linki (strona, LinkedIn, Facebook) albo
-- zaznacza, że danego kanału nie ma. Zgłoszenie NIE trafia od razu na stronę:
-- biuro przegląda zmiany w panelu i je zatwierdza (albo odrzuca).
--
--   panel /admin/wizytowki.html → Edge Function `wizytowka-wyslij`
--   → formularz /wizytowka/?t=<token> (Edge Function `wizytowka`)
--   → panel: przegląd różnic → „Zatwierdź" przepisuje dane do `czlonkowie`.
--
-- czlonkowie.zweryfikowano_at: dane potwierdzone przez samego członka. Katalog
-- nie uzupełnia wtedy opisu i linków ze statycznego czlonkowie-enrich.js, więc
-- „nie mamy LinkedIn" naprawdę znaczy brak linku na stronie.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration). Idempotentne.
-- Wdrożone jako migracja: wizytowki_weryfikacja.
-- ============================================================

alter table public.czlonkowie add column if not exists zweryfikowano_at timestamptz;

create table if not exists public.wizytowki_weryfikacja (
  id               uuid primary key default gen_random_uuid(),
  czlonek_id       uuid not null unique references public.czlonkowie(id) on delete cascade,
  email            text not null,               -- adres, na który poszedł link (zrzut z chwili wysyłki)
  token            text not null unique,
  status           text not null default 'wyslano'
                   check (status in ('wyslano','zgloszono','zatwierdzono','odrzucono')),
  wyslano_at       timestamptz,
  blad_wysylki     text,
  przypomnienie_at timestamptz,
  przypomnien      int not null default 0,
  otwarto_at       timestamptz,                 -- pierwsze otwarcie formularza
  zgloszono_at     timestamptz,
  ip               text,
  -- propozycja członka (puste = bez zmian nie oznacza braku; brak jest w flagach niżej)
  p_name        text,
  p_person      text,
  p_phone       text,
  p_email       text,
  p_address     text,
  p_region      text,
  p_website     text,
  p_linkedin    text,
  p_facebook    text,
  p_description text,
  brak_www      boolean not null default false,
  brak_linkedin boolean not null default false,
  brak_facebook boolean not null default false,
  uwagi         text,                           -- wiadomość członka do biura
  rozpatrzono_at timestamptz,
  rozpatrzyl     text,
  notatka_biura  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists wizytowki_status_idx on public.wizytowki_weryfikacja(status);

-- RLS jak reszta panelu: tylko administrator po kodzie z maila. Formularz z linku
-- czyta i zapisuje przez Edge Function kluczem service_role; anon nie ma praw.
alter table public.wizytowki_weryfikacja enable row level security;
drop policy if exists "wiz admin all" on public.wizytowki_weryfikacja;
create policy "wiz admin all" on public.wizytowki_weryfikacja for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- kontrola
select status, count(*) from public.wizytowki_weryfikacja group by status;
