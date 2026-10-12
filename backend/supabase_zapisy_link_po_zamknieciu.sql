-- ============================================================
-- GIG: zapis mimo zamknięcia (12.10.2026)
-- Każde szkolenie może mieć tajny klucz (tabela szkolenia_klucze, widoczna tylko
-- w panelu). Link /zapisy/?szkolenie=<tytuł>&k=<klucz> otwiera formularz także po
-- zamknięciu zapisów, a trigger trg_zapis_zamkniete przepuszcza zapis z poprawnym
-- kluczem. Klucz nie zostaje w zgłoszeniu: trigger go zeruje i dopisuje notkę do uwag.
-- Panel: /admin/zapisy.html, przyciski „Link do zapisu” i „Dopisz zgłoszenie”.
-- ============================================================

create table if not exists public.szkolenia_klucze (
  szkolenie_id uuid primary key references public.szkolenia(id) on delete cascade,
  klucz        text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at   timestamptz not null default now()
);
alter table public.szkolenia_klucze enable row level security;
drop policy if exists "szk klucze admin" on public.szkolenia_klucze;
create policy "szk klucze admin" on public.szkolenia_klucze for all
  using (auth.role() = 'authenticated' and gig_sesja_2fa())
  with check (auth.role() = 'authenticated' and gig_sesja_2fa());

alter table public.zapisy_szkolenia add column if not exists klucz_zapisu text;

/* Strona /zapisy/ pyta, czy klucz z linku pasuje (sama tabela kluczy jest niewidoczna dla anon). */
create or replace function public.gig_klucz_zapisu_ok(p_szkolenie text, p_klucz text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(length(p_klucz) >= 16, false) and exists (
    select 1 from szkolenia s join szkolenia_klucze k on k.szkolenie_id = s.id
     where k.klucz = p_klucz and gig_klucz_szkolenia(s.title) = gig_klucz_szkolenia(p_szkolenie));
$$;
grant execute on function public.gig_klucz_zapisu_ok(text, text) to anon, authenticated;

create or replace function public.gig_zapis_sprawdz_zamkniete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  zamkniete boolean;
  z_kluczem boolean;
begin
  select bool_or(s.zapisy_zamkniete) into zamkniete
    from szkolenia s where gig_klucz_szkolenia(s.title) = gig_klucz_szkolenia(new.szkolenie);
  z_kluczem := new.klucz_zapisu is not null and gig_klucz_zapisu_ok(new.szkolenie, new.klucz_zapisu);
  new.klucz_zapisu := null;
  if coalesce(zamkniete, false) then
    if z_kluczem then
      new.uwagi := concat_ws(E'\n', nullif(new.uwagi, ''),
        '[' || to_char(now() at time zone 'Europe/Warsaw', 'DD.MM.YYYY') || '] Zapis z linku po zamknięciu zapisów na stronie.');
    elsif coalesce(auth.role(), '') = 'anon' then
      raise exception 'ZAPISY_ZAMKNIETE' using errcode = 'P0001',
        hint = 'Zapisy na to szkolenie są zamknięte.';
    end if;
  end if;
  return new;
end $$;
