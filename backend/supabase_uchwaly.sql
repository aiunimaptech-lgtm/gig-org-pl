-- ============================================================
-- GIG — uchwały Rady Izby o przyjęciu nowych członków + głosowanie mailowe
--
-- Procedura biura: wpływa zgłoszenie z formularza „Dołącz do nas"
-- (submissions_kontakt, temat „Zgłoszenie członkowskie: …"), sekretariat
-- pisze projekt uchwały i rozsyła go członkom Rady, Rada głosuje mailowo.
--
-- Tutaj: trigger sam zakłada PROJEKT uchwały i projekt maila do Rady,
-- panel /admin/uchwaly.html pozwala je poprawić i wysłać (Edge Function
-- uchwala-wyslij), każdy członek Rady dostaje osobisty link do strony
-- /glosowanie/ (Edge Function glosuj), a panel zbiera głosy i robi raport.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration). Idempotentne.
-- ============================================================

-- ── 1. Rada Izby: lista głosujących, edytowalna w panelu ──
create table if not exists public.rada_izby (
  id            uuid primary key default gen_random_uuid(),
  imie_nazwisko text not null,
  email         text not null unique,
  funkcja       text,
  aktywny       boolean not null default true,
  kolejnosc     int not null default 100,
  created_at    timestamptz not null default now()
);

