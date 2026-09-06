-- ============================================================
-- GIG — RAPORTY DMARC (panel → zakładka „DMARC")
--
-- Po co: rekord _dmarc.gig.org.pl ma `rua=mailto:biuro@gig.org.pl`, więc Gmail,
-- Microsoft i reszta przysyłają codziennie raporty zbiorcze — XML w .gz albo .zip.
-- Gołym okiem są nieczytelne. Panel je parsuje w przeglądarce i zapisuje tutaj.
--
-- Czego szukamy w danych: czy WSZYSTKIE nasze kanały wysyłki (MailerLite, Resend,
-- poczta tld.pl) przechodzą weryfikację. Dopiero gdy przez kilka tygodni jest
-- czysto, można podnieść politykę z p=none na p=quarantine.
--
-- Uruchom w: Supabase → SQL Editor → Run (albo apply_migration z MCP). Idempotentne.
-- ============================================================

-- Jeden wiersz = jeden plik XML od jednego dostawcy za jedną dobę.
-- UNIQUE(org_name, report_id) chroni przed dwukrotnym wgraniem tego samego raportu.
create table if not exists public.dmarc_raporty (
  id           uuid primary key default gen_random_uuid(),
  org_name     text not null,                 -- kto przysłał (google.com, Enterprise Outlook…)
  org_email    text,
  report_id    text not null,                 -- identyfikator nadany przez dostawcę
  domena       text,                          -- policy_published > domain
  date_begin   timestamptz,
  date_end     timestamptz,
  polityka_p   text,                          -- p= z rekordu w chwili raportu
  polityka_sp  text,
  polityka_pct integer,
  adkim        text,                          -- r = relaxed, s = strict
  aspf         text,
  razem        integer default 0,             -- suma <count> ze wszystkich <record>
  zgodne       integer default 0,             -- ile przeszło DMARC (DKIM lub SPF)
  plik         text,                          -- nazwa wgranego pliku (do rozpoznania)
  created_at   timestamptz default now(),
  unique (org_name, report_id)
);
create index if not exists idx_dmarc_rap_okres on public.dmarc_raporty (date_begin desc);

-- Jeden wiersz = jedno źródło wysyłki (IP) w obrębie raportu.
-- `liczba` to ile wiadomości z tego IP dostawca zobaczył danego dnia.
create table if not exists public.dmarc_wiersze (
  id            uuid primary key default gen_random_uuid(),
  raport_id     uuid not null references public.dmarc_raporty(id) on delete cascade,
  source_ip     text not null,
  liczba        integer default 1,
  dyspozycja    text,                         -- none / quarantine / reject
  dkim_polityka text,                         -- wynik PO sprawdzeniu zgodności (alignment)
  spf_polityka  text,
  header_from   text,
  dkim_domena   text,                         -- surowe auth_results — mówią KTO podpisał
  dkim_selektor text,
  dkim_wynik    text,
  spf_domena    text,
  spf_wynik     text
);
create index if not exists idx_dmarc_wier_raport on public.dmarc_wiersze (raport_id);
create index if not exists idx_dmarc_wier_ip on public.dmarc_wiersze (source_ip);

alter table public.dmarc_raporty enable row level security;
alter table public.dmarc_wiersze enable row level security;
drop policy if exists "dmarc rap admin all" on public.dmarc_raporty;
create policy "dmarc rap admin all" on public.dmarc_raporty
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "dmarc wier admin all" on public.dmarc_wiersze;
create policy "dmarc wier admin all" on public.dmarc_wiersze
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Zbiorczo po źródłach — to samo, co tabela „Źródła wysyłki" w panelu,
-- do ręcznych zapytań w SQL Editorze (security_invoker: RLS jak dla pytającego).
create or replace view public.dmarc_zrodla with (security_invoker = true) as
select w.source_ip,
       sum(w.liczba)                                                    as wiadomosci,
       sum(w.liczba) filter (where w.dkim_polityka = 'pass'
                                or w.spf_polityka = 'pass')             as zgodne,
       sum(w.liczba) filter (where w.dkim_polityka = 'pass')            as dkim_ok,
       sum(w.liczba) filter (where w.spf_polityka  = 'pass')            as spf_ok,
       string_agg(distinct nullif(w.dkim_domena, ''), ', ')             as dkim_domeny,
       string_agg(distinct nullif(w.spf_domena,  ''), ', ')             as spf_domeny,
       count(distinct w.raport_id)                                      as raporty,
       min(r.date_begin)                                                as pierwszy,
       max(r.date_end)                                                  as ostatni
from public.dmarc_wiersze w
join public.dmarc_raporty r on r.id = w.raport_id
group by w.source_ip;

-- ── PRZYDATNE ZAPYTANIA ───────────────────────────────────────────────────
-- Źródła, które NIE przechodzą DMARC (kandydaci do naprawy albo podszywacze):
--   select * from dmarc_zrodla where zgodne < wiadomosci order by wiadomosci desc;
--
-- Czy można podnieść politykę do p=quarantine? Ostatnie 30 dni muszą być czyste:
--   select sum(razem) as wiadomosci, sum(zgodne) as ok,
--          round(100.0 * sum(zgodne) / nullif(sum(razem),0), 2) as procent_ok
--   from dmarc_raporty where date_begin > now() - interval '30 days';
--
-- Czyszczenie starych raportów (dane starsze niż rok nie są już do niczego potrzebne):
--   delete from dmarc_raporty where date_begin < now() - interval '1 year';
