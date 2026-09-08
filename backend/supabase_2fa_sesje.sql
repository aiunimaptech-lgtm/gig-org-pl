-- ============================================================
-- GIG - drugi skladnik logowania EGZEKWOWANY w bazie (audyt 8 wrzesnia 2026)
--
-- Problem: kod z e-maila dzialal tylko w interfejsie panelu. Publiczny grant
-- POST /auth/v1/token?grant_type=password (klucz publishable ze strony) dawal
-- kazdemu, kto zna haslo, sesje przechodzaca wszystkie polityki RLS
-- `auth.role() = 'authenticated'` oraz funkcje wyslij-mail / wyslij-kampanie.
--
-- Naprawa: lista sesji, ktore przeszly kod (panel_sesje_ok, tylko service_role).
-- panel-logowanie wpisuje tam session_id z JWT po poprawnym kodzie; kazda polityka
-- administratora i funkcje wysylkowe sprawdzaja public.gig_sesja_2fa(). Sesja
-- z samego hasla ma inny session_id i nigdy nie trafia na liste. refreshSession
-- zachowuje session_id, wiec odswiezanie tokenu w panelu nie wybija z listy.
--
-- Zastosowane na zywym projekcie migracjami:
--   panel_2fa_sesje_i_wnioski_hardening, rls_wymaga_sesji_2fa.
-- Idempotentne; uruchom w SQL Editor albo apply_migration z MCP.
-- ============================================================

create table if not exists public.panel_sesje_ok (
  session_id uuid primary key,
  email      text,
  wygasa     timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.panel_sesje_ok enable row level security;
revoke all on public.panel_sesje_ok from anon, authenticated;

-- Czy biezaca sesja (JWT) przeszla kod z maila. Wolane z polityk RLS i z panelu (RPC)
-- - _admin.js requireAuth() wylogowuje sesje, ktora nie jest na liscie.
create or replace function public.gig_sesja_2fa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.panel_sesje_ok s
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.wygasa > now()
  );
$$;
revoke all on function public.gig_sesja_2fa() from public;
grant execute on function public.gig_sesja_2fa() to anon, authenticated, service_role;

-- Uniewaznienie sesji GoTrue zaparkowanej na czas wyzwania (zly/przeterminowany kod).
create or replace function public.gig_2fa_uniewaznij(p_refresh text) returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.sessions s
  using auth.refresh_tokens r
  where r.session_id = s.id and r.token = p_refresh;
$$;
revoke all on function public.gig_2fa_uniewaznij(text) from public, anon, authenticated;
grant execute on function public.gig_2fa_uniewaznij(text) to service_role;

-- Sprzatanie (wolane przy kazdym logowaniu): przeterminowane wyzwania razem
-- z ich sesjami GoTrue oraz wygasle / osierocone wpisy listy.
create or replace function public.gig_2fa_sprzataj() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.sessions s
    using auth.refresh_tokens r, public.panel_2fa p
    where r.session_id = s.id and r.token = p.refresh_token and p.wygasa < now();
  delete from public.panel_2fa where wygasa < now();
  delete from public.panel_sesje_ok
    where wygasa < now() or session_id not in (select id from auth.sessions);
end $$;
revoke all on function public.gig_2fa_sprzataj() from public, anon, authenticated;
grant execute on function public.gig_2fa_sprzataj() to service_role;

-- ── Polityki administratora: JWT to za malo, sesja musi byc na liscie ──────
-- Przy dodawaniu NOWEJ tabeli dla panelu uzyj tego samego warunku.
alter policy "art admin all"        on public.articles               using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "czl admin all"        on public.czlonkowie             using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "kt admin all"         on public.submissions_kontakt    using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "nl admin all"         on public.submissions_newsletter using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "szk admin all"        on public.szkolenia              using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "zap admin all"        on public.zapisy_szkolenia       using (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "be admin all"         on public.baza_email
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "dmarc rap admin all"  on public.dmarc_raporty
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "dmarc wier admin all" on public.dmarc_wiersze
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "wys admin all"        on public.wysylki
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());
alter policy "wys odb admin all"    on public.wysylki_odbiorcy
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- ── PRZYDATNE ─────────────────────────────────────────────────────────────
-- Sesje po kodzie (kto i do kiedy):
--   select email, wygasa, created_at from panel_sesje_ok order by created_at desc;
-- Wylogowac kogos wszedzie: usun wiersz z panel_sesje_ok (panel wyloguje przy
--   nastepnym requireAuth) i sesje z auth.sessions.
