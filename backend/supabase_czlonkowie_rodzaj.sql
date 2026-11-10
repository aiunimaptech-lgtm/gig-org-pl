-- ============================================================
-- GIG: rodzaj członka w katalogu (9.11.2026)
-- uslugi         = usługi geodezyjne, kartograficzne, fotogrametryczne (domyślnie, wszystkie dotychczasowe firmy)
-- geoinformatyka = technologie dla geodezji: sprzęt, oprogramowanie, geoinformatyka (wartość techniczna zostaje „geoinformatyka”)
-- Firmy „geoinformatyka” są w katalogu z oznaczeniem, ale NIE dostają zapytań o wycenę z kalkulatora
-- /ile-kosztuje-geodezja/ (filtr w kalkulatorze i w Edge Function zapytanie-wycena v2).
-- 10.11.2026: Prezydium uznało, że firmy sprzedające sprzęt i oprogramowanie mogą być członkami (są już takie);
-- publicznie tego szczególnie nie podkreślamy. Znacznik w katalogu: „Technologie dla geodezji”.
-- ============================================================
alter table public.czlonkowie add column if not exists rodzaj text not null default 'uslugi';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'czlonkowie_rodzaj_check') then
    alter table public.czlonkowie add constraint czlonkowie_rodzaj_check check (rodzaj in ('uslugi', 'geoinformatyka'));
  end if;
end $$;
comment on column public.czlonkowie.rodzaj is 'uslugi = usługi geodezyjne (firma dostaje zapytania z kalkulatora); geoinformatyka = technologie dla geodezji (sprzęt, oprogramowanie, geoinformatyka), bez zapytań z kalkulatora';
