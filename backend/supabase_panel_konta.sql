-- ============================================================
-- GIG — logowanie do panelu: 2FA kodem z maila + wnioski o konto
--
-- Obie tabele obsluguje WYLACZNIE service_role z Edge Functions
-- (panel-logowanie, panel-rejestracja). RLS wlaczone; dla anon/authenticated
-- nie ma polityki zapisu, wiec kod 2FA ani token akceptacji nie sa
-- osiagalne z przegladarki.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration z MCP).
-- ============================================================

-- Wyzwanie 2FA. Refresh token lezy TYLKO tutaj i tylko do czasu podania kodu —
-- dzieki temu samo haslo nie daje przegladarce zadnej sesji.
create table if not exists public.panel_2fa (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  kod_hash      text not null,
  refresh_token text not null,
  proby         smallint not null default 0,
  wygasa        timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_panel_2fa_wygasa on public.panel_2fa (wygasa);

create table if not exists public.panel_wnioski (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  imie         text,
  uzasadnienie text,
  status       text not null default 'oczekuje'
               check (status in ('oczekuje','zaakceptowany','odrzucony')),
  token_akcji  text not null,
  rozpatrzono  timestamptz,
  rozpatrzyl   text,
  created_at   timestamptz not null default now()
);
-- Jeden OCZEKUJACY wniosek na adres — ponowne wyslanie formularza nie zasypie biura.
create unique index if not exists idx_panel_wnioski_oczekuje
  on public.panel_wnioski (lower(email)) where status = 'oczekuje';

alter table public.panel_2fa     enable row level security;
alter table public.panel_wnioski enable row level security;

drop policy if exists "wnioski admin odczyt" on public.panel_wnioski;
create policy "wnioski admin odczyt" on public.panel_wnioski
  for select using (auth.role() = 'authenticated');

-- Widok bez token_akcji — do ewentualnej listy wnioskow w panelu.
create or replace view public.panel_wnioski_lista with (security_invoker = true) as
select id, email, imie, uzasadnienie, status, rozpatrzono, rozpatrzyl, created_at
from public.panel_wnioski;

create or replace function public.gig_2fa_sprzataj()
returns void language sql security definer set search_path = public as $$
  delete from public.panel_2fa where wygasa < now() - interval '1 hour';
$$;
revoke all on function public.gig_2fa_sprzataj() from public, anon, authenticated;

-- ── PRZYDATNE ─────────────────────────────────────────────────────────────
--   select email, imie, status, created_at from panel_wnioski order by created_at desc;
--   Reczne zalozenie konta: Supabase → Authentication → Users → Add user.
