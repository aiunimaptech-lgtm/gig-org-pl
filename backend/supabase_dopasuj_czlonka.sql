-- ============================================================
-- GIG: rozpoznawanie firmy członkowskiej (gig_dopasuj_czlonka) - DOKUMENTACJA
--
-- Plik dokumentuje stan funkcji na żywym projekcie (odczyt pg_get_functiondef z 11.11.2026).
-- Funkcje istnieją w bazie od dawna, w repozytorium brakowało ich definicji.
-- NIE trzeba tego pliku uruchamiać. Gdyby baza była odtwarzana od zera: uruchom go
-- po backend/supabase_czlonkowie.sql (tabela czlonkowie musi istnieć).
--
-- Kto woła:
--   - formularz /zapisy/ (RPC z kluczem anon): sprawdza członkostwo na żywo i przelicza cenę,
--   - trigger trg_zapis_czlonek (before insert na zapisy_szkolenia, funkcja gig_zapis_oznacz_czlonka).
--
-- Kolejność dopasowania (zwraca pierwsze trafienie: id członka i sposób):
--   1) NIP (same cyfry; p_nip albo p_nip2, czyli nabywca albo odbiorca faktury),
--   2) ten sam adres e-mail co w katalogu,
--   3) ta sama domena e-mail, o ile nie jest publiczną skrzynką (gmail.com, wp.pl itd.),
--   4) nazwa firmy po normalizacji (gig_norm_nazwa: bez form prawnych, co najmniej 6 znaków).
-- Tylko członkowie ze statusem 'published'.
--
-- Uwaga: Edge Function `pytanie-zglos` (Zapytaj Izbę) NIE korzysta z tej funkcji. NIP członków
-- jest publiczny w katalogu, więc tam członkostwo uznajemy za potwierdzone dopiero po zgodnym
-- adresie e-mail albo NIP-ie razem z firmową domeną adresu (patrz backend/supabase_pytania.sql).
--
-- Uprawnienia na żywym projekcie: EXECUTE dla PUBLIC, anon, authenticated i service_role
-- (formularz zapisów woła funkcję kluczem publicznym). search_path = public (audyt 8.10.2026).
-- ============================================================

CREATE OR REPLACE FUNCTION public.gig_norm_nazwa(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(t,'')),
    '(spółka z ograniczoną odpowiedzialnością|sp\.? ?z ?o\.? ?o\.?|spółka jawna|sp\.? ?j\.?|spółka komandytowa|sp\.? ?k\.?|s\.? ?c\.?|s\.? ?a\.?|spółka cywilna|spółka akcyjna|\busługi\b|\bfirma\b|\bbiuro\b|\bprzedsiębiorstwo\b|\bzakład\b)', ' ', 'g'),
    '[^a-z0-9ąćęłńóśźż]+', ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.gig_dopasuj_czlonka(p_nip text, p_email text, p_nazwa text, p_nip2 text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, sposob text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  nip1 text := nullif(regexp_replace(coalesce(p_nip,''),  '\D', '', 'g'), '');
  nip2 text := nullif(regexp_replace(coalesce(p_nip2,''), '\D', '', 'g'), '');
  em   text := lower(trim(coalesce(p_email,'')));
  dom  text := nullif(split_part(lower(trim(coalesce(p_email,''))), '@', 2), '');
  naz  text := public.gig_norm_nazwa(p_nazwa);
  publiczne text[] := array['gmail.com','wp.pl','o2.pl','onet.pl','onet.eu','poczta.onet.pl','interia.pl','interia.eu',
    'poczta.fm','tlen.pl','op.pl','vp.pl','gazeta.pl','yahoo.com','yahoo.pl','hotmail.com','outlook.com','live.com',
    'icloud.com','protonmail.com','proton.me','autograf.pl','spoko.pl','go2.pl','wp.eu','me.com'];
begin
  -- 1) NIP
  if nip1 is not null or nip2 is not null then
    return query select c.id, 'NIP'::text from public.czlonkowie c
      where c.status = 'published'
        and regexp_replace(coalesce(c.nip,''), '\D', '', 'g') in (coalesce(nip1,'-'), coalesce(nip2,'-'))
      limit 1;
    if found then return; end if;
  end if;
  -- 2) ten sam e-mail
  if em <> '' then
    return query select c.id, 'e-mail'::text from public.czlonkowie c
      where c.status = 'published' and lower(trim(coalesce(c.email,''))) = em limit 1;
    if found then return; end if;
  end if;
  -- 3) ta sama domena firmowa (nie publiczna skrzynka)
  if dom is not null and not (dom = any(publiczne)) then
    return query select c.id, 'domena e-mail'::text from public.czlonkowie c
      where c.status = 'published' and split_part(lower(trim(coalesce(c.email,''))), '@', 2) = dom limit 1;
    if found then return; end if;
  end if;
  -- 4) nazwa firmy po normalizacji (co najmniej 6 znakow, zeby "geo" nie lapalo wszystkiego)
  if naz is not null and length(naz) >= 6 then
    return query select c.id, 'nazwa'::text from public.czlonkowie c
      where c.status = 'published'
        and public.gig_norm_nazwa(c.name) is not null and length(public.gig_norm_nazwa(c.name)) >= 6
        and (public.gig_norm_nazwa(c.name) = naz
             or position(naz in public.gig_norm_nazwa(c.name)) > 0
             or position(public.gig_norm_nazwa(c.name) in naz) > 0)
      limit 1;
    if found then return; end if;
  end if;
  return;
end $function$;

grant execute on function public.gig_norm_nazwa(text) to anon, authenticated, service_role;
grant execute on function public.gig_dopasuj_czlonka(text, text, text, text) to anon, authenticated, service_role;
