-- ============================================================
-- GIG: przegląd bezpieczeństwa i limitów 21.10.2026
-- Widok wezel_zestawienie (zestawienie cen Węzła Jakości) był SECURITY DEFINER z dostępem anon:
-- każdy z kluczem publicznym widział min/max/średnią, a przy jednej firmie jej dokładną cenę.
-- Panel liczy zestawienie sam, więc widok zostaje tylko dla zalogowanych.
-- ============================================================
alter view public.wezel_zestawienie set (security_invoker = true);
revoke all on public.wezel_zestawienie from anon;

-- Historia harmonogramu (cron.job_run_details) rosła bez końca: gig-kampanie działa co minutę,
-- czyli 1440 wpisów na dobę. Codziennie o 3:15 UTC usuwamy wpisy starsze niż 7 dni.
select cron.schedule('gig-czysc-historie-cron', '15 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
