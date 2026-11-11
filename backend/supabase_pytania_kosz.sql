-- ============================================================
-- GIG: „Zapytaj Izbę”: kosz zablokowanych zgłoszeń i atomowe limity, 11.11.2026
--
-- 1. pytania_odrzucone  kosz: zgłoszenia z formularza /pytania/zadaj/, które zatrzymał antyspam
--    Edge Function `pytanie-zglos` (v7). Powody:
--      pulapka           wypełnione ukryte pole `www`
--      za_szybko         formularz wysłany przed upływem 20 s (albo bez pola `czas`)
--      link_w_tresci     link albo adres strony w treści (pytający dostał prośbę o usunięcie linku)
--      link_w_podpisie   link w polach imię, organizacja, podpis, temat, rola
--      powtorzona_tresc  taka sama treść w ciągu 7 dni
--      limit_laczny      przekroczony limit łączny formularza (godzinowy albo dobowy)
--      limit_email       więcej niż 3 pytania z jednego adresu e-mail na dobę
--      limit_ip          więcej niż 6 pytań z jednego adresu IP na dobę
--    Dostęp WYŁĄCZNIE z panelu (/admin/pytania.html, zakładka Kosz: podgląd, „Przywróć jako pytanie”,
--    usuwanie) i z Edge Function (service_role). Rola anon nie ma tu żadnych praw.
--    Ochrona przed zalaniem (w funkcji, od v8): powody dzielą się na dwie grupy, „roboty” (pulapka, za_szybko,
--    link_w_podpisie) i „ludzie” (pozostałe). W każdej grupie funkcja zapisuje najwyżej 200 wpisów na dobę
--    i najwyżej 10 z jednego adresu IP, więc zalew z pułapki nie zabiera miejsca zgłoszeniom zatrzymanym limitem.
--    Wpisy starsze niż 30 dni usuwa zadanie pg_cron 'gig-pytania-kosz' (codziennie 3:25 UTC).
--
-- 2. trg_pytania_limit  limity formularza przeliczone w bazie tuż przed zapisem, pod blokadą
--    pg_advisory_xact_lock. Funkcja `pytanie-zglos` liczy limity i dopiero potem wstawia wiersz,
--    więc kilka równoległych zgłoszeń mogłoby przejść razem; trigger to zamyka.
--    Dotyczy tylko zrodlo = 'formularz' wstawianego spoza panelu. Panel (rola authenticated,
--    np. „Przywróć jako pytanie”) i inne źródła (szkolenie, mail, inne) nie mają ograniczeń.
--    Przekroczenie: wyjątek 'ZA_DUZO_ZGLOSZEN', w polu DETAIL powód (limit_laczny, limit_email,
--    limit_ip); funkcja zamienia go na odpowiedź 429 i zapis do kosza.
--    UWAGA: liczby limitów są też w backend/edge-functions/pytanie-zglos.ts. Zmieniaj w obu miejscach.
--      łącznie: do 22.11.2026 włącznie (czas polski) 20 na godzinę i 40 na dobę,
--               od 23.11.2026 6 na godzinę i 15 na dobę (decyzja prezesa z 11.11.2026),
--      e-mail:  3 na dobę,  IP: 6 na dobę (urzędy i biura wychodzą jednym adresem).
--
-- Uruchom w: Supabase -> SQL Editor -> Run. Idempotentne. Zastosowane na żywym projekcie 11.11.2026.
-- ============================================================

-- ── 1. kosz ─────────────────────────────────────────────────────────────────
create table if not exists public.pytania_odrzucone (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  powod       text not null
              check (powod in ('pulapka', 'za_szybko', 'link_w_tresci', 'link_w_podpisie',
                               'powtorzona_tresc', 'limit_laczny', 'limit_email', 'limit_ip')),
  rodzaj      text,
  temat       text,
  rola        text,
  tresc       text check (tresc is null or char_length(tresc) <= 3000),
  imie        text,
  email       text,
  organizacja text,
  ip          text
);
-- Zastrzeżenia i dane pytającego, żeby „Przywróć jako pytanie” ich nie gubiło (pytanie-zglos v8).
-- Wartości wprost z formularza, niesprawdzone: NIP tak, jak go wpisano, podpis_zakres dowolny tekst.
alter table public.pytania_odrzucone
  add column if not exists wojewodztwo        text,
  add column if not exists nip                text,
  add column if not exists podpis_zakres      text,
  add column if not exists podpis_osoba       text,
  add column if not exists podpis_organizacja text,
  add column if not exists tylko_dla_mnie     boolean not null default false,
  add column if not exists nie_ujawniac       boolean not null default false,
  add column if not exists zgoda              boolean not null default false;
