-- ============================================================
-- GIG — szkolenie „Modernizacja EGiB jako narzędzie zwiększania
-- dochodów i bezpiecznego zarządzania gminą” (mgr inż. Marzena Danecka)
--
-- Ustalony termin: 22 października 2026 (było: „Październik 2026”).
-- Uruchom w: Supabase → SQL Editor → New query → Run.
-- Idempotentne — można powtórzyć.
-- ============================================================

UPDATE szkolenia
SET date_start  = DATE '2026-10-22',
    -- puste date_label => kafelek pokazuje konkretny dzień (22 / październik 2026)
    -- zamiast opisowego napisu „Październik 2026”
    date_label  = NULL,
    -- ostatni akapit opisu („Dokładny termin podamy wkrótce.”) jest już nieaktualny
    description = rtrim(replace(description, 'Dokładny termin podamy wkrótce.', ''), E' \n'),
    updated_at  = NOW()
WHERE id = '92ff5b65-bdd0-4418-a74b-e2ec2da5307f';

-- kontrola
SELECT date_start, date_label, right(description, 90) AS koniec_opisu
FROM szkolenia
WHERE id = '92ff5b65-bdd0-4418-a74b-e2ec2da5307f';
