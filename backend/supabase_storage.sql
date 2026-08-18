-- ============================================================
-- GIG — miejsce na zdjęcia (bucket "media") + polityki dostępu
-- Uruchom w: Supabase → SQL Editor → New query → Run
-- Idempotentne — można powtórzyć.
--
-- Bucket jest PUBLICZNY do odczytu (zdjęcia w artykułach muszą
-- być widoczne dla każdego odwiedzającego), ale wgrywać, nadpisywać
-- i kasować może wyłącznie zalogowany użytkownik panelu.
-- ============================================================

-- Bucket (public = publiczny odczyt plików)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "media: public read"           ON storage.objects;
DROP POLICY IF EXISTS "media: authenticated insert"  ON storage.objects;
DROP POLICY IF EXISTS "media: authenticated update"  ON storage.objects;
DROP POLICY IF EXISTS "media: authenticated delete"  ON storage.objects;

-- Odczyt: każdy (zdjęcia na stronie)
CREATE POLICY "media: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

-- Wgrywanie: tylko zalogowani (panel /admin/)
CREATE POLICY "media: authenticated insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

-- Nadpisywanie
CREATE POLICY "media: authenticated update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media')
  WITH CHECK (bucket_id = 'media');

-- Kasowanie (np. wymiana zdjęcia we wpisie)
CREATE POLICY "media: authenticated delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media');
