-- Migration: Allow authenticated users to have no encryption choice yet.
-- Story 4.1 needs to distinguish:
--   1) brand-new users who have never chosen a mode
--   2) users who explicitly chose 'e2e' or 'managed'
--
-- The existing schema used NOT NULL DEFAULT 'e2e', and the auth trigger inserts
-- public.users rows immediately on signup. That caused brand-new users to look
-- like they had already chosen E2E, so the chooser/password setup never appeared.

ALTER TABLE public.users
  ALTER COLUMN encryption_mode DROP DEFAULT,
  ALTER COLUMN encryption_mode DROP NOT NULL;

-- Repair rows that were auto-created with the old implicit E2E default but never
-- completed E2E bootstrap. A real future E2E setup will populate encryption_salt.
UPDATE public.users
SET encryption_mode = NULL
WHERE encryption_mode = 'e2e'
  AND encryption_salt IS NULL;
