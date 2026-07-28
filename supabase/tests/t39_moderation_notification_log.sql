-- t39: moderation_notification_log -- the idempotency ledger that lets the
-- (permanently append-only, unstampable) moderation_actions audit row still
-- support "was this action already notified?" via a side table keyed on
-- moderation_actions.id.
--
-- Coverage map:
--   A. schema shape -- moderation_action_id UUID PRIMARY KEY (FK to
--      moderation_actions(id) ON DELETE CASCADE) and notified_at TIMESTAMPTZ
--      NOT NULL DEFAULT NOW().
--   B. RLS/GRANT posture -- RLS is enabled, carries NO client policies at
--      all, and both anon and authenticated are denied SELECT and INSERT
--      outright (service-role-internal only; REVOKE ALL FROM anon,
--      authenticated per the ledger's REVOKE ALL posture).
--   C. dedupe semantics -- a first INSERT ... ON CONFLICT (moderation_
--      action_id) DO NOTHING succeeds and inserts exactly one row; a second,
--      identical INSERT via the same ON CONFLICT clause affects ZERO rows
--      (the no-op the function's dedupe short-circuit relies on) and leaves
--      exactly one row in place; a plain duplicate INSERT with no ON
--      CONFLICT clause raises a unique_violation (23505), proving the
--      uniqueness is a real PK constraint and not merely applicaton-level
--      discipline.
--   D. cascade -- deleting the referenced moderation_actions row removes the
--      ledger row with it (ON DELETE CASCADE), matching the "anonymize, but
--      an audit-adjacent housekeeping row may go" posture distinct from
--      moderation_actions' own actor/target ON DELETE SET NULL.
--
-- Red phase: moderation_notification_log does not exist yet, so every
-- INSERT/SELECT against it in blocks A, C, D raises "relation ... does not
-- exist", aborting those DO blocks before their tap_ok lines run -- an
-- unambiguous suite failure. Block B's probes are wrapped in exception
-- handlers, so they resolve their flags to FALSE and fail cleanly instead.

BEGIN;
\i _helpers.psql
SELECT plan(14);

-- ==========================================================================
-- A. Column shape.
-- ==========================================================================
DO $$
DECLARE
  v_mismatched TEXT[];
BEGIN
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('moderation_action_id', 'uuid',                     'NO'),
    ('notified_at',          'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'moderation_notification_log'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('moderation_notification_log columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );
END $$;

DO $$
DECLARE
  v_pk_cols     TEXT[];
  v_cascade_deltype TEXT;
BEGIN
  -- moderation_action_id is the PRIMARY KEY (single-column).
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attname), ARRAY[]::TEXT[])
  INTO v_pk_cols
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.moderation_notification_log'::regclass
    AND con.contype = 'p';

  PERFORM tap_ok(
    v_pk_cols = ARRAY['moderation_action_id'],
    'moderation_action_id is the sole PRIMARY KEY column'
  );

  -- moderation_action_id FK -> moderation_actions(id) is ON DELETE CASCADE.
  SELECT con.confdeltype INTO v_cascade_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.moderation_notification_log'::regclass
    AND con.contype = 'f'
    AND att.attname = 'moderation_action_id'
  LIMIT 1;

  PERFORM tap_ok(
    v_cascade_deltype = 'c',
    'moderation_notification_log.moderation_action_id FK to moderation_actions is ON DELETE CASCADE'
  );
END $$;

-- ==========================================================================
-- B. RLS/GRANT posture: no client policies, anon/authenticated fully denied.
-- ==========================================================================
DO $$
DECLARE
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
BEGIN
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.moderation_notification_log'::regclass;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'moderation_notification_log';

  PERFORM tap_ok(COALESCE(v_rls_enabled, FALSE), 'row level security is enabled on moderation_notification_log');
  PERFORM tap_ok(COALESCE(v_policy_count, -1) = 0, 'moderation_notification_log carries NO client-facing RLS policies');
END $$;

DO $$
DECLARE
  v_probe_id UUID := gen_random_uuid();
  v_auth_select_denied BOOLEAN := FALSE;
  v_auth_insert_denied BOOLEAN := FALSE;
  v_anon_select_denied BOOLEAN := FALSE;
  v_anon_insert_denied BOOLEAN := FALSE;
  v_state TEXT;
  v_non_admin UUID;
