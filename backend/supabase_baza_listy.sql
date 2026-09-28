-- =====================================================================
-- GIG: listy w Bazie e-mail (Członkowie GIG, Newsletter)
--
-- `baza_email.listy` to znaczniki niezależne od grupy: firma może być
-- jednocześnie w grupie „Firma”, na liście „Członkowie GIG” i „Newsletter”.
-- Panel filtruje po listach, więc „Wyślij e-mail” i „Kampania z filtra”
-- działają na nich bez zmian.
--
-- Synchronizacja robi się sama (triggery):
--   czlonkowie (status 'published', e-mail)  -> lista 'Członkowie GIG'
--   submissions_newsletter (poza wypisanymi) -> lista 'Newsletter'
-- Adres już obecny w bazie (email/email2/email3) dostaje znacznik, a puste
-- pola firmy są uzupełniane; niczego wypełnionego nie nadpisujemy.
-- Nowy adres trafia do bazy z pochodzeniem 'członkowie GIG' / 'newsletter'.
-- Wpisy usunięte w panelu (usuniety_panel) są pomijane.
-- Idempotentne: można uruchomić ponownie.
-- =====================================================================

alter table public.baza_email add column if not exists listy text[] not null default '{}';
create index if not exists idx_baza_email_listy on public.baza_email using gin (listy);

