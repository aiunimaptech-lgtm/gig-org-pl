-- Audyt bezpieczeństwa 8.10.2026 (zastosowany na żywo migracjami; plik dokumentuje stan).
-- 1. Funkcje triggerów i panelu bez EXECUTE dla public/anon (triggery odpalają się bez tego prawa).
revoke execute on function public.gig_czlonek_z_zgloszenia(), public.gig_czlonkowie_do_bazy(), public.gig_newsletter_do_bazy(),
  public.gig_powiadom_o_zgloszeniu(), public.gig_uchwala_z_zgloszenia(), public.gig_wezel_czlonek(), public.gig_zapis_oznacz_czlonka(),
  public.gig_zapis_sprawdz_zamkniete(), public.gig_zapisy_do_bazy(), public.rls_auto_enable() from public, anon, authenticated;
-- 2. Generowanie uchwał: funkcja wewnętrzna (trigger + service_role), panel woła wrapper z kontrolą 2FA.
revoke execute on function public.gig_uchwala_generuj(uuid), public.gig_opinia_generuj(uuid) from public, anon, authenticated;
create or replace function public.gig_uchwala_generuj_panel(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.gig_sesja_2fa() then raise exception 'brak uprawnien (sesja bez 2FA)' using errcode = '42501'; end if;
  perform public.gig_uchwala_generuj(uid);
end $$;
revoke execute on function public.gig_uchwala_generuj_panel(uuid) from public, anon;
grant  execute on function public.gig_uchwala_generuj_panel(uuid) to authenticated, service_role;
-- 3. Widok z adresami Rady i członków respektuje RLS (2FA) tabel źródłowych.
alter view public.gig_odbiorcy_konsultacji set (security_invoker = true);
-- 4. Tabele techniczne tylko dla service_role.
revoke all on table public.panel_2fa, public.panel_zaproszenia from anon, authenticated;
-- 5. Import bazy e-mail: tylko anon (skrypt z tokenem) i service_role.
revoke execute on function public.gig_baza_email_import(text, jsonb) from public, authenticated;
grant  execute on function public.gig_baza_email_import(text, jsonb) to anon, service_role;
-- 6. Token triggera sprawdzany w bazie (send-confirmation v21 woła to z service_role).
create or replace function public.gig_hook_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = private, public as $$
  select exists (select 1 from private.gig_sekrety where klucz = 'hook_token' and wartosc = p_token and length(p_token) >= 32);
$$;
revoke execute on function public.gig_hook_token_ok(text) from public, anon, authenticated;
grant  execute on function public.gig_hook_token_ok(text) to service_role;
-- 7. Stały search_path w funkcjach pomocniczych.
alter function public.gig_norm_nazwa(text) set search_path = public;
alter function public.gig_dopasuj_czlonka(text,text,text,text) set search_path = public;
alter function public.gig_data_pl(date) set search_path = public;
alter function public.gig_miesiac_rzymski(date) set search_path = public;
alter function public.gig_dopelniacz_slowo(text) set search_path = public;
alter function public.gig_dopelniacz(text) set search_path = public;
alter function public.gig_plec(text) set search_path = public;
alter function public.gig_biernik(text,text) set search_path = public;
alter function public.gig_biernik_slowo(text) set search_path = public;
alter function public.gig_prowadzacy(text,text) set search_path = public;
alter function public.gig_klucz_szkolenia(text) set search_path = public;
