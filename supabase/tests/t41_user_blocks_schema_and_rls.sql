-- t41: user_blocks structural shape + one-sided RLS.
--
-- Coverage:
--   * column shape (id/blocker_user_id/blocked_user_id/created_at)
--   * both FK columns are ON DELETE CASCADE against users(id)
--   * UNIQUE (blocker_user_id, blocked_user_id) makes a block idempotent
--   * CHECK rejects a self-block row
--   * both supporting indexes exist (forward list + reverse predicate probe)
--   * RLS is enabled and one-sided: the blocker can INSERT/SELECT/DELETE
--     their own rows; the blocked party can see NOTHING naming them, in
--     either an unfiltered SELECT or a SELECT filtered on their own id
--     (the "silent to the blocked side" invariant, checked both ways);
--     nobody can INSERT a row on someone else's behalf; there is no UPDATE
--     policy (rows are immutable — unblock is a DELETE, re-block is a
--     fresh INSERT); anon has no grants at all.
--
-- Red phase: the table does not exist yet, so every DML statement below
-- raises "relation ... does not exist" and the whole file aborts with no
-- TAP output — an unambiguous suite failure until the migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(18);

DO $$
DECLARE
  v_mismatched      TEXT[];
  v_alice           UUID;
  v_bob             UUID;
  v_carol           UUID;
  v_pk_count        INT;
  v_blocker_deltype TEXT;
  v_blocked_deltype TEXT;
  v_unique_cols     TEXT[];
  v_idx_forward     INT;
  v_idx_reverse     INT;
  v_rls_enabled     BOOLEAN;
  v_self_rejected   BOOLEAN := FALSE;
  v_dup_rejected    BOOLEAN := FALSE;
  v_accepted        BOOLEAN := FALSE;
  v_own_visible     INT;
  v_blocked_all     INT;
  v_blocked_reverse INT;
  v_state           TEXT;
  v_third_denied    BOOLEAN := FALSE;
  v_update_denied   BOOLEAN := FALSE;
  v_anon_denied     BOOLEAN := FALSE;
  v_after_delete    INT;
