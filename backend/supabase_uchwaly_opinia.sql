-- ============================================================
-- GIG — procedura przyjęcia członka w dwóch etapach (art. 12 pkt 1 Statutu)
--
-- Statut, art. 12 pkt 1: „Uchwała w sprawie przyjęcia przedsiębiorcy w poczet
-- członków Izby zostaje podjęta PO POZYTYWNYM ZAOPINIOWANIU kandydatury przez
-- Prezydium Rady Izby. Przed wydaniem opinii Prezydium konsultuje się z właściwym
-- Prezesem Oddziału Izby lub Przedstawicielem Regionalnym. (…) Decyzję o odmowie
-- przyjęcia przedsiębiorcy w poczet członków Izby Rada Izby podejmuje w formie
-- uchwały." Art. 12 pkt 3: od uchwały odmownej służy odwołanie do Walnego
-- Zgromadzenia w terminie 30 dni.
--
-- Dotąd panel obsługiwał tylko etap drugi (uchwała Rady). Tutaj dokładamy etap
-- pierwszy: prośbę do Prezydium o zaopiniowanie kandydata (wzór: mail sekretariatu
-- z 17.09.2026) wraz z głosowaniem pozytywna/negatywna, i dopiero po pozytywnej
-- opinii odblokowujemy projekt uchwały Rady.
--
--   zgłoszenie ze strony  →  opiniowanie / projekt      (draft prośby do Prezydium)
--                         →  opiniowanie / głosowanie   (Prezydium opiniuje z maila)
--                         →  opinia pozytywna  →  projekt uchwały  →  głosowanie Rady
--                                                                  →  przyjęta / odrzucona
--                         →  opinia negatywna  →  uchwała o odmowie albo zamknięcie sprawy
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration). Idempotentne.
-- Wymaga wcześniejszego supabase_uchwaly.sql.
-- Wdrożone jako migracje: uchwaly_etap_opiniowania_prezydium,
-- uchwaly_generator_dwuetapowy, uchwaly_rodzaj_odmowa,
-- przedstawiciele_regionalni_wojewodztwa.
-- ============================================================

-- ── 1. Rada Izby: kto jest w Prezydium, kto w Radzie, kogo pytamy o konsultację ──
-- Prezydium = Prezes + 3 Wiceprezesów (art. 19 ust. 4) i to ono opiniuje.
-- Rada = Prezes + Prezesi Oddziałów + osoby wybrane przez Walne (art. 19 ust. 1);
-- Prezes jest w obu, więc dwa niezależne znaczniki, a nie jedno pole „rola".
-- Przedstawiciel Regionalny nie jest członkiem Rady, ale bywa konsultowany.
alter table public.rada_izby add column if not exists prezydium boolean not null default false;
alter table public.rada_izby add column if not exists rada      boolean not null default true;
alter table public.rada_izby add column if not exists region    text;

-- ── 2. Uchwały: etap opiniowania, rodzaj rozstrzygnięcia, dokumenty i wpisowe ──
alter table public.uchwaly add column if not exists opinia_status      text not null default 'projekt';
alter table public.uchwaly add column if not exists opinia_termin      date;
alter table public.uchwaly add column if not exists opinia_mail_temat  text not null default '';
alter table public.uchwaly add column if not exists opinia_mail_tresc  text not null default '';
alter table public.uchwaly add column if not exists opinia_wyslano_at  timestamptz;
alter table public.uchwaly add column if not exists opinia_wyslal      text;
alter table public.uchwaly add column if not exists opinia_zamknieto_at timestamptz;
alter table public.uchwaly add column if not exists opinia_zamknal     text;
alter table public.uchwaly add column if not exists opinia_za          int;
alter table public.uchwaly add column if not exists opinia_przeciw     int;
alter table public.uchwaly add column if not exists opinia_uwagi       text;
-- konsultacja wymagana przez art. 12 pkt 1 zdanie trzecie
alter table public.uchwaly add column if not exists konsultacja_kto    text;
alter table public.uchwaly add column if not exists konsultacja_at     date;
alter table public.uchwaly add column if not exists konsultacja_opinia text;
-- dokument statusowy (art. 12 pkt 1 zdanie pierwsze) i wpisowe (zdanie czwarte)
alter table public.uchwaly add column if not exists dok_rodzaj         text;
alter table public.uchwaly add column if not exists dok_otrzymany_at   date;
alter table public.uchwaly add column if not exists wpisowe_oplacone   boolean not null default false;
alter table public.uchwaly add column if not exists wpisowe_at         date;
-- dane z deklaracji, żeby Prezydium widziało kandydata bez zaglądania do zgłoszenia
alter table public.uchwaly add column if not exists kandydat_telefon   text;
alter table public.uchwaly add column if not exists kandydat_www       text;
alter table public.uchwaly add column if not exists kandydat_opis      text;
alter table public.uchwaly add column if not exists kandydat_pkd       text;
alter table public.uchwaly add column if not exists kandydat_osob      text;
-- uchwała o przyjęciu albo o odmowie (art. 12 pkt 1 zdanie ostatnie)
alter table public.uchwaly add column if not exists rodzaj text not null default 'przyjecie';

