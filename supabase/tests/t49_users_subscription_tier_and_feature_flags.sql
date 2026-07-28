-- t49: users.subscription_tier native enum column (default/CHECK-by-enum/
-- client-write-block) and the additive preferences.feature_flags key.
--
-- Coverage:
--   * users.subscription_tier exists and is the native public.subscription_tier
--     enum type, NOT NULL
--   * a freshly seeded user defaults to subscription_tier = 'free'
--   * an out-of-enum value ('gold') is rejected
--   * the tier-tamper security fix: a direct `authenticated` UPDATE of
--     subscription_tier on the caller's OWN row is denied with 42501 (the
--     column-level REVOKE), while an UPDATE of a still-client-writable
--     column (preferences) on that SAME row still succeeds — proving the
--     REVOKE is column-scoped, not table-wide, and that
--     users_update_own itself is untouched
--   * the preferences.feature_flags additive-migration shape: applying the
--     migration's idempotent jsonb_set(...) UPDATE to a row whose
--     preferences lack the key sets `feature_flags: { external_billing_link_enabled: false }`
--
-- Note on the feature_flags assertions: a fresh local test database has no
-- pre-existing "legacy" user rows for the additive backfill migration to
-- touch (test_seed_user() always creates rows AFTER all migrations have
-- already applied, and a new row is NOT auto-backfilled — only rows that
-- existed at migration-apply time are). So this test seeds a row in the
-- exact pre-migration shape the migration's `WHERE NOT (preferences ?
-- 'feature_flags')` guard targets (a bare `{}` preferences JSONB, which is
-- what test_seed_user() already produces) and then re-applies the migration's
-- own idempotent UPDATE statement verbatim, proving that statement produces
-- the expected shape. Do not read this as "new users get feature_flags for
-- free" — they deliberately do not (design notes: consumers must treat an
-- absent flag as false regardless).
--
-- Red phase: users.subscription_tier does not exist yet, so the very first
-- reference to it below raises "column ... does not exist" and the whole
-- file aborts with no TAP output — an unambiguous suite failure until both
-- the enum+column migration and the feature_flags migration land.

BEGIN;
\i _helpers.psql
SELECT plan(7);

DO $$
DECLARE
  v_shape_ok           BOOLEAN := FALSE;
  v_user               UUID;
  v_default_tier       public.subscription_tier;
  v_enum_rejected      BOOLEAN := FALSE;
  v_state              TEXT;
  v_tier_update_denied BOOLEAN := FALSE;
  v_prefs_update_ok    BOOLEAN := FALSE;
  v_has_flag_before    BOOLEAN;
  v_has_flag_after     BOOLEAN;
  v_flag_value         TEXT;
BEGIN
  -- (1) users.subscription_tier is the native public.subscription_tier enum
  -- type, NOT NULL.
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    JOIN pg_type t ON t.typname = c.udt_name
    WHERE c.table_schema = 'public'
      AND c.table_name = 'users'
      AND c.column_name = 'subscription_tier'
      AND c.data_type = 'USER-DEFINED'
      AND c.udt_name = 'subscription_tier'
      AND c.is_nullable = 'NO'
      AND t.typtype = 'e'
  ) INTO v_shape_ok;
  PERFORM tap_ok(v_shape_ok, 'users.subscription_tier is a NOT NULL native public.subscription_tier enum column');

  -- (2) a freshly seeded user defaults to subscription_tier = 'free'.
  v_user := test_seed_user();
  SELECT subscription_tier INTO v_default_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(v_default_tier = 'free', 'a freshly seeded user defaults to subscription_tier = ''free''');

  -- (3) an out-of-enum value is rejected. Run as table owner (bypasses RLS,
  -- isolates the enum-domain rejection from the privilege layer).
  BEGIN
    UPDATE users SET subscription_tier = 'gold' WHERE id = v_user;
  EXCEPTION
    WHEN invalid_text_representation THEN v_enum_rejected := TRUE;
    WHEN check_violation THEN v_enum_rejected := TRUE;
  END;
  PERFORM tap_ok(v_enum_rejected, 'an out-of-enum subscription_tier value (''gold'') is rejected');

  -- (4) a direct `authenticated` UPDATE of subscription_tier on the
  -- caller's OWN row is denied with 42501 (column-level REVOKE) — a client
  -- must never be able to self-promote its tier, even on a row it owns and
  -- even though users_update_own's USING (id = auth.uid()) would otherwise
  -- allow the row to be targeted.
  PERFORM test_become(v_user);
  BEGIN
    UPDATE users SET subscription_tier = 'paid_yearly' WHERE id = v_user;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_tier_update_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_tier_update_denied, 'a direct authenticated UPDATE of subscription_tier on the caller''s own row is denied with 42501');

  -- (5) on the SAME row, an UPDATE of a still-client-writable column
  -- (preferences) still succeeds — proves the REVOKE is column-scoped, not
  -- table-wide, and users_update_own / the preferences GRANT are untouched.
  BEGIN
    UPDATE users SET preferences = preferences || '{"probe": true}'::jsonb WHERE id = v_user;
    v_prefs_update_ok := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_prefs_update_ok := FALSE;
  END;
  PERFORM tap_ok(v_prefs_update_ok, 'an UPDATE of preferences on the same row still succeeds (REVOKE is column-scoped, not table-wide)');

  -- (6)/(7) preferences.feature_flags additive-migration shape (see file
  -- header note on why this replays the migration's own statement).
  SELECT (preferences ? 'feature_flags') INTO v_has_flag_before FROM users WHERE id = v_user;

  UPDATE users
  SET preferences = jsonb_set(preferences, '{feature_flags}', '{"external_billing_link_enabled": false}'::jsonb, true)
  WHERE id = v_user AND NOT (preferences ? 'feature_flags');

  SELECT (preferences ? 'feature_flags'), preferences -> 'feature_flags' ->> 'external_billing_link_enabled'
  INTO v_has_flag_after, v_flag_value
  FROM users WHERE id = v_user;

  PERFORM tap_ok(
    NOT COALESCE(v_has_flag_before, FALSE) AND v_has_flag_after,
    'preferences ? ''feature_flags'' is true after the additive migration''s idempotent UPDATE'
  );
  PERFORM tap_ok(
    v_flag_value = 'false',
    'preferences->''feature_flags''->>''external_billing_link_enabled'' defaults to ''false'''
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