BEGIN
  -- (1) column shape: name/type/nullability for every declared column.
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('id',               'uuid',                     'NO'),
    ('blocker_user_id',  'uuid',                     'NO'),
    ('blocked_user_id',  'uuid',                     'NO'),
    ('created_at',       'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'user_blocks'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('user_blocks columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );

  -- (2) primary key on id.
  SELECT COUNT(*) INTO v_pk_count
  FROM pg_constraint
  WHERE conrelid = 'public.user_blocks'::regclass
    AND contype = 'p';
  PERFORM tap_ok(v_pk_count = 1, 'user_blocks has a primary key');

  -- (3)/(4) both FK columns are ON DELETE CASCADE against users.
  SELECT con.confdeltype INTO v_blocker_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_blocks'::regclass
    AND con.contype = 'f'
    AND att.attname = 'blocker_user_id'
  LIMIT 1;
  PERFORM tap_ok(v_blocker_deltype = 'c', 'user_blocks.blocker_user_id FK is ON DELETE CASCADE');

  SELECT con.confdeltype INTO v_blocked_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_blocks'::regclass
    AND con.contype = 'f'
    AND att.attname = 'blocked_user_id'
  LIMIT 1;
  PERFORM tap_ok(v_blocked_deltype = 'c', 'user_blocks.blocked_user_id FK is ON DELETE CASCADE');

  -- (5) UNIQUE (blocker_user_id, blocked_user_id) — idempotency contract.
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attname), ARRAY[]::TEXT[])
  INTO v_unique_cols
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_blocks'::regclass
    AND con.contype = 'u';
  PERFORM tap_ok(
    v_unique_cols = ARRAY['blocked_user_id', 'blocker_user_id'],
    format('UNIQUE (blocker_user_id, blocked_user_id) constraint exists (found: %s)', COALESCE(array_to_string(v_unique_cols, ', '), ''))
  );

  -- (6)/(7) supporting indexes.
  SELECT COUNT(*) INTO v_idx_forward
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'user_blocks'
    AND indexdef ~* 'blocker_user_id.*created_at.*desc';
  PERFORM tap_ok(v_idx_forward >= 1, 'index on user_blocks(blocker_user_id, created_at DESC) exists');

  SELECT COUNT(*) INTO v_idx_reverse
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'user_blocks'
    AND indexdef ~* 'blocked_user_id.*blocker_user_id'
    AND indexdef !~* 'created_at';
  PERFORM tap_ok(v_idx_reverse >= 1, 'reverse-direction index on user_blocks(blocked_user_id, blocker_user_id) exists');

  -- (8) RLS enabled.
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.user_blocks'::regclass;
  PERFORM tap_ok(COALESCE(v_rls_enabled, FALSE), 'row level security is enabled on user_blocks');

  -- Fixture for the behavioral assertions below.
  v_alice := test_seed_user();
  v_bob   := test_seed_user();
  v_carol := test_seed_user();

  -- (9) self-block is rejected by CHECK, seeded directly as table owner so
  -- this isolates the constraint from RLS.
  BEGIN
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_alice);
  EXCEPTION
    WHEN check_violation THEN v_self_rejected := TRUE;
  END;
  PERFORM tap_ok(v_self_rejected, 'a self-block row is rejected by CHECK (blocker_user_id <> blocked_user_id)');

  -- (10) duplicate (blocker, blocked) pair is rejected by UNIQUE, seeded
  -- directly as table owner.
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);
  BEGIN
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);
  EXCEPTION
    WHEN unique_violation THEN v_dup_rejected := TRUE;
  END;
  PERFORM tap_ok(v_dup_rejected, 'a duplicate (blocker, blocked) pair raises unique_violation');
  DELETE FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;

  -- (11)/(12) blocker can INSERT and SELECT their own row via RLS.
  PERFORM test_become(v_alice);
  BEGIN
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);
    v_accepted := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'the blocker can INSERT their own block row (auth.uid() = blocker_user_id)');

  SELECT COUNT(*) INTO v_own_visible
  FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  PERFORM tap_ok(v_own_visible = 1, 'the blocker can SELECT the block row they just created');

  -- (13)/(14) the blocked party sees nothing naming them — unfiltered AND
  -- filtered on their own id (reverse lookup).
  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_blocked_all FROM user_blocks;
  PERFORM tap_ok(v_blocked_all = 0, 'the blocked user sees zero rows in an unfiltered SELECT (silent invariant)');

  SELECT COUNT(*) INTO v_blocked_reverse FROM user_blocks WHERE blocked_user_id = v_bob;
  PERFORM tap_ok(v_blocked_reverse = 0, 'the blocked user sees zero rows even filtering on their own blocked_user_id (reverse lookup)');

  -- (15) a third party cannot INSERT a row naming someone else as blocker.
  PERFORM test_become(v_carol);
  BEGIN
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_carol);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_third_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_third_denied, 'a caller cannot INSERT a block row naming a different user as blocker_user_id');

  -- (16) UPDATE is denied outright — no policy exists and no grant is given.
  PERFORM test_become(v_alice);
  BEGIN
    UPDATE user_blocks SET created_at = NOW()
    WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_update_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_update_denied, 'UPDATE on user_blocks is denied (no UPDATE policy, no UPDATE grant)');

  -- (17) anon has no grants on the table at all.
  PERFORM test_become_anon();
  BEGIN
    PERFORM COUNT(*) FROM user_blocks;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_anon_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_anon_denied, 'anon has no SELECT grant on user_blocks');

  -- (18) the blocker can DELETE their own row (unblock).
  PERFORM test_become(v_alice);
  DELETE FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  SELECT COUNT(*) INTO v_after_delete
  FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  PERFORM tap_ok(v_after_delete = 0, 'the blocker can DELETE their own block row (unblock)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