do $$ begin
  alter table public.uchwaly add constraint uchwaly_opinia_status_chk
    check (opinia_status in ('projekt','glosowanie','pozytywna','negatywna','pominieta'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.uchwaly add constraint uchwaly_dok_rodzaj_chk
    check (dok_rodzaj is null or dok_rodzaj in ('ceidg','krs','inny'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.uchwaly add constraint uchwaly_rodzaj_chk
    check (rodzaj in ('przyjecie','odmowa'));
exception when duplicate_object then null; end $$;

-- status główny: dokładamy 'opiniowanie' przed 'projekt'
alter table public.uchwaly drop constraint if exists uchwaly_status_check;
alter table public.uchwaly add constraint uchwaly_status_check
  check (status in ('opiniowanie','projekt','glosowanie','przyjeta','odrzucona','anulowana'));
alter table public.uchwaly alter column status set default 'opiniowanie';

-- Uchwały sprzed tej zmiany szły starą drogą (opinia poza systemem) — żeby panel
-- nie kazał ich teraz opiniować od nowa, oznaczamy je jako opinię pominiętą.
update public.uchwaly
   set opinia_status = 'pominieta',
       opinia_uwagi  = coalesce(opinia_uwagi, 'Sprawa prowadzona przed wdrożeniem etapu opiniowania w panelu.')
 where opinia_status = 'projekt' and status <> 'opiniowanie';

-- ── 3. Głosy: ten sam mechanizm tokenów obsługuje oba etapy ──
alter table public.uchwaly_glosy add column if not exists etap text not null default 'uchwala';
alter table public.uchwaly_glosy add column if not exists rola text;

do $$ begin
  alter table public.uchwaly_glosy add constraint uchwaly_glosy_etap_chk
    check (etap in ('opinia','uchwala'));
exception when duplicate_object then null; end $$;

-- jedna osoba może wystąpić dwa razy przy tej samej sprawie: raz opiniując, raz głosując
alter table public.uchwaly_glosy drop constraint if exists uchwaly_glosy_uchwala_id_email_key;
do $$ begin
  alter table public.uchwaly_glosy add constraint uchwaly_glosy_uchwala_email_etap_key
    unique (uchwala_id, email, etap);
exception when duplicate_object then null; end $$;
create index if not exists uchwaly_glosy_etap_idx on public.uchwaly_glosy(uchwala_id, etap);

-- ── 4. Pomocnicze formy gramatyczne ──
-- Imiesłów „prowadzący" odmienia się inaczej w dopełniaczu (uchwała: „przedsiębiorcy
-- Pani Dagmary Kępy prowadzącej działalność") niż w bierniku (prośba o opinię:
-- „przez przedsiębiorcę Panią Dagmarę Kępę prowadzącą działalność").
create or replace function public.gig_prowadzacy(plec text, przypadek text) returns text
language sql immutable as $$
  select case when plec = 'f'
    then case when przypadek = 'biernik' then 'prowadzącą' else 'prowadzącej' end
    else 'prowadzącego' end
$$;

-- ── 5. Generator: prośba o opinię + uchwała (o przyjęciu albo o odmowie) + mail do Rady ──
create or replace function public.gig_uchwala_generuj(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u record; osoba text; osoba_dop text; osoba_bier text; plec text; pana text; pania text;
  spolka boolean; opis_dop text; opis_bier text; ident text; etykieta text; kogo text;
  tresc_u text; mail_t text; mail_s text; op_t text; op_s text;
  termin text; zd_dok text; zd_wpis text; zd_opinia text; odmowa boolean;
begin
  select * into u from public.uchwaly where id = uid;
  if not found then return; end if;
  odmowa := u.rodzaj = 'odmowa';

  osoba      := coalesce(nullif(trim(u.kandydat_osoba), ''), '(imię i nazwisko)');
  plec       := public.gig_plec(osoba);
  pana       := case when plec = 'f' then 'Pani' else 'Pana' end;    -- dopełniacz
  pania      := case when plec = 'f' then 'Panią' else 'Pana' end;   -- biernik
  osoba_dop  := public.gig_dopelniacz(osoba);
  osoba_bier := public.gig_biernik(osoba, plec);
  spolka     := coalesce(u.kandydat_firma, '') ~* '(sp\.? ?z ?o\.? ?o|spółk|s\.a\.|sp\. ?j\.|sp\. ?k\.|s\.k\.a)';

  ident := concat_ws(', ',
    case when nullif(trim(u.kandydat_nip),   '') is not null then 'NIP '   || trim(u.kandydat_nip)   end,
    case when nullif(trim(u.kandydat_regon), '') is not null then 'REGON ' || trim(u.kandydat_regon) end,
    case when nullif(trim(u.kandydat_krs),   '') is not null then 'KRS '   || trim(u.kandydat_krs)   end);
  ident := case when ident <> '' then ' (' || ident || ')' else '' end;

  if spolka then
    opis_dop := format('przedsiębiorcy %s z siedzibą %s%s, reprezentowanego przez %s %s',
                  coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident, pania, osoba_bier);
    opis_bier := format('przedsiębiorcę %s z siedzibą %s%s, reprezentowanego przez %s %s',
                  coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident, pania, osoba_bier);
    kogo := coalesce(u.kandydat_firma, '(nazwa firmy)');
  else
    opis_dop := format('przedsiębiorcy %s %s %s działalność gospodarczą o nazwie: %s z siedzibą %s%s',
                  pana, osoba_dop, public.gig_prowadzacy(plec, 'dopelniacz'),
                  coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident);
    opis_bier := format('przedsiębiorcę %s %s %s działalność gospodarczą o nazwie: %s z siedzibą %s%s',
                  pania, osoba_bier, public.gig_prowadzacy(plec, 'biernik'),
                  coalesce(u.kandydat_firma, '(nazwa firmy)'), coalesce(u.kandydat_adres, '(adres)'), ident);
    kogo := pana || ' ' || osoba_dop;
  end if;

  etykieta := coalesce(nullif(trim(u.numer), ''), '...') || '/' ||
              public.gig_miesiac_rzymski(u.data_wejscia) || '/' || extract(year from u.data_wejscia)::int;

  termin := case when u.opinia_termin is not null
                 then 'do dnia ' || public.gig_data_pl(u.opinia_termin)
                 else 'w terminie 7 dni' end;

  zd_dok := case u.dok_rodzaj
              when 'ceidg' then 'Wydruk z CEIDG wpłynął do biura Izby.'
              when 'krs'   then 'Odpis z rejestru przedsiębiorców KRS wpłynął do biura Izby.'
              when 'inny'  then 'Dokument potwierdzający status prawny przedsiębiorcy wpłynął do biura Izby.'
              else 'Na wydruk z CEIDG lub odpis z KRS biuro Izby jeszcze czeka.' end;

  zd_wpis := case when u.wpisowe_oplacone
                  then 'Wpisowe zostało już uiszczone.'
                  else 'Wpisowe nie wpłynęło jeszcze na konto Izby.' end;

  -- ── etap 1: prośba do Prezydium o zaopiniowanie (wzór: mail sekretariatu) ──
  op_t := 'Prośba o zaopiniowanie kandydata do GIG: ' || kogo;
  op_s :=
    'Prezydium Rady GIG,' || E'\n\n' ||
    'w związku ze złożonym akcesem członkowskim przez ' || opis_bier ||
    ' prosimy o zaopiniowanie kandydata ' || termin || ', zgodnie z art. 12 pkt 1 Statutu Izby.' || E'\n\n' ||
    'Poniżej dane z deklaracji przystąpienia do GIG. ' || zd_dok || ' ' || zd_wpis || E'\n\n' ||
    'Opinię można wydać jednym kliknięciem: przyciski „Opiniuję pozytywnie" i „Opiniuję negatywnie" pod danymi ' ||
    'kandydata prowadzą na stronę, na której można też wpisać uzasadnienie. Link jest osobisty, prosimy nie przekazywać go dalej.' || E'\n\n' ||
    'Z wyrazami szacunku' || E'\n' || 'Agnieszka Horbaczewska' || E'\n' || 'Sekretariat Geodezyjnej Izby Gospodarczej';

  -- ── etap 2: uchwała Rady; w podstawie prawnej powołujemy opinię Prezydium ──
  zd_opinia := case
    when u.opinia_status = 'pozytywna' then ', po pozytywnym zaopiniowaniu kandydatury przez Prezydium Rady Izby' ||
         coalesce(' w dniu ' || public.gig_data_pl(u.opinia_zamknieto_at::date), '') || ','
    when u.opinia_status = 'negatywna' then ', po negatywnym zaopiniowaniu kandydatury przez Prezydium Rady Izby' ||
         coalesce(' w dniu ' || public.gig_data_pl(u.opinia_zamknieto_at::date), '') || ','
    else '' end;

  if odmowa then
    tresc_u :=
      'Uchwała nr ' || etykieta || ' Rady Geodezyjnej Izby Gospodarczej' || E'\n\n' ||
      '§ 1' || E'\n' ||
      'Rada Izby działając na podstawie art. 12 pkt 1 i art. 21 pkt 2 Statutu GIG oraz § 4 Regulaminu Pracy Rady GIG' ||
      zd_opinia || ' postanawia o odmowie przyjęcia do Geodezyjnej Izby Gospodarczej ' || opis_dop || '.' || E'\n\n' ||
      '§ 2' || E'\n' ||
      'Od niniejszej uchwały przysługuje odwołanie do Walnego Zgromadzenia w terminie 30 dni od daty jej otrzymania ' ||
      '(art. 12 pkt 3 Statutu Izby). Do czasu rozpoznania odwołania zaskarżona uchwała nie wchodzi w życie.' || E'\n\n' ||
      '§ 3' || E'\n' ||
      'Uchwała wchodzi w życie z dniem ' || public.gig_data_pl(u.data_wejscia) || E'\n\n\n' ||
      'Prezes' || E'\n' || 'Geodezyjnej Izby Gospodarczej' || E'\n' || 'Rafał Kraska';
    mail_t := 'Prośba o podjęcie uchwały: odmowa przyjęcia do GIG ' || kogo;
    mail_s :=
      'Szanowni Członkowie Rady GIG,' || E'\n\n' ||
      'Z upoważnienia Pana Prezesa Rafała Kraski przesyłam poniżej projekt uchwały w sprawie odmowy przyjęcia ' ||
      'do Geodezyjnej Izby Gospodarczej ' || opis_dop || ', z uprzejmą prośbą o jej podjęcie.' || E'\n\n' ||
      case when u.opinia_status = 'negatywna'
        then 'Kandydatura została negatywnie zaopiniowana przez Prezydium Rady Izby' ||
             coalesce(' w dniu ' || public.gig_data_pl(u.opinia_zamknieto_at::date), '') ||
             ', zgodnie z art. 12 pkt 1 Statutu Izby.' || E'\n\n'
        else '' end ||
      'Głos można oddać jednym kliknięciem: przyciski „Głosuję ZA" i „Głosuję PRZECIW" pod treścią uchwały ' ||
      'prowadzą na stronę, na której można też wpisać uzasadnienie. Link jest osobisty, prosimy nie przekazywać go dalej.' || E'\n\n' ||
      'Z wyrazami szacunku' || E'\n' || 'Agnieszka Horbaczewska' || E'\n' || 'Sekretariat Geodezyjnej Izby Gospodarczej';
  else
    tresc_u :=
      'Uchwała nr ' || etykieta || ' Rady Geodezyjnej Izby Gospodarczej' || E'\n\n' ||
      '§ 1' || E'\n' ||
      'Rada Izby działając na podstawie art. 12 pkt 1 i art. 21 pkt 2 Statutu GIG oraz § 4 Regulaminu Pracy Rady GIG' ||
      zd_opinia || ' postanawia o przyjęciu do Geodezyjnej Izby Gospodarczej ' || opis_dop || '.' || E'\n\n' ||
      '§ 2' || E'\n' ||
      'Uchwała wchodzi w życie z dniem ' || public.gig_data_pl(u.data_wejscia) ||
      ', pod warunkiem uiszczenia przez przedsiębiorcę opłaty wpisowej.' || E'\n\n\n' ||
      'Prezes' || E'\n' || 'Geodezyjnej Izby Gospodarczej' || E'\n' || 'Rafał Kraska';
    mail_t := 'Prośba o podjęcie uchwały: przyjęcie do GIG ' || kogo;
    mail_s :=
      'Szanowni Członkowie Rady GIG,' || E'\n\n' ||
      'Z upoważnienia Pana Prezesa Rafała Kraski przesyłam poniżej projekt uchwały w sprawie przyjęcia ' ||
      'do Geodezyjnej Izby Gospodarczej ' || opis_dop || ', z uprzejmą prośbą o jej podjęcie.' || E'\n\n' ||
      case when u.opinia_status = 'pozytywna'
        then 'Kandydatura została pozytywnie zaopiniowana przez Prezydium Rady Izby' ||
             coalesce(' w dniu ' || public.gig_data_pl(u.opinia_zamknieto_at::date), '') ||
             ', zgodnie z art. 12 pkt 1 Statutu Izby. ' || zd_wpis || E'\n\n'
        else zd_dok || ' ' || zd_wpis || E'\n\n' end ||
      'Głos można oddać jednym kliknięciem: przyciski „Głosuję ZA" i „Głosuję PRZECIW" pod treścią uchwały ' ||
      'prowadzą na stronę, na której można też wpisać uzasadnienie. Link jest osobisty, prosimy nie przekazywać go dalej.' || E'\n\n' ||
      'Z wyrazami szacunku' || E'\n' || 'Agnieszka Horbaczewska' || E'\n' || 'Sekretariat Geodezyjnej Izby Gospodarczej';
  end if;

  update public.uchwaly
     set tresc = tresc_u, mail_temat = mail_t, mail_tresc = mail_s,
         opinia_mail_temat = op_t, opinia_mail_tresc = op_s, updated_at = now()
   where id = uid;
end $$;

revoke all on function public.gig_uchwala_generuj(uuid) from public;
grant execute on function public.gig_uchwala_generuj(uuid) to authenticated, service_role;

-- ── 6. Trigger: nowe zgłoszenie → sprawa na etapie opiniowania ──
create or replace function public.gig_uchwala_z_zgloszenia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m text := coalesce(NEW.message, ''); uid uuid;
  f text; a text; n text; r text; k text; o text; t text; w text; d text; p text; il text; woj text;
begin
  if coalesce(NEW.subject, '') !~* '^Zgłoszenie członkowskie:' then return NEW; end if;
  f   := nullif(nullif(trim(substring(m from 'Firma: ([^\n]*)')), ''), '—');
  a   := nullif(nullif(trim(substring(m from 'Adres: ([^\n]*)')), ''), '—');
  n   := nullif(nullif(trim(substring(m from 'NIP: ([^\n]*)')), ''), '—');
  r   := nullif(nullif(trim(substring(m from 'REGON: ([^\n]*)')), ''), '—');
  k   := nullif(nullif(trim(substring(m from 'KRS: ([^\n]*)')), ''), '—');
  o   := nullif(nullif(trim(substring(m from 'Osoba reprezentująca: ([^\n]*)')), ''), '—');
  t   := nullif(nullif(trim(substring(m from 'Telefon: ([^\n]*)')), ''), '—');
  w   := nullif(nullif(trim(substring(m from 'WWW: ([^\n]*)')), ''), '—');
  d   := nullif(nullif(trim(substring(m from 'Opis: ([^\n]*)')), ''), '—');
  p   := nullif(nullif(trim(substring(m from 'Profil działalności: ([^\n]*)')), ''), '—');
  il  := nullif(nullif(trim(substring(m from 'Liczba osób w firmie: ([^\n]*)')), ''), '—');
  -- po województwie panel dobiera właściwego Przedstawiciela Regionalnego do konsultacji
  woj := lower(nullif(nullif(trim(substring(m from 'Województwo: ([^\n]*)')), ''), '—'));
  insert into public.uchwaly (zgloszenie_id, kandydat_osoba, kandydat_firma, kandydat_adres,
                              kandydat_nip, kandydat_regon, kandydat_krs, kandydat_email,
                              kandydat_telefon, kandydat_www, kandydat_opis, kandydat_pkd, kandydat_osob,
                              kandydat_wojewodztwo, status, opinia_status, opinia_termin)
  values (NEW.id, o, coalesce(f, NEW.name), a, n, r, k, NEW.email, t, w, d, p, il, woj,
          'opiniowanie', 'projekt', current_date + 7)
  returning id into uid;
  perform public.gig_uchwala_generuj(uid);
  return NEW;
end $$;

-- ── 7. Prezydium: Prezes + Wiceprezesi (art. 19 ust. 3 i 4). Skład do potwierdzenia w panelu. ──
update public.rada_izby set prezydium = true
 where lower(coalesce(funkcja, '')) like '%prezes%'
   and lower(coalesce(funkcja, '')) not like '%oddzia%';

-- ── 8. Przedstawiciele Regionalni: partnerzy konsultacji z art. 12 pkt 1 zd. trzeciego ──
-- Izba nie ma obecnie Oddziałów, więc „właściwym" partnerem konsultacji jest zawsze
-- Przedstawiciel Regionalny. Żaden z nich nie jest członkiem Rady (art. 19 ust. 1);
-- w obradach bierze udział z głosem doradczym po imiennym zaproszeniu (art. 20 ust. 4),
-- stąd `rada = false`: nie dostaje uchwały do głosowania, tylko bywa pytany o opinię.
-- Zasięg trzymamy wprost przy osobie, nazwami z listy rozwijanej formularza „Dołącz do nas",
-- bo po nich panel dopasowuje przedstawiciela do województwa kandydata.
-- Skład wg „Spis tel.-Członkowie Organów GIG IX Kadencja".
alter table public.rada_izby add column if not exists wojewodztwa text[];
alter table public.uchwaly  add column if not exists kandydat_wojewodztwo text;

insert into public.rada_izby (imie_nazwisko, email, funkcja, region, wojewodztwa, prezydium, rada, aktywny, kolejnosc)
values
  ('Dawid Sienkiewicz', 'dawid.sienkiewicz@gig.org.pl', 'Przedstawiciel Regionalny',
   'Region Południowy', array['śląskie','dolnośląskie','opolskie'], false, false, true, 110),
  ('Daniel Ruszała', 'daniel.ruszala@gig.org.pl', 'Przedstawiciel Regionalny',
   'Region Południowo-Wschodni', array['podkarpackie','łódzkie','świętokrzyskie','małopolskie'], false, false, true, 120)
on conflict (email) do update
  set imie_nazwisko = excluded.imie_nazwisko, funkcja = excluded.funkcja, region = excluded.region,
      wojewodztwa = excluded.wojewodztwa, prezydium = excluded.prezydium, rada = excluded.rada,
      aktywny = excluded.aktywny, kolejnosc = excluded.kolejnosc;

-- kontrola
select 'rada'            as co, count(*)::text from public.rada_izby
union all select 'w prezydium', count(*)::text from public.rada_izby where prezydium
union all select 'uchwaly',     count(*)::text from public.uchwaly
union all select 'opiniowanie', count(*)::text from public.uchwaly where status = 'opiniowanie';
