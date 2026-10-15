-- ============================================================
-- GIG: Węzeł Jakości, uwagi do katalogu (15.10.2026)
-- Przy każdej pozycji ankiety /wezel-jakosci/ można zgłosić uwagę (np. pozycja źle opisana,
-- inna jednostka, czego nie obejmuje), a pod każdą grupą zaproponować brakującą pozycję.
-- Uwagi idą razem z ankietą (ankieta_id) i są widoczne w panelu /admin/wezel.html.
--   rodzaj = 'pozycja' -> kod pozycji z katalogu
--   rodzaj = 'brak'    -> kod grupy (np. WKI 7.511.00), tresc = proponowana pozycja
-- ============================================================

create table if not exists public.wezel_uwagi (
  id          uuid primary key default gen_random_uuid(),
  ankieta_id  uuid not null references public.wezel_ankiety(id) on delete cascade,
  rodzaj      text not null default 'pozycja' check (rodzaj in ('pozycja', 'brak')),
  kod         text not null,
  nazwa       text,
  tresc       text not null check (length(tresc) between 2 and 2000),
  status      text not null default 'new' check (status in ('new', 'uwzgledniona', 'odrzucona')),
  created_at  timestamptz not null default now()
);
create index if not exists wezel_uwagi_ankieta on public.wezel_uwagi(ankieta_id);

alter table public.wezel_uwagi enable row level security;
drop policy if exists "wezu public insert" on public.wezel_uwagi;
create policy "wezu public insert" on public.wezel_uwagi for insert with check (true);
drop policy if exists "wezu admin all" on public.wezel_uwagi;
create policy "wezu admin all" on public.wezel_uwagi for all
  using (auth.role() = 'authenticated' and gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and gig_sesja_2fa());
grant insert on public.wezel_uwagi to anon, authenticated;
grant select, update, delete on public.wezel_uwagi to authenticated;
