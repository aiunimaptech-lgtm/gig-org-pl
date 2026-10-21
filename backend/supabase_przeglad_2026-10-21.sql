-- ============================================================
-- GIG: przegląd bezpieczeństwa i limitów 21.10.2026
-- Widok wezel_zestawienie (zestawienie cen Węzła Jakości) był SECURITY DEFINER z dostępem anon:
-- każdy z kluczem publicznym widział min/max/średnią, a przy jednej firmie jej dokładną cenę.
-- Panel liczy zestawienie sam, więc widok zostaje tylko dla zalogowanych.
-- ============================================================
alter view public.wezel_zestawienie set (security_invoker = true);
revoke all on public.wezel_zestawienie from anon;