BEGIN
  v_non_admin := test_seed_user();

  PERFORM test_become(v_non_admin);
  BEGIN
    PERFORM count(*) FROM moderation_notification_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_auth_select_denied := TRUE; END IF;
  END;
  BEGIN
    INSERT INTO moderation_notification_log (moderation_action_id) VALUES (v_probe_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_auth_insert_denied := TRUE; END IF;
  END;

  PERFORM test_become_anon();
  BEGIN
    PERFORM count(*) FROM moderation_notification_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_anon_select_denied := TRUE; END IF;
  END;
  BEGIN
    INSERT INTO moderation_notification_log (moderation_action_id) VALUES (v_probe_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_anon_insert_denied := TRUE; END IF;
  END;

  RESET ROLE;

  PERFORM tap_ok(v_auth_select_denied, 'an authenticated (non-admin) SELECT on moderation_notification_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_auth_insert_denied, 'an authenticated (non-admin) INSERT on moderation_notification_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_anon_select_denied, 'an anon SELECT on moderation_notification_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_anon_insert_denied, 'an anon INSERT on moderation_notification_log is denied with insufficient_privilege');
END $$;

-- ==========================================================================
-- C. Dedupe semantics: PK/ON CONFLICT makes a repeat insert a genuine no-op.
-- ==========================================================================
DO $$
DECLARE
  v_actor        UUID;
  v_action_id    UUID := gen_random_uuid();
  v_first_count  INT;
  v_second_rowcount INT;
  v_after_count  INT;
  v_raw_duplicate_rejected BOOLEAN := FALSE;
  v_state        TEXT;
BEGIN
  v_actor := test_seed_user();

  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_action_id, v_actor, 'add_note', v_actor);

  INSERT INTO moderation_notification_log (moderation_action_id)
  VALUES (v_action_id)
  ON CONFLICT (moderation_action_id) DO NOTHING;

  SELECT count(*) INTO v_first_count FROM moderation_notification_log WHERE moderation_action_id = v_action_id;
  PERFORM tap_ok(v_first_count = 1, 'the first insert-first dedupe write lands exactly one ledger row');

  INSERT INTO moderation_notification_log (moderation_action_id)
  VALUES (v_action_id)
  ON CONFLICT (moderation_action_id) DO NOTHING;
  GET DIAGNOSTICS v_second_rowcount = ROW_COUNT;

  SELECT count(*) INTO v_after_count FROM moderation_notification_log WHERE moderation_action_id = v_action_id;

  PERFORM tap_ok(v_second_rowcount = 0, 'a repeated ON CONFLICT DO NOTHING insert for the same moderation_action_id affects zero rows (the dedupe no-op)');
  PERFORM tap_ok(v_after_count = 1, 'exactly one ledger row remains for the id after the repeated no-op insert');

  BEGIN
    INSERT INTO moderation_notification_log (moderation_action_id) VALUES (v_action_id);
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      v_raw_duplicate_rejected := (v_state = '23505');
  END;
  PERFORM tap_ok(v_raw_duplicate_rejected, 'a plain duplicate insert with no ON CONFLICT clause is rejected as a real unique_violation (23505), not just app-level discipline');
END $$;

-- ==========================================================================
-- D. Cascade: deleting the moderation_actions row removes the ledger row.
-- ==========================================================================
DO $$
DECLARE
  v_actor     UUID;
  v_action_id UUID := gen_random_uuid();
  v_after_count INT;
BEGIN
  v_actor := test_seed_user();

  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_action_id, v_actor, 'add_note', v_actor);

  INSERT INTO moderation_notification_log (moderation_action_id)
  VALUES (v_action_id)
  ON CONFLICT (moderation_action_id) DO NOTHING;

  DELETE FROM moderation_actions WHERE id = v_action_id;

  SELECT count(*) INTO v_after_count FROM moderation_notification_log WHERE moderation_action_id = v_action_id;
  PERFORM tap_ok(v_after_count = 0, 'deleting the referenced moderation_actions row cascade-deletes the ledger row');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
