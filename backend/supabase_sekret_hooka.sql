-- ============================================================
-- GIG — wspólny sekret między triggerem a Edge Function send-confirmation
--
-- PROBLEM: funkcja `send-confirmation` przyjmowała wywołania z kluczem
-- publicznym (`anon`), który jest jawny w `strona/_assets/js/gig-config.js`.
-- Każdy mógł ją wywołać ręcznie i wysłać maila z domeny Izby na dowolny
-- adres albo zaspamować skrzynki GIG.
--
-- ROZWIĄZANIE: trigger dokłada nagłówek `x-gig-token`, a funkcja sprawdza
-- go względem sekretu `GIG_HOOK_TOKEN`. Porównanie w funkcji jest o stałym
-- czasie, żeby nie zdradzać, ile pierwszych znaków się zgadza.
--
-- WDROŻENIE BEZ PRZERWY W WYSYŁCE — kolejność ma znaczenie:
--   1. ten skrypt (trigger zaczyna wysyłać nagłówek; funkcja go ignoruje),
--   2. wdrożenie `edge-functions/send-confirmation.ts` (brama nieaktywna,
--      bo sekret jeszcze nie istnieje — maile chodzą jak dotąd),
--   3. dodanie sekretu GIG_HOOK_TOKEN w Supabase → Edge Functions → Secrets
--      (dopiero teraz ochrona się włącza).
-- Odwrotna kolejność (najpierw sekret) zablokowałaby wysyłkę.
--
-- Uruchom w: Supabase → SQL Editor → Run. Idempotentne.
-- ============================================================

-- Prywatny schemat: NIE jest wystawiony przez PostgREST, a anon/authenticated
-- nie mają do niego prawa. Dzięki temu token nie wycieka ani przez API,
-- ani przez źródło funkcji widoczne w pg_proc.
create schema if not exists private;
revoke all on schema private from anon, authenticated, public;

create table if not exists private.gig_sekrety (
  klucz   text primary key,
  wartosc text not null,
  opis    text,
  created timestamptz default now()
);
revoke all on table private.gig_sekrety from anon, authenticated, public;

-- Token generowany w bazie — nie przechodzi przez żadne narzędzie zewnętrzne.
insert into private.gig_sekrety (klucz, wartosc, opis)
values ('hook_token', encode(extensions.gen_random_bytes(32), 'hex'),
        'Wspólny sekret: trigger -> Edge Function send-confirmation')
on conflict (klucz) do nothing;

create or replace function public.gig_powiadom_o_zgloszeniu()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  token text;
begin
  select wartosc into token from private.gig_sekrety where klucz = 'hook_token';

  perform net.http_post(
    url     := 'https://zlepwzeyjwpmhyxfnime.supabase.co/functions/v1/send-confirmation',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 -- Klucz publiczny przechodzi bramę Supabase (verify_jwt = true).
                 -- Dowodem, że wywołanie pochodzi z naszego triggera, jest dopiero
                 -- nagłówek poniżej.
                 'Authorization', 'Bearer sb_publishable_1KPF4mdln3C-cZHMIqAOFw_ZM8Go2Ji',
                 'x-gig-token', coalesce(token, '')
               ),
    body    := jsonb_build_object('table', TG_TABLE_NAME, 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

-- ── ODCZYT TOKENU DO WKLEJENIA W SEKRETY ──────────────────────────────────
-- Uruchom osobno i skopiuj wynik do Supabase → Edge Functions → Secrets
-- jako GIG_HOOK_TOKEN:
--
--   select wartosc from private.gig_sekrety where klucz = 'hook_token';
--
-- Token nigdy nie był wyświetlany poza panelem Supabase — jest generowany
-- w bazie i odczytywany wyłącznie tym zapytaniem.

-- ── WERYFIKACJA PO WDROŻENIU ──────────────────────────────────────────────
-- Po dodaniu sekretu wyślij testowe zgłoszenie i sprawdź odpowiedź funkcji:
--   select id, status_code, left(content,200), created
--   from net._http_response order by id desc limit 3;
-- Oczekiwane: 200 oraz {"ok":true,...}
-- 401 i {"error":"brak uprawnien"} = sekret w Supabase różni się od tokenu
--   w private.gig_sekrety (porównaj oba i popraw sekret).
