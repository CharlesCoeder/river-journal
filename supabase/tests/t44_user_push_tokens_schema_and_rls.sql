-- t44: user_push_tokens structural shape + four-policy self-scoped RLS.
--
-- Coverage:
--   * column shape (id/user_id/expo_push_token/platform/device_label/
--     last_used_at/is_deleted/created_at/updated_at)
--   * user_id FK is ON DELETE CASCADE against users(id)
--   * UNIQUE (user_id, expo_push_token) prevents duplicate registrations
--   * CHECK (platform IN ('ios','android')) rejects any other value
--   * the (user_id) fan-out index exists
--   * RLS is enabled with FOUR policies, all auth.uid() = user_id:
--     SELECT/INSERT/UPDATE/DELETE — a caller can only ever see, create,
--     modify, or remove their own rows; a third party is denied on every
--     verb; anon has no grant at all.
--   * the handle_times trigger stamps updated_at on UPDATE.
--
-- Red phase: the table does not exist yet, so every DML statement below
-- raises "relation ... does not exist" and the whole file aborts with no
-- TAP output — an unambiguous suite failure until the migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(22);

DO $$
DECLARE
  v_mismatched       TEXT[];
  v_alice            UUID;
  v_bob              UUID;
  v_carol            UUID;
  v_pk_count         INT;
  v_fk_deltype       TEXT;
  v_unique_cols      TEXT[];
  v_idx_count        INT;
  v_rls_enabled      BOOLEAN;
  v_check_rejected   BOOLEAN := FALSE;
  v_dup_rejected     BOOLEAN := FALSE;
  v_accepted         BOOLEAN := FALSE;
  v_own_visible      INT;
  v_other_visible    INT;
  v_state            TEXT;
  v_third_insert_denied BOOLEAN := FALSE;
  v_own_update_ok    BOOLEAN := FALSE;
  v_other_update_denied BOOLEAN := FALSE;
  v_updated_at_before TIMESTAMPTZ;
  v_updated_at_after  TIMESTAMPTZ;
  v_other_delete_denied BOOLEAN := FALSE;
  v_own_delete_ok    BOOLEAN := FALSE;
  v_after_delete     INT;
  v_anon_denied      BOOLEAN := FALSE;
  v_token_id         UUID := gen_random_uuid();
