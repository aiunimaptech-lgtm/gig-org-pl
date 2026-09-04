-- ============================================================
-- GIG — pierwsze hasło administratora bez maila
--
-- Strona /admin/pierwsze-haslo.html?token=… wysyła e-mail + hasło do
-- Edge Function `pierwsze-haslo`, która kluczem service_role ustawia
-- hasło istniejącemu kontu albo zakłada nowe (z potwierdzonym e-mailem).
-- Bramą jest JEDNORAZOWY token z private.gig_sekrety — po użyciu jest
-- kasowany, więc endpoint staje się martwy. Kolejny raz: uruchom ponownie
-- ten skrypt (wstawi nowy token) i odczytaj go zapytaniem na dole.
--
-- Wymaga: backend/supabase_sekret_hooka.sql (schemat private + tabela).
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration z MCP).
-- ============================================================

insert into private.gig_sekrety (klucz, wartosc, opis)
values ('setup_token', encode(extensions.gen_random_bytes(32), 'hex'),
        'Jednorazowy token do /admin/pierwsze-haslo.html (kasowany po użyciu)')
on conflict (klucz) do nothing;

-- Sprawdza token i zwraca id konta o podanym e-mailu (null = konto nie istnieje).
-- Zła wartość → wyjątek (funkcja Edge odpowiada 401).
create or replace function public.gig_pierwsze_haslo_sprawdz(p_token text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  t   text;
  uid uuid;
begin
  select wartosc into t from private.gig_sekrety where klucz = 'setup_token';
  if t is null or p_token is null or p_token <> t then
    raise exception 'nieprawidlowy token' using errcode = '28000';
  end if;
  select id into uid from auth.users where lower(email) = lower(p_email) limit 1;
  return uid;
end;
$$;

-- Kasuje token po udanym ustawieniu hasła.
create or replace function public.gig_pierwsze_haslo_zuzyj(p_token text)
returns void
language sql
security definer
set search_path = public, private
as $$
  delete from private.gig_sekrety where klucz = 'setup_token' and wartosc = p_token;
$$;

-- Tylko service_role (Edge Function) może wołać te funkcje — nigdy klient.
revoke all on function public.gig_pierwsze_haslo_sprawdz(text, text) from public, anon, authenticated;
revoke all on function public.gig_pierwsze_haslo_zuzyj(text)          from public, anon, authenticated;
grant execute on function public.gig_pierwsze_haslo_sprawdz(text, text) to service_role;
grant execute on function public.gig_pierwsze_haslo_zuzyj(text)          to service_role;

-- ── ODCZYT TOKENU (link dla administratora) ──────────────────────────────
--   select 'https://gig.org.pl/admin/pierwsze-haslo.html?token=' || wartosc
--   from private.gig_sekrety where klucz = 'setup_token';
