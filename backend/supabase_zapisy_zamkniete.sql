-- Zamykanie zapisów na szkolenie (6.10.2026).
-- Panel /admin/szkolenia.html: checkbox „Zapisy zamknięte” (szkolenia.zapisy_zamkniete).
-- Strona: zamiast „Zapisz się” komunikat (szkolenia-render.js, prerender.mjs),
-- formularz /zapisy/ chowa się. Baza odrzuca zapis z anon (formularz), panel może dopisywać.

alter table public.szkolenia add column if not exists zapisy_zamkniete boolean not null default false;
comment on column public.szkolenia.zapisy_zamkniete is 'true = strona nie przyjmuje nowych zgłoszeń (przycisk ukryty, formularz /zapisy/ odrzuca zapis z anon)';

-- Ten sam klucz co kluczSzk w admin/zapisy.html: bez wielkości liter, jeden rodzaj myślnika, pojedyncze spacje.
create or replace function public.gig_klucz_szkolenia(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(t,'')), '[–—−]', '-', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.gig_zapis_sprawdz_zamkniete() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') = 'anon' and exists (
       select 1 from szkolenia s
        where s.zapisy_zamkniete
          and gig_klucz_szkolenia(s.title) = gig_klucz_szkolenia(new.szkolenie)) then
    raise exception 'ZAPISY_ZAMKNIETE' using errcode = 'P0001',
      hint = 'Zapisy na to szkolenie są zamknięte.';
  end if;
  return new;
end $$;

drop trigger if exists trg_zapis_zamkniete on public.zapisy_szkolenia;
create trigger trg_zapis_zamkniete before insert on public.zapisy_szkolenia
  for each row execute function public.gig_zapis_sprawdz_zamkniete();
