-- Wiadomość do uczestników szkolenia przez Wysyłki (6.10.2026).
-- Panel Zapisy → „✉ Do uczestników” nie wysyła od razu: tworzy wysyłkę roboczą
-- (rodzaj 'szkolenie') w /admin/wysylki.html. Tam: ✎ Edytuj, ✉ Test, 🕒 Zaplanuj
-- (wysylaj_od + auto, rusza harmonogram gig_kampanie_tick) albo ▶ Wyślij.
-- Edge Function wyslij-kampanie v9: przy rodzaj 'szkolenie' stopka „zgłoszono Cię na
-- szkolenie GIG: <tytuł>” (kolumna szkolenie), bez linku wypisu.

alter table public.wysylki drop constraint if exists wysylki_rodzaj_check;
alter table public.wysylki add constraint wysylki_rodzaj_check check (rodzaj = any (array['baza','newsletter','szkolenie']));
alter table public.wysylki add column if not exists szkolenie text;
comment on column public.wysylki.szkolenie is 'rodzaj=szkolenie: tytuł szkolenia do stopki maila (zgłoszono Cię na szkolenie...)';
