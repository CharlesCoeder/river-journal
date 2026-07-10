-- t20: users.age_attested_at — the one-time 13+ attestation column.
--
-- Asserts (a) the column exists as a nullable timestamptz; (b) an owner can
-- record their own age_attested_at; (c) one user cannot write another user's
-- age_attested_at (the owner-only UPDATE policy filters the foreign row out,
-- so it stays NULL).

BEGIN;
\i _helpers.psql
SELECT plan(3);

DO $$
DECLARE
  v_owner       UUID;
  v_other       UUID;
  v_col_exists  BOOLEAN;
  v_col_type    TEXT;
  v_is_nullable TEXT;
  v_owner_set   BOOLEAN;
  v_other_after TIMESTAMPTZ;
BEGIN
  -- (a) column exists + timestamptz + nullable
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'age_attested_at'
  ) INTO v_col_exists;

  SELECT data_type, is_nullable
  INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'age_attested_at';

  PERFORM tap_ok(
    v_col_exists
      AND v_col_type = 'timestamp with time zone'
      AND v_is_nullable = 'YES',
    'users.age_attested_at exists as a nullable timestamptz'
  );

  v_owner := test_seed_user();
  v_other := test_seed_user();

  -- (b) owner can record their own attestation
  PERFORM test_become(v_owner);
  UPDATE users SET age_attested_at = NOW() WHERE id = v_owner;
  SELECT age_attested_at IS NOT NULL INTO v_owner_set FROM users WHERE id = v_owner;
  PERFORM tap_ok(v_owner_set, 'an owner can record their own age_attested_at');

  -- (c) owner cannot write another user's attestation — the owner-only UPDATE
  -- policy filters the foreign row out, so this UPDATE matches zero rows and
  -- v_other's value stays NULL. Read it back as v_other (whose own SELECT
  -- policy allows reading their row) to confirm.
  UPDATE users SET age_attested_at = NOW() WHERE id = v_other;
  PERFORM test_become(v_other);
  SELECT age_attested_at INTO v_other_after FROM users WHERE id = v_other;
  PERFORM tap_ok(
    v_other_after IS NULL,
    'a user cannot write another user''s age_attested_at (RLS denies)'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