-- ── 2. Uchwały ──
create table if not exists public.uchwaly (
  id              uuid primary key default gen_random_uuid(),
  zgloszenie_id   uuid references public.submissions_kontakt(id) on delete set null,
  numer           text,                                  -- sam numer porządkowy, np. '12'; pełny zapis: 12/IX/2026
  kandydat_osoba  text,                                  -- imię i nazwisko przedsiębiorcy / osoby reprezentującej
  kandydat_firma  text,
  kandydat_adres  text,
  kandydat_nip    text,
  kandydat_regon  text,
  kandydat_krs    text,
  kandydat_email  text,
  data_wejscia    date not null default current_date,    -- „wchodzi w życie z dniem"
  tresc           text not null default '',              -- pełny tekst uchwały (edytowalny)
  mail_temat      text not null default '',
  mail_tresc      text not null default '',              -- treść maila do Rady (zwykły tekst, akapity po pustej linii)
  status          text not null default 'projekt'
                  check (status in ('projekt','glosowanie','przyjeta','odrzucona','anulowana')),
  wyslano_at      timestamptz,
  wyslal          text,
  zamknieto_at    timestamptz,
  zamknal         text,
  wynik_za        int,
  wynik_przeciw   int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists uchwaly_status_idx on public.uchwaly(status);
-- kolumny dołożone 17.09 (create table if not exists nie zmienia istniejącej tabeli)
alter table public.uchwaly add column if not exists kandydat_regon text;
alter table public.uchwaly add column if not exists kandydat_krs text;

-- ── 3. Głosy: jeden wiersz na członka Rady i uchwałę, z osobistym tokenem z maila ──
create table if not exists public.uchwaly_glosy (
  id               uuid primary key default gen_random_uuid(),
  uchwala_id       uuid not null references public.uchwaly(id) on delete cascade,
  rada_id          uuid references public.rada_izby(id) on delete set null,
  imie_nazwisko    text not null,                        -- zrzut z chwili wysyłki (lista Rady może się zmienić)
  email            text not null,
  token            text not null unique,
  glos             text check (glos in ('za','przeciw')), -- NULL = jeszcze nie głosował
  uzasadnienie     text,
  glosowano_at     timestamptz,
  ip               text,
  wyslano_at       timestamptz,
  blad_wysylki     text,
  przypomnienie_at timestamptz,
  przypomnien      int not null default 0,
  unique (uchwala_id, email)
);
create index if not exists uchwaly_glosy_uchwala_idx on public.uchwaly_glosy(uchwala_id);

-- ── 4. RLS: tylko zalogowany administrator po kodzie z maila (jak reszta panelu).
--        Głosowanie z linku obsługuje Edge Function `glosuj` kluczem service_role,
--        więc anon nie ma tu żadnych praw. ──
alter table public.rada_izby     enable row level security;
alter table public.uchwaly       enable row level security;
alter table public.uchwaly_glosy enable row level security;

drop policy if exists "rada admin all" on public.rada_izby;
create policy "rada admin all" on public.rada_izby for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

drop policy if exists "uch admin all" on public.uchwaly;
create policy "uch admin all" on public.uchwaly for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

drop policy if exists "uchg admin all" on public.uchwaly_glosy;
create policy "uchg admin all" on public.uchwaly_glosy for all
  using (auth.role() = 'authenticated' and public.gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and public.gig_sesja_2fa());

-- ── 5. Pomocnicze: data po polsku, miesiąc rzymski, dopełniacz nazwiska, płeć po imieniu ──
create or replace function public.gig_data_pl(d date) returns text
language sql immutable as $$
  select extract(day from d)::int || ' ' ||
    (array['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia',
           'września','października','listopada','grudnia'])[extract(month from d)::int]
    || ' ' || extract(year from d)::int || ' r.'
$$;

create or replace function public.gig_miesiac_rzymski(d date) returns text
language sql immutable as $$
  select (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[extract(month from d)::int]
$$;

-- Dopełniacz jednego wyrazu (imię albo nazwisko). Heurystyka dla typowych polskich
-- końcówek; przypadki szczególne sekretariat poprawia w panelu, bo treść jest edytowalna.
create or replace function public.gig_dopelniacz_slowo(w text) returns text
language plpgsql immutable as $$
declare l text := lower(w); n int := length(w);
begin
  if n < 3 or w like '%.' then return w; end if;                                 -- skróty: inż., dr.
  if l like '%ska' or l like '%cka' or l like '%dzka' then return left(w, n-1) || 'iej'; end if;  -- Kowalska → Kowalskiej
  if l like '%ski' or l like '%cki' or l like '%dzki' then return w || 'ego'; end if;             -- Urbański → Urbańskiego
  if l like '%ia' then return left(w, n-1) || 'i'; end if;                                        -- Maria → Marii
  if l like '%ka' or l like '%ga' then return left(w, n-1) || 'i'; end if;                        -- Agnieszka → Agnieszki, Kraska → Kraski
  if l like '%a'  then return left(w, n-1) || 'y'; end if;                                        -- Anna → Anny
  if l like '%ko' or l like '%go' then return left(w, n-1) || 'i'; end if;                        -- Kościuszko → Kościuszki
  if l like '%o'  then return left(w, n-1) || 'y'; end if;                                        -- Fredro → Fredry
  if l like '%y'  then return left(w, n-1) || 'ego'; end if;                                      -- Jerzy → Jerzego
  if l like '%i'  then return w || 'ego'; end if;                                                 -- Antoni → Antoniego
  if l like '%ek' then return left(w, n-2) || 'ka'; end if;                                       -- Marek → Marka
  if l like '%eł' then return left(w, n-2) || 'ła'; end if;                                       -- Paweł → Pawła
  if l like '%ec' then return left(w, n-2) || 'ca'; end if;                                       -- Kowalec → Kowalca
  return w || 'a';                                                                                -- Piotr → Piotra, Bryk → Bryka
end $$;

create or replace function public.gig_dopelniacz(osoba text) returns text
language sql immutable as $$
  select string_agg(public.gig_dopelniacz_slowo(w), ' ')
  from regexp_split_to_table(coalesce(trim(osoba), ''), '\s+') as w
  where w <> ''
$$;

-- 'f' gdy pierwsze słowo (imię) kończy się na -a, poza męskimi wyjątkami.
create or replace function public.gig_plec(osoba text) returns text
language sql immutable as $$
  select case
    when lower(split_part(trim(coalesce(osoba,'')), ' ', 1)) in ('kuba','barnaba','bonawentura','kosma') then 'm'
    when lower(split_part(trim(coalesce(osoba,'')), ' ', 1)) like '%a' then 'f'
    else 'm' end
$$;

-- Biernik: po „reprezentowanego przez" stoi Panią Agnieszkę Kowalską / Pana Piotra Urbańskiego
-- (u mężczyzn biernik = dopełniacz).
create or replace function public.gig_biernik_slowo(w text) returns text
language plpgsql immutable as $$
declare l text := lower(w); n int := length(w);
begin
  if n < 3 or w like '%.' then return w; end if;
  if l like '%ska' or l like '%cka' or l like '%dzka' then return left(w, n-1) || 'ą'; end if;  -- Kowalska → Kowalską
  if l like '%a' then return left(w, n-1) || 'ę'; end if;                                        -- Agnieszka → Agnieszkę, Maria → Marię
  return w;
end $$;

create or replace function public.gig_biernik(osoba text, plec text) returns text
language sql immutable as $$
  select case when plec = 'f'
    then (select string_agg(public.gig_biernik_slowo(w), ' ') from regexp_split_to_table(coalesce(trim(osoba), ''), '\s+') as w where w <> '')
    else public.gig_dopelniacz(osoba) end
$$;

-- ── 6. Generator treści uchwały i maila do Rady (wzór: uchwała z 17.09.2026) ──
-- Wołany przez trigger przy nowym zgłoszeniu i z panelu („Wygeneruj treść od nowa").
create or replace function public.gig_uchwala_generuj(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u record; osoba text; osoba_dop text; osoba_bier text; plec text; pana text; pania text; prowadz text;
  spolka boolean; opis text; ident text; etykieta text; kogo text; tresc_u text; mail_t text; mail_s text;
begin
  select * into u from public.uchwaly where id = uid;
  if not found then return; end if;

  osoba      := coalesce(nullif(trim(u.kandydat_osoba), ''), '(imię i nazwisko)');
  plec       := public.gig_plec(osoba);
  pana       := case when plec = 'f' then 'Pani' else 'Pana' end;    -- dopełniacz: przyjęcie ... Pana / Pani
  pania      := case when plec = 'f' then 'Panią' else 'Pana' end;   -- biernik: reprezentowanego przez Panią / Pana
  prowadz    := case when plec = 'f' then 'prowadzącą' else 'prowadzącego' end;
  osoba_dop  := public.gig_dopelniacz(osoba);
  osoba_bier := public.gig_biernik(osoba, plec);
  spolka     := coalesce(u.kandydat_firma, '') ~* '(sp\.? ?z ?o\.? ?o|spółk|s\.a\.|sp\. ?j\.|sp\. ?k\.|s\.k\.a)';

  -- identyfikatory w nawiasie po siedzibie: tylko te, które są (NIP zwykle jest, KRS tylko w spółkach)
  ident := concat_ws(', ',
    case when nullif(trim(u.kandydat_nip),   '') is not null then 'NIP '   || trim(u.kandydat_nip)   end,
    case when nullif(trim(u.kandydat_regon), '') is not null then 'REGON ' || trim(u.kandydat_regon) end,
    case when nullif(trim(u.kandydat_krs),   '') is not null then 'KRS '   || trim(u.kandydat_krs)   end);
  ident := case when ident <> '' then ' (' || ident || ')' else '' end;

  if spolka then
    opis := format('przedsiębiorcy %s z siedzibą %s%s, reprezentowanego przez %s %s',
                   coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident, pania, osoba_bier);
    kogo := coalesce(u.kandydat_firma, '(nazwa firmy)');
  else
    opis := format('przedsiębiorcy %s %s %s działalność gospodarczą o nazwie: %s z siedzibą %s%s',
                   pana, osoba_dop, prowadz, coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident);
    kogo := pana || ' ' || osoba_dop;
  end if;

  etykieta := coalesce(nullif(trim(u.numer), ''), '...') || '/' ||
              public.gig_miesiac_rzymski(u.data_wejscia) || '/' || extract(year from u.data_wejscia)::int;

  tresc_u :=
    'Uchwała nr ' || etykieta || ' Rady Geodezyjnej Izby Gospodarczej' || E'\n\n' ||
    '§ 1' || E'\n' ||
    'Rada Izby działając na podstawie art. 21 pkt 2 Statutu GIG oraz § 4 Regulaminu Pracy Rady GIG ' ||
    'postanawia o przyjęciu do Geodezyjnej Izby Gospodarczej ' || opis || '.' || E'\n\n' ||
    '§ 2' || E'\n' ||
    'Uchwała wchodzi w życie z dniem ' || public.gig_data_pl(u.data_wejscia) || E'\n\n\n' ||
    'Prezes' || E'\n' || 'Geodezyjnej Izby Gospodarczej' || E'\n' || 'Rafał Kraska';

  mail_t := 'Prośba o podjęcie uchwały: przyjęcie do GIG ' || kogo;

  mail_s :=
    'Szanowni Członkowie Rady GIG,' || E'\n\n' ||
    'Z upoważnienia Pana Prezesa Rafała Kraski przesyłam poniżej projekt uchwały w sprawie przyjęcia ' ||
    'do Geodezyjnej Izby Gospodarczej ' || opis || ', z uprzejmą prośbą o jej podjęcie.' || E'\n\n' ||
    'Głos można oddać jednym kliknięciem: przyciski „Głosuję ZA" i „Głosuję PRZECIW" pod treścią uchwały ' ||
    'prowadzą na stronę, na której można też wpisać uzasadnienie. Link jest osobisty, prosimy nie przekazywać go dalej.' || E'\n\n' ||
    'Z wyrazami szacunku' || E'\n' || 'Agnieszka Horbaczewska' || E'\n' || 'Sekretariat Geodezyjnej Izby Gospodarczej';

  update public.uchwaly
     set tresc = tresc_u, mail_temat = mail_t, mail_tresc = mail_s, updated_at = now()
   where id = uid;
end $$;

revoke all on function public.gig_uchwala_generuj(uuid) from public;
grant execute on function public.gig_uchwala_generuj(uuid) to authenticated, service_role;

-- ── 7. Trigger: nowe zgłoszenie członkowskie → projekt uchwały ──
-- Pola czyta z treści, którą składa forms_integration.js (linie „Firma: …", „Adres: …",
-- „NIP: …", „Osoba reprezentująca: …"). Definer, bo formularz pisze jako anon.
create or replace function public.gig_uchwala_z_zgloszenia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m text := coalesce(NEW.message, ''); uid uuid;
  f text; a text; n text; r text; k text; o text;
begin
  if coalesce(NEW.subject, '') !~* '^Zgłoszenie członkowskie:' then return NEW; end if;
  f := nullif(nullif(trim(substring(m from 'Firma: ([^\n]*)')), ''), '—');
  a := nullif(nullif(trim(substring(m from 'Adres: ([^\n]*)')), ''), '—');
  n := nullif(nullif(trim(substring(m from 'NIP: ([^\n]*)')), ''), '—');
  r := nullif(nullif(trim(substring(m from 'REGON: ([^\n]*)')), ''), '—');
  k := nullif(nullif(trim(substring(m from 'KRS: ([^\n]*)')), ''), '—');
  o := nullif(nullif(trim(substring(m from 'Osoba reprezentująca: ([^\n]*)')), ''), '—');
  insert into public.uchwaly (zgloszenie_id, kandydat_osoba, kandydat_firma, kandydat_adres, kandydat_nip, kandydat_regon, kandydat_krs, kandydat_email)
  values (NEW.id, o, coalesce(f, NEW.name), a, n, r, k, NEW.email)
  returning id into uid;
  perform public.gig_uchwala_generuj(uid);
  return NEW;
end $$;

drop trigger if exists on_kontakt_uchwala on public.submissions_kontakt;
create trigger on_kontakt_uchwala
  after insert on public.submissions_kontakt
  for each row execute function public.gig_uchwala_z_zgloszenia();

-- ── 8. Skład Rady z maila z 17.09.2026 (dwa nazwiska do uzupełnienia w panelu) ──
insert into public.rada_izby (imie_nazwisko, email, funkcja, kolejnosc) values
  ('Rafał Kraska',                      'rafal.kraska@gig.org.pl',         'Prezes',        10),
  ('Jerzy Bryk',                        'jerzy.bryk@unimaptech.pl',        'Członek Rady',  20),
  ('Dariusz Tomaszewski',               'dariusz.tomaszewski@geoprzem.pl', 'Członek Rady',  30),
  ('Sławomir Zając',                    's.zajac@geoprof.pl',              'Członek Rady',  40),
  ('Maciej Kozielczyk',                 'maciej.kozielczyk@wp.pl',         'Członek Rady',  50),
  ('ZUGIK Pryzmat (uzupełnij nazwisko)', 'zugik@pryzmat.co',               'Członek Rady',  60),
  ('Zenon (uzupełnij nazwisko)',        'zbk.zenon@gmail.com',             'Członek Rady',  70),
  ('Sebastian Skalski',                 's.skalski@geokart.com.pl',        'Członek Rady',  80),
  ('Radosław Strzelecki',               'radstrz@gmail.com',               'Członek Rady',  90),
  ('Tomasz Soszka',                     'tomasz.soszka@geomap.pl',         'Członek Rady', 100)
on conflict (email) do nothing;

-- kontrola
select 'rada' as co, count(*) from public.rada_izby
union all select 'uchwaly', count(*) from public.uchwaly
union all select 'trigger', count(*) from pg_trigger where tgname = 'on_kontakt_uchwala';
