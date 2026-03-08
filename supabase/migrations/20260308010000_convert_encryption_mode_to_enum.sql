-- Migration: Convert users.encryption_mode from TEXT to a Postgres enum.
-- This keeps the column nullable for users who have not chosen a mode yet,
-- while letting generated Supabase types expose the exact allowed values.

CREATE TYPE public.encryption_mode AS ENUM ('e2e', 'managed');

ALTER TABLE public.users
  ALTER COLUMN encryption_mode TYPE public.encryption_mode
  USING (
    CASE
      WHEN encryption_mode IS NULL THEN NULL
      ELSE encryption_mode::public.encryption_mode
    END
  );
