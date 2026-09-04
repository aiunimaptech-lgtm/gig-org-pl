-- ============================================================
-- GIG — BAZA E-MAIL (panel → zakładka „Baza e-mail")
-- Adresy firm i instytucji z listy MailerLite, wzbogacone o dane
-- z researchu (plik dane_firm_z_maili_GIG.xlsx, 4.09.2026, 3791 adresów).
--
-- Dostęp: tylko zalogowany administrator (RLS). Brak polityk publicznych.
-- Import: skrypt skrypty/import_baza_email.py woła RPC gig_baza_email_import
-- z JEDNORAZOWYM tokenem (private.gig_sekrety 'import_token'); po imporcie
-- token jest kasowany i RPC staje się martwe. Kolejny import: uruchom ten
-- skrypt ponownie (insert tokenu) i odczytaj go zapytaniem z końca pliku.
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration z MCP). Idempotentne.
-- ============================================================

create table if not exists public.baza_email (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  pochodzenie text,            -- skąd adres: MailerLite / formularz / ręcznie …
  grupa       text,            -- JST / Firma / Spółki komunalne / Administracja rządowa / Nauka / Nieustalone
  rodzaj      text,            -- rodzaj/branża: geodezja / PODGiK / WINGiK / uczelnia wyższa …
  firma       text,
  adres       text,
  nip         text,
  telefon     text,
  osoba       text,            -- osoba kontaktowa
  stanowisko  text,
  www         text,
  pewnosc     text,            -- z researchu: „ustalone ze strony www", „dopasowanie po domenie" …
  zrodlo      text,            -- źródło danych (np. „research online 2026-09-04")
  uwagi       text,
  status      text default 'active' check (status in ('active','unsubscribed','bounced')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_baza_email_grupa  on public.baza_email (grupa);
create index if not exists idx_baza_email_rodzaj on public.baza_email (rodzaj);

alter table public.baza_email enable row level security;
drop policy if exists "be admin all" on public.baza_email;
create policy "be admin all" on public.baza_email
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- jednorazowy token importu (wymaga schematu private z supabase_sekret_hooka.sql)
insert into private.gig_sekrety (klucz, wartosc, opis)
values ('import_token', encode(extensions.gen_random_bytes(32), 'hex'),
        'Jednorazowy token importu do baza_email (kasowany po imporcie)')
on conflict (klucz) do nothing;

-- Import/upsert po e-mailu: puste pola w pliku NIE nadpisują istniejących danych.
create or replace function public.gig_baza_email_import(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t text;
  n integer;
begin
  select wartosc into t from private.gig_sekrety where klucz = 'import_token';
  if t is null or p_token is null or p_token <> t then
    raise exception 'nieprawidlowy token' using errcode = '28000';
  end if;

  insert into public.baza_email (email, pochodzenie, grupa, rodzaj, firma, adres, nip, telefon, osoba, stanowisko, www, pewnosc, zrodlo)
  select lower(trim(r.email)),
         nullif(trim(r.pochodzenie), ''), nullif(trim(r.grupa), ''), nullif(trim(r.rodzaj), ''),
         nullif(trim(r.firma), ''), nullif(trim(r.adres), ''), nullif(trim(r.nip), ''),
         nullif(trim(r.telefon), ''), nullif(trim(r.osoba), ''), nullif(trim(r.stanowisko), ''),
         nullif(trim(r.www), ''), nullif(trim(r.pewnosc), ''), nullif(trim(r.zrodlo), '')
  from jsonb_to_recordset(p_rows) as r(
         email text, pochodzenie text, grupa text, rodzaj text, firma text, adres text, nip text,
         telefon text, osoba text, stanowisko text, www text, pewnosc text, zrodlo text)
  where r.email is not null and trim(r.email) <> ''
  on conflict (email) do update set
    pochodzenie = coalesce(excluded.pochodzenie, baza_email.pochodzenie),
    grupa       = coalesce(excluded.grupa,       baza_email.grupa),
    rodzaj      = coalesce(excluded.rodzaj,      baza_email.rodzaj),
    firma       = coalesce(excluded.firma,       baza_email.firma),
    adres       = coalesce(excluded.adres,       baza_email.adres),
    nip         = coalesce(excluded.nip,         baza_email.nip),
    telefon     = coalesce(excluded.telefon,     baza_email.telefon),
    osoba       = coalesce(excluded.osoba,       baza_email.osoba),
    stanowisko  = coalesce(excluded.stanowisko,  baza_email.stanowisko),
    www         = coalesce(excluded.www,         baza_email.www),
    pewnosc     = coalesce(excluded.pewnosc,     baza_email.pewnosc),
    zrodlo      = coalesce(excluded.zrodlo,      baza_email.zrodlo),
    updated_at  = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.gig_baza_email_import(text, jsonb) from public;
grant execute on function public.gig_baza_email_import(text, jsonb) to anon, service_role;

-- ── TOKEN DLA SKRYPTU IMPORTU ────────────────────────────────────────────
--   select wartosc from private.gig_sekrety where klucz = 'import_token';
-- Po imporcie skrypt kasuje token; ręcznie:
--   delete from private.gig_sekrety where klucz = 'import_token';