comment on table public.pytania_odrzucone is
  'Zapytaj Izbę: kosz zgłoszeń zablokowanych przez antyspam funkcji pytanie-zglos. Tylko panel (sesja 2FA) i service_role. Wpisy starsze niż 30 dni usuwa pg_cron (gig-pytania-kosz).';

create index if not exists pytania_odrzucone_created_idx on public.pytania_odrzucone(created_at desc);

alter table public.pytania_odrzucone enable row level security;

drop policy if exists "pyto admin all" on public.pytania_odrzucone;
create policy "pyto admin all" on public.pytania_odrzucone for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

revoke all on public.pytania_odrzucone from anon, authenticated;
grant select, delete on public.pytania_odrzucone to authenticated;
grant all on public.pytania_odrzucone to service_role;

-- ── 2. atomowe limity formularza ────────────────────────────────────────────
create or replace function public.gig_pytania_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_godz int;
  v_doba int;
  v_n    int;
begin
  -- panel (zalogowany użytkownik) wstawia bez ograniczeń, także z zrodlo = 'formularz' (przywrócenie z kosza)
  if coalesce(auth.role(), '') = 'authenticated' then
    return new;
  end if;

  -- jedna kolejka dla wszystkich zgłoszeń z formularza: blokada do końca transakcji
  perform pg_advisory_xact_lock(hashtext('gig_pytania_limit'));

  if now() < timestamptz '2026-11-23 00:00:00 Europe/Warsaw' then
    v_godz := 20; v_doba := 40;
  else
    v_godz := 6;  v_doba := 15;
  end if;

  select count(*) into v_n from public.pytania
   where zrodlo = 'formularz' and created_at >= now() - interval '1 hour';
  if v_n >= v_godz then
    raise exception 'ZA_DUZO_ZGLOSZEN' using detail = 'limit_laczny';
  end if;
  select count(*) into v_n from public.pytania
   where zrodlo = 'formularz' and created_at >= now() - interval '1 day';
  if v_n >= v_doba then
    raise exception 'ZA_DUZO_ZGLOSZEN' using detail = 'limit_laczny';
  end if;

  if new.email is not null then
    select count(*) into v_n from public.pytania
     where zrodlo = 'formularz' and email = new.email and created_at >= now() - interval '1 day';
    if v_n >= 3 then
      raise exception 'ZA_DUZO_ZGLOSZEN' using detail = 'limit_email';
    end if;
  end if;

  if new.ip is not null then
    select count(*) into v_n from public.pytania
     where zrodlo = 'formularz' and ip = new.ip and created_at >= now() - interval '1 day';
    if v_n >= 6 then
      raise exception 'ZA_DUZO_ZGLOSZEN' using detail = 'limit_ip';
    end if;
  end if;

  return new;
end;
$$;
comment on function public.gig_pytania_limit() is
  'Zapytaj Izbę: limity formularza przeliczane pod blokadą przed zapisem (łączny wg daty, 3 na e-mail, 6 na IP na dobę). Liczby są też w Edge Function pytanie-zglos.';

revoke all on function public.gig_pytania_limit() from public, anon, authenticated;

drop trigger if exists trg_pytania_limit on public.pytania;
create trigger trg_pytania_limit
  before insert on public.pytania
  for each row
  when (new.zrodlo = 'formularz')
  execute function public.gig_pytania_limit();

-- ── 3. automatyczne opróżnianie kosza ───────────────────────────────────────
-- cron.schedule z nazwą zadania nadpisuje istniejące zadanie o tej nazwie (jak 'gig-czysc-historie-cron').
select cron.schedule(
  'gig-pytania-kosz',
  '25 3 * * *',
  $$delete from public.pytania_odrzucone where created_at < now() - interval '30 days'$$
);

notify pgrst, 'reload schema';

-- ── PRZYDATNE ───────────────────────────────────────────────────────────────
-- Kosz z ostatniej doby wg powodu:
--   select powod, count(*) from pytania_odrzucone where created_at >= now() - interval '1 day' group by 1;
-- Zadanie czyszczące: select jobid, jobname, schedule, command from cron.job where jobname = 'gig-pytania-kosz';
-- Wyłączenie czyszczenia: select cron.unschedule('gig-pytania-kosz');
