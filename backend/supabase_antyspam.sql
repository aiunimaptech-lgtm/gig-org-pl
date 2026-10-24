-- ============================================================
-- GIG: limity wpisów z formularzy publicznych (przegląd bezpieczeństwa 24.10.2026)
-- Tabele submissions_kontakt, submissions_newsletter, zapisy_szkolenia i wezel_ankiety
-- przyjmują INSERT od anon, a każdy wpis uruchamia mail z Resend. Bez limitu skrypt
-- mógłby wysłać tysiące zgłoszeń (zużycie limitu Resend, czarne listy, cudza treść
-- w potwierdzeniach). Trigger BEFORE INSERT liczy wpisy z ostatniej godziny i doby
-- na adres e-mail, na IP (z nagłówków PostgREST) i łącznie na tabelę, a nadmiar
-- odrzuca błędem ZA_DUZO_ZGLOSZEN. Zalogowany panel (authenticated) nie podlega limitom.
-- Pułapka na roboty i minimalny czas wypełniania są dodatkowo po stronie przeglądarki
-- (forms_integration.js, /zapisy/, /wezel-jakosci/); Edge Function firma-gus zapisuje tu
-- swoje wywołania (tabela = 'firma-gus') i ma własny limit na IP.
-- ============================================================

create table if not exists public.wpisy_limit (
  id         bigserial primary key,
  tabela     text not null,
  ip         text,
  email      text,
  created_at timestamptz not null default now()
);
create index if not exists wpisy_limit_tabela_czas on public.wpisy_limit(tabela, created_at);
create index if not exists wpisy_limit_ip on public.wpisy_limit(ip, created_at);
create index if not exists wpisy_limit_email on public.wpisy_limit(email, created_at);
alter table public.wpisy_limit enable row level security;
revoke all on public.wpisy_limit from anon, authenticated;

/* IP z nagłówków, które PostgREST wystawia w GUC request.headers (brama Supabase dokłada
   cf-connecting-ip / x-forwarded-for). Gdy brak, limit po IP nie działa, zostają pozostałe. */
create or replace function public.gig_ip_z_naglowkow()
returns text language plpgsql stable as $$
declare h jsonb; ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then return null; end;
  if h is null then return null; end if;
  ip := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(h->>'x-forwarded-for', ',', 1));
  return nullif(left(trim(ip), 60), '');
end $$;

create or replace function public.gig_limit_wpisow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ip text;
  v_em text;
  n_email_h int; n_email_d int; n_ip_h int; n_ip_d int; n_all_h int;
  lim_email_h int := 3;  lim_email_d int := 10;
  lim_ip_h    int := 12; lim_ip_d    int := 40;
  lim_all_h   int := 300;
begin
  -- limity tylko dla wpisów z zewnątrz; panel i funkcje serwerowe bez ograniczeń
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;

  v_ip := gig_ip_z_naglowkow();
  v_em := lower(trim(coalesce(new.email, '')));

  select count(*) filter (where w.email = v_em and w.created_at > now() - interval '1 hour'),
         count(*) filter (where w.email = v_em),
         count(*) filter (where v_ip is not null and w.ip = v_ip and w.created_at > now() - interval '1 hour'),
         count(*) filter (where v_ip is not null and w.ip = v_ip),
         count(*) filter (where w.created_at > now() - interval '1 hour')
    into n_email_h, n_email_d, n_ip_h, n_ip_d, n_all_h
    from wpisy_limit w
   where w.tabela = TG_TABLE_NAME and w.created_at > now() - interval '24 hours';

  if (v_em <> '' and (n_email_h >= lim_email_h or n_email_d >= lim_email_d))
     or (v_ip is not null and (n_ip_h >= lim_ip_h or n_ip_d >= lim_ip_d))
     or n_all_h >= lim_all_h then
    raise exception 'ZA_DUZO_ZGLOSZEN' using errcode = 'P0001',
      hint = 'Zbyt wiele zgłoszeń z tego adresu. Spróbuj później albo napisz na biuro@gig.org.pl.';
  end if;

  insert into wpisy_limit (tabela, ip, email) values (TG_TABLE_NAME, v_ip, nullif(v_em, ''));
  -- porządki przy okazji: stare wpisy nie są już potrzebne
  if random() < 0.02 then delete from wpisy_limit where created_at < now() - interval '2 days'; end if;
  return new;
end $$;

drop trigger if exists trg_limit_kontakt on public.submissions_kontakt;
create trigger trg_limit_kontakt before insert on public.submissions_kontakt
  for each row execute function public.gig_limit_wpisow();
drop trigger if exists trg_limit_newsletter on public.submissions_newsletter;
create trigger trg_limit_newsletter before insert on public.submissions_newsletter
  for each row execute function public.gig_limit_wpisow();
drop trigger if exists trg_limit_zapisy on public.zapisy_szkolenia;
create trigger trg_limit_zapisy before insert on public.zapisy_szkolenia
  for each row execute function public.gig_limit_wpisow();
drop trigger if exists trg_limit_wezel on public.wezel_ankiety;
create trigger trg_limit_wezel before insert on public.wezel_ankiety
  for each row execute function public.gig_limit_wpisow();

/* Limit dla Edge Function firma-gus (service_role): ile zapytań o NIP z jednego IP w ciągu godziny
   i łącznie w ciągu doby. Zwraca true, gdy wolno, i od razu rejestruje wywołanie. */
create or replace function public.gig_gus_limit(p_ip text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n_ip int; n_all int;
begin
  select count(*) filter (where ip = p_ip and created_at > now() - interval '1 hour'),
         count(*)
    into n_ip, n_all
    from wpisy_limit where tabela = 'firma-gus' and created_at > now() - interval '24 hours';
  if (p_ip is not null and n_ip >= 20) or n_all >= 600 then return false; end if;
  insert into wpisy_limit (tabela, ip) values ('firma-gus', p_ip);
  return true;
end $$;
revoke execute on function public.gig_gus_limit(text) from anon, authenticated;
revoke execute on function public.gig_limit_wpisow() from anon, authenticated;
