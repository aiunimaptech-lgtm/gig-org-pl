-- ============================================================
-- GIG — KAMPANIE MAILOWE (panel → zakładka „Wysyłki")
--
-- Po co: wysyłka do kilku tysięcy adresów nie zmieści się w jednym wywołaniu
-- Edge Function (limit czasu), a przerwana wysyłka bez kolejki oznacza dublety.
-- Dlatego kampania ma własną KOLEJKĘ: jeden wiersz na adres, ze statusem.
-- Funkcja `wyslij-kampanie` bierze porcję, wysyła batchem Resend (100/żądanie)
-- i zapisuje wynik — panel woła ją w pętli, aż zostanie 0.
--
-- `limit_dzienny` = rozgrzewka domeny. Funkcja nigdy nie wyśle dziś więcej.
-- Nowa domena: 200 → 500 → 1000 → 2000 co kilka dni.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration z MCP). Idempotentne.
-- ============================================================

create table if not exists public.wysylki (
  id            uuid primary key default gen_random_uuid(),
  temat         text not null,
  html          text not null,                -- treść z edytora (ramkę GIG dokłada funkcja)
  opis_filtra   text,                         -- z jakiego segmentu Bazy e-mail powstała
  status        text default 'robocza' check (status in ('robocza','w_toku','wstrzymana','zakonczona')),
  limit_dzienny integer default 200 check (limit_dzienny between 1 and 20000),
  utworzyl      text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- UNIQUE(wysylka_id, email) to gwarancja, że nikt nie dostanie maila dwa razy,
-- nawet gdy wysyłka zostanie przerwana i wznowiona.
create table if not exists public.wysylki_odbiorcy (
  id            uuid primary key default gen_random_uuid(),
  wysylka_id    uuid not null references public.wysylki(id) on delete cascade,
  baza_email_id uuid,                         -- do indywidualnego linku wypisu (baza-wypis)
  email         text not null,
  status        text default 'czeka' check (status in ('czeka','wyslany','blad')),
  blad          text,
  wyslano_at    timestamptz,
  unique (wysylka_id, email)
);
create index if not exists idx_wys_odb_kolejka on public.wysylki_odbiorcy (wysylka_id, status);
create index if not exists idx_wys_odb_dzis on public.wysylki_odbiorcy (wysylka_id, wyslano_at);

alter table public.wysylki          enable row level security;
alter table public.wysylki_odbiorcy enable row level security;
drop policy if exists "wys admin all" on public.wysylki;
create policy "wys admin all" on public.wysylki
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "wys odb admin all" on public.wysylki_odbiorcy;
create policy "wys odb admin all" on public.wysylki_odbiorcy
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Postęp kampanii jednym zapytaniem (security_invoker: RLS jak dla pytającego).
create or replace view public.wysylki_postep with (security_invoker = true) as
select w.id, w.temat, w.opis_filtra, w.status, w.limit_dzienny, w.utworzyl, w.created_at, w.updated_at,
       count(o.*)                                                              as razem,
       count(o.*) filter (where o.status = 'wyslany')                          as wyslane,
       count(o.*) filter (where o.status = 'blad')                             as bledy,
       count(o.*) filter (where o.status = 'czeka')                            as czeka,
       count(o.*) filter (where o.status = 'wyslany'
                            and o.wyslano_at >= date_trunc('day', now()))      as wyslane_dzis
from public.wysylki w
left join public.wysylki_odbiorcy o on o.wysylka_id = w.id
group by w.id;

-- ── PRZYDATNE ZAPYTANIA ───────────────────────────────────────────────────
-- Postęp wszystkich kampanii:
--   select temat, status, wyslane, razem, bledy, czeka, wyslane_dzis, limit_dzienny
--   from wysylki_postep order by created_at desc;
--
-- Adresy z błędem w kampanii (np. do ręcznej weryfikacji):
--   select email, blad from wysylki_odbiorcy where wysylka_id = '<uuid>' and status = 'blad';
--
-- Ponowna próba dla błędnych (wróci do kolejki):
--   update wysylki_odbiorcy set status = 'czeka', blad = null
--   where wysylka_id = '<uuid>' and status = 'blad';
