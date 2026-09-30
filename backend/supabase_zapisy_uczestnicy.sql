-- ============================================================
-- GIG: prośba o listę uczestników (Edge Function zapis-uczestnicy, strona /uczestnicy/)
-- Zastosowane 30.09.2026 jako migracje zapisy_prosba_o_uczestnikow + zapisy_prosba_ochrona_insert.
-- Idempotentne.
-- ============================================================

alter table public.zapisy_szkolenia
  add column if not exists uczestnicy_token text,
  add column if not exists uczestnicy_prosba_at timestamptz,
  add column if not exists uczestnicy_uzupelnione_at timestamptz,
  add column if not exists uczestnicy_historia jsonb not null default '[]'::jsonb;
create unique index if not exists zapisy_szkolenia_uczestnicy_token_uq
  on public.zapisy_szkolenia (uczestnicy_token) where uczestnicy_token is not null;
comment on column public.zapisy_szkolenia.uczestnicy_token is
  'Osobisty token linku /uczestnicy/?t= (formularz listy uczestnikow dla organizacji). Czyta go tylko Edge Function zapis-uczestnicy (service_role).';
comment on column public.zapisy_szkolenia.uczestnicy_historia is
  'Poprzednie wersje listy uczestnikow zapisane przez organizacje z formularza: [{at, liczba_osob, uczestnicy, uczestnicy_lista}]';

-- Publiczny formularz /zapisy/ może wstawiać wiersze (polityka "zap public insert").
-- Pola prośby ustawia wyłącznie Edge Function (service_role), więc przy INSERT zawsze je czyścimy:
-- nikt nie wstawi zgłoszenia z własnym tokenem ani z oznaczeniem "prośba wysłana" / "lista przesłana".
create or replace function public.gig_zapis_czysc_pola_prosby()
returns trigger language plpgsql set search_path = public as $$
begin
  new.uczestnicy_token := null;
  new.uczestnicy_prosba_at := null;
  new.uczestnicy_uzupelnione_at := null;
  new.uczestnicy_historia := '[]'::jsonb;
  return new;
end $$;
drop trigger if exists trg_zapis_czysc_prosbe on public.zapisy_szkolenia;
create trigger trg_zapis_czysc_prosbe before insert on public.zapisy_szkolenia
  for each row execute function public.gig_zapis_czysc_pola_prosby();
revoke execute on function public.gig_zapis_czysc_pola_prosby() from public, anon, authenticated;

-- Jednorazowość (w Edge Function):
--   prośba:     update ... set uczestnicy_prosba_at = now() where id = $1 and uczestnicy_prosba_at is null returning ...
--               (0 wierszy = już wysłana; nieudana wysyłka zwalnia rezerwację)
--   formularz:  update ... where id = $1 and uczestnicy_uzupelnione_at is null and status <> 'cancelled' returning id
