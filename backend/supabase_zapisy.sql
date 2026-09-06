-- ============================================================
-- GIG — tabela ZAPISY NA SZKOLENIA
-- Zgloszenie ze strony /zapisy/ (osobny formularz, nie CF7).
-- Uruchom w: Supabase → SQL Editor → Run. Idempotentne.
-- ============================================================

CREATE TABLE IF NOT EXISTS zapisy_szkolenia (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  szkolenie         TEXT,                      -- tytul szkolenia (z ?szkolenie=)

  -- uczestnicy
  liczba_osob       INT,
  uczestnicy        TEXT,                      -- imiona i nazwiska, jeden na linie

  -- dane nabywcy (platnik faktury)
  nabywca_nazwa     TEXT,
  nabywca_adres     TEXT,
  nabywca_nip       TEXT,
  nabywca_jst       BOOLEAN DEFAULT false,     -- jednostka samorzadu terytorialnego

  -- dane odbiorcy; przy JST czesto inne niz nabywca (gmina kupuje, urzad odbiera)
  odbiorca_taki_sam BOOLEAN DEFAULT true,
  odbiorca_nazwa    TEXT,
  odbiorca_adres    TEXT,
  odbiorca_nip      TEXT,

  -- kontakt
  email             TEXT NOT NULL,
  telefon           TEXT,
  uwagi             TEXT,

  status            TEXT DEFAULT 'new' CHECK (status IN ('new','read','confirmed','cancelled')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zapisy_created ON zapisy_szkolenia (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zapisy_szkolenie ON zapisy_szkolenia (szkolenie);

ALTER TABLE zapisy_szkolenia ENABLE ROW LEVEL SECURITY;

-- formularz na stronie moze tylko DODAWAC (jak pozostale formularze)
DROP POLICY IF EXISTS "zap public insert" ON zapisy_szkolenia;
CREATE POLICY "zap public insert" ON zapisy_szkolenia FOR INSERT WITH CHECK (true);

-- odczyt i edycja tylko dla zalogowanego admina (panel)
DROP POLICY IF EXISTS "zap admin all" ON zapisy_szkolenia;
CREATE POLICY "zap admin all" ON zapisy_szkolenia FOR ALL USING (auth.role() = 'authenticated');

-- powiadomienie mailowe po nowym zapisie (ta sama funkcja co formularze)
DROP TRIGGER IF EXISTS on_zapis_insert ON public.zapisy_szkolenia;
CREATE TRIGGER on_zapis_insert
  AFTER INSERT ON public.zapisy_szkolenia
  FOR EACH ROW EXECUTE FUNCTION public.gig_powiadom_o_zgloszeniu();

-- kontrola
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'zapisy_szkolenia'
ORDER BY ordinal_position;

-- ── Wrzesien 2026: moment wystawienia faktury ─────────────────────────────
-- Widoczne w formularzu tylko dla JST (firmy dostaja fakture przed szkoleniem).
alter table public.zapisy_szkolenia
  add column if not exists faktura_kiedy text
  check (faktura_kiedy is null or faktura_kiedy in ('przed','po'));
