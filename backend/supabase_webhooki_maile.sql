-- ============================================================
-- GIG — powiadomienia mailowe po nowym zgłoszeniu z formularza
--
-- Wpis do `submissions_kontakt` / `submissions_newsletter` wywołuje
-- Edge Function `send-confirmation`, która wysyła przez Resend:
--   * powiadomienie do GIG (sekret NOTIFY_EMAILS), Reply-To = nadawca,
--   * potwierdzenie do nadawcy.
--
-- UWAGA: nie używamy integracji „Database Webhooks" — schemat
-- `supabase_functions` nie jest w tym projekcie zainstalowany.
-- Wołamy `pg_net` wprost; to ten sam mechanizm pod spodem.
--
-- Uruchom w: Supabase → SQL Editor → Run. Idempotentne.
-- ============================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.gig_powiadom_o_zgloszeniu()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url     := 'https://zlepwzeyjwpmhyxfnime.supabase.co/functions/v1/send-confirmation',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 -- klucz PUBLICZNY (anon) — ten sam, który jest w gig-config.js na stronie,
                 -- więc nie wnosi nowej ekspozycji. `service_role` NIE trafia do triggera.
                 'Authorization', 'Bearer sb_publishable_1KPF4mdln3C-cZHMIqAOFw_ZM8Go2Ji'
               ),
    -- kształt payloadu zgodny z tym, czego oczekuje send-confirmation
    body    := jsonb_build_object('table', TG_TABLE_NAME, 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

drop trigger if exists on_kontakt_insert on public.submissions_kontakt;
create trigger on_kontakt_insert
  after insert on public.submissions_kontakt
  for each row execute function public.gig_powiadom_o_zgloszeniu();

drop trigger if exists on_newsletter_insert on public.submissions_newsletter;
create trigger on_newsletter_insert
  after insert on public.submissions_newsletter
  for each row execute function public.gig_powiadom_o_zgloszeniu();

-- kontrola
select c.relname as tabela, t.tgname as trigger
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where t.tgname in ('on_kontakt_insert','on_newsletter_insert')
order by 1;

-- diagnostyka wysyłek (odpowiedzi funkcji na kolejne zgłoszenia):
--   select id, status_code, left(content,300), created
--   from net._http_response order by id desc limit 10;