BEGIN
  -- (1) column shape: name/type/nullability for every declared column.
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('id',              'uuid',                     'NO'),
    ('user_id',         'uuid',                     'NO'),
    ('expo_push_token', 'text',                     'NO'),
    ('platform',        'text',                     'NO'),
    ('device_label',    'text',                     'YES'),
    ('last_used_at',    'timestamp with time zone', 'NO'),
    ('is_deleted',      'boolean',                  'NO'),
    ('created_at',      'timestamp with time zone', 'NO'),
    ('updated_at',      'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'user_push_tokens'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('user_push_tokens columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );

  -- (2) primary key on id.
  SELECT COUNT(*) INTO v_pk_count
  FROM pg_constraint
  WHERE conrelid = 'public.user_push_tokens'::regclass
    AND contype = 'p';
  PERFORM tap_ok(v_pk_count = 1, 'user_push_tokens has a primary key');

  -- (3) user_id FK is ON DELETE CASCADE against users(id).
  SELECT con.confdeltype INTO v_fk_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_push_tokens'::regclass
    AND con.contype = 'f'
    AND att.attname = 'user_id'
  LIMIT 1;
  PERFORM tap_ok(v_fk_deltype = 'c', 'user_push_tokens.user_id FK is ON DELETE CASCADE');

  -- (4) UNIQUE (user_id, expo_push_token) — idempotent-registration contract.
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attname), ARRAY[]::TEXT[])
  INTO v_unique_cols
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_push_tokens'::regclass
    AND con.contype = 'u';
  PERFORM tap_ok(
    v_unique_cols = ARRAY['expo_push_token', 'user_id'],
    format('UNIQUE (user_id, expo_push_token) constraint exists (found: %s)', COALESCE(array_to_string(v_unique_cols, ', '), ''))
  );

  -- (5) the (user_id) fan-out index exists.
  SELECT COUNT(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'user_push_tokens'
    AND indexdef ~* '\(user_id\)';
  PERFORM tap_ok(v_idx_count >= 1, 'index on user_push_tokens(user_id) exists for fan-out lookups');

  -- (6) RLS enabled.
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.user_push_tokens'::regclass;
  PERFORM tap_ok(COALESCE(v_rls_enabled, FALSE), 'row level security is enabled on user_push_tokens');

  -- Fixture for the behavioral assertions below.
  v_alice := test_seed_user();
  v_bob   := test_seed_user();
  v_carol := test_seed_user();

  -- (7) platform CHECK rejects any value outside ('ios','android'), seeded
  -- directly as table owner so this isolates the constraint from RLS.
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[bad]', 'web');
  EXCEPTION
    WHEN check_violation THEN v_check_rejected := TRUE;
  END;
  PERFORM tap_ok(v_check_rejected, 'a platform value outside (ios, android) is rejected by CHECK');

  -- (8) duplicate (user_id, expo_push_token) pair is rejected by UNIQUE,
  -- seeded directly as table owner.
  INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
  VALUES (v_token_id, v_alice, 'ExponentPushToken[dup]', 'ios');
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[dup]', 'ios');
  EXCEPTION
    WHEN unique_violation THEN v_dup_rejected := TRUE;
  END;
  PERFORM tap_ok(v_dup_rejected, 'a duplicate (user_id, expo_push_token) pair raises unique_violation');
  DELETE FROM user_push_tokens WHERE id = v_token_id;

  -- (9)/(10) the owner can INSERT and SELECT their own row via RLS.
  PERFORM test_become(v_alice);
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform, device_label)
    VALUES (v_token_id, v_alice, 'ExponentPushToken[alice-iphone]', 'ios', 'Alice iPhone');
    v_accepted := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'the owner can INSERT their own push-token row (auth.uid() = user_id)');

  SELECT COUNT(*) INTO v_own_visible
  FROM user_push_tokens WHERE id = v_token_id;
  PERFORM tap_ok(v_own_visible = 1, 'the owner can SELECT the push-token row they just created');

  -- (11) a different authenticated user sees zero rows for someone else's token.
  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_other_visible
  FROM user_push_tokens WHERE id = v_token_id;
  PERFORM tap_ok(v_other_visible = 0, 'a different user cannot SELECT another user''s push-token row');

  -- (12) a third party cannot INSERT a row naming someone else as user_id.
  PERFORM test_become(v_carol);
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[carol-forged]', 'ios');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_third_insert_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_third_insert_denied, 'a caller cannot INSERT a push-token row naming a different user_id');

  -- (13) the owner can UPDATE their own row (e.g. touch last_used_at).
  PERFORM test_become(v_alice);
  BEGIN
    UPDATE user_push_tokens SET last_used_at = NOW() WHERE id = v_token_id;
    v_own_update_ok := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_own_update_ok := FALSE;
  END;
  PERFORM tap_ok(v_own_update_ok, 'the owner can UPDATE their own push-token row');

  -- (14) a different user cannot UPDATE someone else's row.
  PERFORM test_become(v_bob);
  BEGIN
    UPDATE user_push_tokens SET device_label = 'hijacked' WHERE id = v_token_id;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
  -- Verify the row was unchanged as the owner (alice); bob cannot SELECT it
  -- under own-scoped RLS (test 11), so the survival check must run as alice or
  -- it would read 0 (device_label = 'hijacked') regardless of whether the
  -- UPDATE had any effect (the assertion would pass vacuously otherwise).
  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_other_visible
  FROM user_push_tokens WHERE id = v_token_id AND device_label = 'hijacked';
  v_other_update_denied := (v_other_visible = 0);
  PERFORM tap_ok(v_other_update_denied, 'a different user''s UPDATE on another user''s push-token row has no effect (RLS-scoped)');

  -- (15) the handle_times trigger stamps updated_at on UPDATE. A single pgTAP
  -- transaction has a fixed now(), so updated_at cannot be observed to *advance*
  -- between two updates; instead verify the BEFORE UPDATE trigger fired by
  -- proving it OVERWRITES a client-supplied stale updated_at with the server
  -- clock. Runs as the row owner (alice) — a different user cannot SELECT this
  -- row under own-scoped RLS (test 11).
  PERFORM test_become(v_alice);
  v_updated_at_before := TIMESTAMPTZ '2000-01-01 00:00:00Z';
  UPDATE user_push_tokens
    SET updated_at = v_updated_at_before,
        device_label = 'Alice iPhone (renamed)'
    WHERE id = v_token_id;
  SELECT updated_at INTO v_updated_at_after FROM user_push_tokens WHERE id = v_token_id;
  PERFORM tap_ok(v_updated_at_after > v_updated_at_before, 'the handle_times trigger stamps updated_at on UPDATE');

  -- (16) a different user cannot DELETE someone else's row.
  PERFORM test_become(v_bob);
  BEGIN
    DELETE FROM user_push_tokens WHERE id = v_token_id;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
  -- Verify the row survived as the owner (alice); bob cannot SELECT it under
  -- own-scoped RLS (test 11), so the survival check must run as alice or it
  -- would read 0 regardless of whether the delete had any effect.
  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_other_visible FROM user_push_tokens WHERE id = v_token_id;
  v_other_delete_denied := (v_other_visible = 1);
  PERFORM tap_ok(v_other_delete_denied, 'a different user''s DELETE on another user''s push-token row has no effect (RLS-scoped)');

  -- (17) anon has no grant on the table at all.
  PERFORM test_become_anon();
  BEGIN
    PERFORM COUNT(*) FROM user_push_tokens;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_anon_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_anon_denied, 'anon has no SELECT grant on user_push_tokens');

  -- (18) the owner can DELETE their own row (hard-delete path per AC 5).
  PERFORM test_become(v_alice);
  DELETE FROM user_push_tokens WHERE id = v_token_id;
  SELECT COUNT(*) INTO v_after_delete FROM user_push_tokens WHERE id = v_token_id;
  v_own_delete_ok := (v_after_delete = 0);
  PERFORM tap_ok(v_own_delete_ok, 'the owner can DELETE their own push-token row');

  -- (19) default columns: last_used_at / created_at / updated_at default to
  -- NOW() and is_deleted defaults to FALSE when omitted on INSERT.
  DECLARE
    v_default_row RECORD;
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[defaults]', 'android')
    RETURNING is_deleted, (last_used_at IS NOT NULL) AS has_last_used_at,
              (created_at IS NOT NULL) AS has_created_at, (updated_at IS NOT NULL) AS has_updated_at
    INTO v_default_row;
    PERFORM tap_ok(
      v_default_row.is_deleted = FALSE
        AND v_default_row.has_last_used_at
        AND v_default_row.has_created_at
        AND v_default_row.has_updated_at,
      'is_deleted defaults to FALSE and last_used_at/created_at/updated_at default to NOW() when omitted'
    );
    DELETE FROM user_push_tokens WHERE expo_push_token = 'ExponentPushToken[defaults]';
  END;

  -- (20) a valid 'ios'/'android' platform value is accepted (positive CHECK case).
  DECLARE
    v_platform_accepted BOOLEAN := FALSE;
  BEGIN
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[android-ok]', 'android');
    v_platform_accepted := TRUE;
    DELETE FROM user_push_tokens WHERE expo_push_token = 'ExponentPushToken[android-ok]';
    PERFORM tap_ok(v_platform_accepted, 'platform = ''android'' is accepted by the CHECK constraint');
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM tap_ok(FALSE, 'platform = ''android'' is accepted by the CHECK constraint');
  END;

  -- (21/22) Soft-deleted-row reclaim round trip. The UNIQUE (user_id,
  -- expo_push_token) constraint is NON-PARTIAL, so a soft-deleted row still
  -- occupies the unique slot: a fresh-uuid() INSERT for the same
  -- (user_id, expo_push_token) raises 23505 (21). The correct re-registration
  -- path is therefore a server-authoritative UPDATE that flips is_deleted back
  -- to FALSE on the existing row (22) — not a new insert. This is the DB-level
  -- guarantee behind the client's two-tier reclaim; a mocked unit test cannot
  -- prove the constraint's non-partial shape against real data.
  DECLARE
    v_reclaim_id        UUID := gen_random_uuid();
    v_softdel_collision BOOLEAN := FALSE;
    v_reclaim_live      INT;
  BEGIN
    PERFORM test_become(v_alice);
    -- Seed a row, then soft-delete it (the client's Legend-State delete maps to
    -- is_deleted = TRUE via the global fieldDeleted: 'is_deleted' config).
    INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
    VALUES (v_reclaim_id, v_alice, 'ExponentPushToken[reclaim]', 'ios');
    UPDATE user_push_tokens SET is_deleted = TRUE WHERE id = v_reclaim_id;

    -- (21) a fresh-uuid() INSERT for the same (user_id, expo_push_token)
    -- collides with the surviving soft-deleted row (constraint is non-partial).
    BEGIN
      INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
      VALUES (gen_random_uuid(), v_alice, 'ExponentPushToken[reclaim]', 'ios');
    EXCEPTION
      WHEN unique_violation THEN v_softdel_collision := TRUE;
    END;
    PERFORM tap_ok(
      v_softdel_collision,
      'a fresh INSERT collides (23505) with a soft-deleted row — UNIQUE (user_id, expo_push_token) is non-partial'
    );

    -- (22) Tier 2 reclaim: UPDATE the existing soft-deleted row back to live on
    -- its own id restores exactly one live row for the device (no duplicate).
    UPDATE user_push_tokens
      SET is_deleted = FALSE,
          last_used_at = NOW(),
          platform = 'android',
          device_label = 'Alice iPhone'
      WHERE id = v_reclaim_id;
    SELECT COUNT(*) INTO v_reclaim_live
    FROM user_push_tokens
    WHERE user_id = v_alice
      AND expo_push_token = 'ExponentPushToken[reclaim]'
      AND is_deleted = FALSE;
    PERFORM tap_ok(
      v_reclaim_live = 1,
      'Tier 2 reclaim (UPDATE is_deleted=FALSE on the soft-deleted row) restores exactly one live row — no duplicate'
    );

    DELETE FROM user_push_tokens WHERE id = v_reclaim_id;
  END;
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