create or replace function public.gig_baza_dopisz(
  p_email text, p_lista text, p_pochodzenie text,
  p_firma text default null, p_osoba text default null, p_telefon text default null,
  p_adres text default null, p_www text default null, p_nip text default null,
  p_grupa text default null, p_rodzaj text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  n int;
begin
  if e is null or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  update baza_email b set
    listy     = case when p_lista = any(b.listy) then b.listy else b.listy || p_lista end,
    firma     = coalesce(nullif(b.firma, ''),   nullif(trim(p_firma), '')),
    osoba     = coalesce(nullif(b.osoba, ''),   nullif(trim(p_osoba), '')),
    telefon   = coalesce(nullif(b.telefon, ''), nullif(trim(p_telefon), '')),
    adres     = coalesce(nullif(b.adres, ''),   nullif(trim(p_adres), '')),
    www       = coalesce(nullif(b.www, ''),     nullif(trim(p_www), '')),
    nip       = coalesce(nullif(b.nip, ''),     nullif(trim(p_nip), '')),
    updated_at = now()
  where e in (lower(b.email), lower(b.email2), lower(b.email3));
  get diagnostics n = row_count;
  if n = 0 then
    insert into baza_email (email, listy, pochodzenie, grupa, rodzaj, firma, osoba, telefon, adres, www, nip, zrodlo)
    values (e, array[p_lista], p_pochodzenie, p_grupa, p_rodzaj,
            nullif(trim(p_firma), ''), nullif(trim(p_osoba), ''), nullif(trim(p_telefon), ''),
            nullif(trim(p_adres), ''), nullif(trim(p_www), ''), nullif(trim(p_nip), ''), p_pochodzenie)
    on conflict (email) do nothing;
  end if;
end $$;

create or replace function public.gig_baza_zdejmij(p_email text, p_lista text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if e is null then return; end if;
  update baza_email b set listy = array_remove(b.listy, p_lista), updated_at = now()
  where e in (lower(b.email), lower(b.email2), lower(b.email3)) and p_lista = any(b.listy);
end $$;

-- ── Członkowie ──────────────────────────────────────────────────────────
create or replace function public.gig_czlonkowie_do_bazy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- stary adres schodzi z listy, jeśli żaden opublikowany członek już go nie używa
  if tg_op in ('UPDATE', 'DELETE') and old.email is not null
     and not exists (select 1 from czlonkowie c where c.status = 'published'
                       and lower(trim(c.email)) = lower(trim(old.email))
                       and (tg_op = 'DELETE' or c.id <> old.id)
                       and not (tg_op = 'UPDATE' and c.id = new.id)) then
    if tg_op = 'DELETE' or new.status is distinct from 'published'
       or lower(trim(coalesce(new.email, ''))) <> lower(trim(old.email)) then
      perform gig_baza_zdejmij(old.email, 'Członkowie GIG');
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'published' and new.email is not null then
    perform gig_baza_dopisz(new.email, 'Członkowie GIG', 'członkowie GIG',
      new.name, new.person, new.phone, new.address, new.website, new.nip, 'Firma', 'geodezja');
  end if;
  return null;
end $$;

drop trigger if exists trg_czlonkowie_do_bazy on public.czlonkowie;
create trigger trg_czlonkowie_do_bazy
  after insert or update of status, email, name, person, phone, address, website, nip or delete
  on public.czlonkowie for each row execute function public.gig_czlonkowie_do_bazy();

-- ── Newsletter ──────────────────────────────────────────────────────────
create or replace function public.gig_newsletter_do_bazy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.status = 'unsubscribed' then
    if not exists (select 1 from submissions_newsletter n
                   where lower(trim(n.email)) = lower(trim(coalesce(new.email, old.email)))
                     and n.status is distinct from 'unsubscribed'
                     and n.id <> coalesce(new.id, old.id)) then
      perform gig_baza_zdejmij(coalesce(new.email, old.email), 'Newsletter');
    end if;
  else
    perform gig_baza_dopisz(new.email, 'Newsletter', 'newsletter');
  end if;
  return null;
end $$;

drop trigger if exists trg_newsletter_do_bazy on public.submissions_newsletter;
create trigger trg_newsletter_do_bazy
  after insert or update of status, email or delete
  on public.submissions_newsletter for each row execute function public.gig_newsletter_do_bazy();

revoke all on function public.gig_baza_dopisz(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.gig_baza_zdejmij(text,text) from public, anon, authenticated;

-- ── Wypełnienie z obecnych danych ───────────────────────────────────────
select public.gig_baza_dopisz(c.email, 'Członkowie GIG', 'członkowie GIG',
         c.name, c.person, c.phone, c.address, c.website, c.nip, 'Firma', 'geodezja')
from public.czlonkowie c where c.status = 'published' and c.email is not null;

select public.gig_baza_dopisz(n.email, 'Newsletter', 'newsletter')
from public.submissions_newsletter n where n.status is distinct from 'unsubscribed';

-- ── Uczestnicy szkoleń (zapisy_szkolenia) ───────────────────────────────
-- Zgłoszenie na szkolenie niesie komplet danych firmy (nabywca, NIP, telefon,
-- uczestnik), więc uzupełnia też adresy z newslettera, które zwykle pochodzą
-- z tego samego formularza. Grupa: JST wg znacznika, urzędy bez grupy, reszta Firma.
-- gig_baza_dopisz uzupełnia też pustą grupę i rodzaj (wypełnionych nie rusza).
create or replace function public.gig_baza_dopisz(
  p_email text, p_lista text, p_pochodzenie text,
  p_firma text default null, p_osoba text default null, p_telefon text default null,
  p_adres text default null, p_www text default null, p_nip text default null,
  p_grupa text default null, p_rodzaj text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  n int;
begin
  if e is null or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  update baza_email b set
    listy     = case when p_lista = any(b.listy) then b.listy else b.listy || p_lista end,
    firma     = coalesce(nullif(b.firma, ''),   nullif(trim(p_firma), '')),
    osoba     = coalesce(nullif(b.osoba, ''),   nullif(trim(p_osoba), '')),
    telefon   = coalesce(nullif(b.telefon, ''), nullif(trim(p_telefon), '')),
    adres     = coalesce(nullif(b.adres, ''),   nullif(trim(p_adres), '')),
    www       = coalesce(nullif(b.www, ''),     nullif(trim(p_www), '')),
    nip       = coalesce(nullif(b.nip, ''),     nullif(trim(p_nip), '')),
    grupa     = coalesce(nullif(b.grupa, ''),   nullif(trim(p_grupa), '')),
    rodzaj    = coalesce(nullif(b.rodzaj, ''),  nullif(trim(p_rodzaj), '')),
    updated_at = now()
  where e in (lower(b.email), lower(b.email2), lower(b.email3));
  get diagnostics n = row_count;
  if n = 0 then
    insert into baza_email (email, listy, pochodzenie, grupa, rodzaj, firma, osoba, telefon, adres, www, nip, zrodlo)
    values (e, array[p_lista], p_pochodzenie, p_grupa, p_rodzaj,
            nullif(trim(p_firma), ''), nullif(trim(p_osoba), ''), nullif(trim(p_telefon), ''),
            nullif(trim(p_adres), ''), nullif(trim(p_www), ''), nullif(trim(p_nip), ''), p_pochodzenie)
    on conflict (email) do nothing;
  end if;
end $$;

create or replace function public.gig_zapis_do_bazy(z public.zapisy_szkolenia)
returns void language plpgsql security definer set search_path = public as $$
declare
  osoba text;
  grupa text;
begin
  -- osoba tylko przy zgłoszeniu jednej osoby; dopiski w nawiasach odcinamy
  if coalesce(z.liczba_osob, 1) = 1 then
    osoba := nullif(trim(regexp_replace(split_part(split_part(coalesce(z.uczestnicy, ''), E'\n', 1), ',', 1), '\s*\(.*$', '')), '');
  end if;
  grupa := case
    when z.nabywca_jst then 'JST'
    when z.nabywca_nazwa ~* '(urz[aą]d|starostwo|powiat|gmina|ministerstw|inspektorat|wojew[oó]dz)' then null
    else 'Firma' end;
  perform gig_baza_dopisz(z.email, 'Uczestnicy szkoleń', 'zapisy na szkolenia',
    z.nabywca_nazwa, osoba, z.telefon, z.nabywca_adres, null, z.nabywca_nip, grupa, null);
end $$;

create or replace function public.gig_zapisy_do_bazy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.email is not null
     and (tg_op = 'DELETE' or lower(trim(coalesce(new.email, ''))) <> lower(trim(old.email)))
     and not exists (select 1 from zapisy_szkolenia z
                     where lower(trim(z.email)) = lower(trim(old.email)) and z.id <> old.id) then
    perform gig_baza_zdejmij(old.email, 'Uczestnicy szkoleń');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform gig_zapis_do_bazy(new);
  end if;
  return null;
end $$;

drop trigger if exists trg_zapisy_do_bazy on public.zapisy_szkolenia;
create trigger trg_zapisy_do_bazy
  after insert or update of email, nabywca_nazwa, nabywca_adres, nabywca_nip, nabywca_jst, telefon, uczestnicy or delete
  on public.zapisy_szkolenia for each row execute function public.gig_zapisy_do_bazy();

revoke all on function public.gig_zapis_do_bazy(public.zapisy_szkolenia) from public, anon, authenticated;

-- najnowsze zgłoszenie pierwsze: jego dane wygrywają przy uzupełnianiu pustych pól
select public.gig_zapis_do_bazy(z) from public.zapisy_szkolenia z order by z.created_at desc;
