-- t53: operational_health_log -- the service-role-only sink the
-- operational-health sampler cron writes its aggregate samples into (the
-- moderation queue depth every tick, the sync-opt-in counts once per
-- operator-day) now that no external analytics sink exists.
--
-- Coverage map:
--   A. schema shape -- identity BIGINT PK; the four INTEGER sample columns
--      all nullable (NULL = "pass did not sample", never a fake zero);
--      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW().
--   B. RLS/GRANT posture -- RLS is enabled, carries NO client policies at
--      all, and both anon and authenticated are denied SELECT and INSERT
--      outright (service-role-internal only; REVOKE ALL FROM anon,
--      authenticated, matching the moderation_notification_log posture).
--   C. write semantics -- a service-role insert of ONLY the moderation pair
--      lands one row with captured_at defaulted and the sync pair NULL
--      (the shape the cron writes on every non-snapshot tick).

BEGIN;
\i _helpers.psql
SELECT plan(9);

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
    ('id',                         'bigint',                   'NO'),
    ('pending_count',              'integer',                  'YES'),
    ('oldest_pending_age_seconds', 'integer',                  'YES'),
    ('opted_in_count',             'integer',                  'YES'),
    ('total_count',                'integer',                  'YES'),
    ('captured_at',                'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'operational_health_log'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('operational_health_log columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );
END $$;

DO $$
DECLARE
  v_pk_cols TEXT[];
BEGIN
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attname), ARRAY[]::TEXT[])
  INTO v_pk_cols
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.operational_health_log'::regclass
    AND con.contype = 'p';

  PERFORM tap_ok(
    v_pk_cols = ARRAY['id'],
    'id is the sole PRIMARY KEY column'
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
  WHERE oid = 'public.operational_health_log'::regclass;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'operational_health_log';

  PERFORM tap_ok(COALESCE(v_rls_enabled, FALSE), 'row level security is enabled on operational_health_log');
  PERFORM tap_ok(COALESCE(v_policy_count, -1) = 0, 'operational_health_log carries NO client-facing RLS policies');
END $$;

DO $$
DECLARE
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
    PERFORM count(*) FROM operational_health_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_auth_select_denied := TRUE; END IF;
  END;
  BEGIN
    INSERT INTO operational_health_log (pending_count) VALUES (1);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_auth_insert_denied := TRUE; END IF;
  END;

  PERFORM test_become_anon();
  BEGIN
    PERFORM count(*) FROM operational_health_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_anon_select_denied := TRUE; END IF;
  END;
  BEGIN
    INSERT INTO operational_health_log (pending_count) VALUES (1);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_anon_insert_denied := TRUE; END IF;
  END;

  RESET ROLE;

  PERFORM tap_ok(v_auth_select_denied, 'an authenticated SELECT on operational_health_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_auth_insert_denied, 'an authenticated INSERT on operational_health_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_anon_select_denied, 'an anon SELECT on operational_health_log is denied with insufficient_privilege');
  PERFORM tap_ok(v_anon_insert_denied, 'an anon INSERT on operational_health_log is denied with insufficient_privilege');
END $$;

-- ==========================================================================
-- C. Write semantics: a moderation-only sample defaults captured_at and
--    leaves the sync pair NULL.
-- ==========================================================================
DO $$
DECLARE
  v_id BIGINT;
  v_ok BOOLEAN;
BEGIN
  INSERT INTO operational_health_log (pending_count, oldest_pending_age_seconds)
  VALUES (3, 120)
  RETURNING id INTO v_id;

  SELECT (pending_count = 3
      AND oldest_pending_age_seconds = 120
      AND opted_in_count IS NULL
      AND total_count IS NULL
      AND captured_at IS NOT NULL)
  INTO v_ok
  FROM operational_health_log
  WHERE id = v_id;

  PERFORM tap_ok(COALESCE(v_ok, FALSE), 'a moderation-only sample row lands with captured_at defaulted and the sync pair NULL');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
