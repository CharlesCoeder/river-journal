-- Migration: Key verifier column + race-safe / non-destructive encryption bootstrap RPCs.
--
-- Fixes three permanent-data-loss defects in the encryption setup flow:
--
--   1. Salt overwrite. The old E2E bootstrap unconditionally upserted a freshly
--      generated encryption_salt. If the settings load blipped and the user
--      re-entered their password, a brand-new salt clobbered the server's salt,
--      making every previously-encrypted flow undecryptable forever. The new
--      bootstrap_e2e_encryption() RPC writes the salt ONLY when none exists
--      (guarded ON CONFLICT ... WHERE encryption_salt IS NULL) and returns the
--      authoritative row so the client can fall back to UNLOCK if a salt already
--      existed.
--
--   2. No key verifier. Passwords were validated by sampling ~50 flows and
--      trying to decrypt them; with no encrypted rows sampled a WRONG password
--      was silently accepted, splitting the account across two keys. We now store
--      encryption_key_verifier: the ciphertext of a known constant encrypted with
--      the derived master key. Unlock decrypts it to prove the password.
--
--   3. Managed bootstrap race. Two devices doing fetch-then-upsert could each
--      generate a different managed key; the loser's writes became undecryptable.
--      bootstrap_managed_encryption() uses INSERT ... ON CONFLICT DO UPDATE with
--      COALESCE so the first-written key always wins and every caller gets it.
--
-- All writes stay scoped to the calling user via auth.uid(); SECURITY DEFINER is
-- used purely to make the guarded upsert atomic. RLS on `users` is unchanged.

-- ---------------------------------------------------------------------------
-- 1. Key verifier column (nullable; legacy rows self-heal on next unlock).
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS encryption_key_verifier TEXT;

COMMENT ON COLUMN public.users.encryption_key_verifier IS
  'Ciphertext of a known constant encrypted with the E2E master key. Lets a '
  'device prove a re-entered password is correct without relying on sampling '
  'existing flows. NULL for legacy accounts until the next verified unlock.';

-- ---------------------------------------------------------------------------
-- 2. E2E bootstrap: write salt/verifier only if absent; return the truth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_e2e_encryption(
  p_salt     TEXT,
  p_verifier TEXT
)
RETURNS TABLE (
  out_salt     TEXT,
  out_verifier TEXT,
  out_mode     public.encryption_mode
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Insert-if-absent: the SET (including the mode switch) only applies when the
  -- account has no salt yet. If a salt already exists it is left untouched and
  -- the caller learns of it from the returned row. The ON CONFLICT row lock
  -- serializes concurrent bootstraps so exactly one salt can ever win.
  INSERT INTO public.users AS u (id, encryption_mode, encryption_salt, encryption_key_verifier)
  VALUES (v_uid, 'e2e'::public.encryption_mode, p_salt, p_verifier)
  ON CONFLICT (id) DO UPDATE
    SET encryption_mode         = 'e2e'::public.encryption_mode,
        encryption_salt         = EXCLUDED.encryption_salt,
        encryption_key_verifier = EXCLUDED.encryption_key_verifier
    WHERE u.encryption_salt IS NULL;

  RETURN QUERY
    SELECT u.encryption_salt, u.encryption_key_verifier, u.encryption_mode
    FROM public.users u
    WHERE u.id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_e2e_encryption(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bootstrap_e2e_encryption(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Managed bootstrap: first-written key wins; every caller gets the winner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_managed_encryption(
  p_key TEXT
)
RETURNS TABLE (
  out_key  TEXT,
  out_mode public.encryption_mode
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Always switch to managed, but keep any key that already exists (COALESCE).
  -- The ON CONFLICT row lock serializes concurrent devices, so the first key
  -- written is the one every subsequent caller reads back.
  INSERT INTO public.users AS u (id, encryption_mode, managed_encryption_key)
  VALUES (v_uid, 'managed'::public.encryption_mode, p_key)
  ON CONFLICT (id) DO UPDATE
    SET encryption_mode        = 'managed'::public.encryption_mode,
        managed_encryption_key = COALESCE(u.managed_encryption_key, EXCLUDED.managed_encryption_key);

  RETURN QUERY
    SELECT u.managed_encryption_key, u.encryption_mode
    FROM public.users u
    WHERE u.id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_managed_encryption(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bootstrap_managed_encryption(TEXT) TO authenticated;
