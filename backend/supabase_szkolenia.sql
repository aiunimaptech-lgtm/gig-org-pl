-- ============================================================
-- GIG — tabela SZKOLENIA (kalendarz szkoleń)
-- Uruchom w: Supabase → SQL Editor → New query → Run
-- Idempotentne (można powtórzyć).
-- ============================================================

CREATE TABLE IF NOT EXISTS szkolenia (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  date_start  DATE,
  date_end    DATE,
  location    TEXT,                 -- miejsce (np. "Warszawa, ul. Czackiego 3/5") lub puste gdy online
  is_online   BOOLEAN DEFAULT false,
  description TEXT,
  status      TEXT DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_szkolenia_date ON szkolenia (date_start);

ALTER TABLE szkolenia ENABLE ROW LEVEL SECURITY;

-- publiczny odczyt tylko opublikowanych (strona /szkolenia/)
DROP POLICY IF EXISTS "szk public read" ON szkolenia;
CREATE POLICY "szk public read" ON szkolenia FOR SELECT USING (status = 'published');

-- pełen dostęp tylko dla zalogowanego admina (panel)
DROP POLICY IF EXISTS "szk admin all" ON szkolenia;
CREATE POLICY "szk admin all" ON szkolenia FOR ALL USING (auth.role() = 'authenticated');

-- ── Wrzesien 2026: platnosc i termin zgloszen (szablon dla kazdego szkolenia) ──
alter table public.szkolenia add column if not exists platnosc text;
alter table public.szkolenia add column if not exists zgloszenia_do text;
-- Panel podstawia oba teksty automatycznie: termin = 10 dni przed data szkolenia.
