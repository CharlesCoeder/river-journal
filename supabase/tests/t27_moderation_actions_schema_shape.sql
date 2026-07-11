-- t27: moderation_actions structural shape.
-- Columns/types/nullability, the action_type CHECK vocabulary, the
-- ON DELETE SET NULL behavior of the actor/target FKs (the audit row must
-- survive account deletion, anonymized not erased), and the three time-series
-- indexes.
--
-- Activated once the moderation_actions table exists.

BEGIN;
\i _helpers.psql
SELECT plan(8);

DO $$
DECLARE
  v_mismatched    TEXT[];
  v_bad_fks       TEXT[];
  v_actor         UUID;
  v_target        UUID;
  v_row_id        UUID := gen_random_uuid();
  v_accepted      BOOLEAN := FALSE;
  v_rejected      BOOLEAN := FALSE;
  v_actor_after   UUID;
  v_idx_post      INT;
  v_idx_user      INT;
  v_idx_created   INT;
BEGIN
  -- (1) column shape: name/type/nullability for every declared column.
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('id',             'uuid',                      'NO'),
    ('actor_user_id',  'uuid',                      'YES'),
    ('action_type',    'text',                      'NO'),
    ('target_post_id', 'uuid',                      'YES'),
    ('target_user_id', 'uuid',                      'YES'),
    ('reason',         'text',                      'YES'),
    ('note',           'text',                      'YES'),
    ('metadata',       'jsonb',                     'YES'),
    ('created_at',     'timestamp with time zone',  'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'moderation_actions'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('moderation_actions columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );

  -- (2) actor_user_id / target_user_id / target_post_id are all ON DELETE
  -- SET NULL foreign keys (declarative check via pg_constraint.confdeltype).
  SELECT COALESCE(array_agg(cols.col ORDER BY cols.col), ARRAY[]::TEXT[])
  INTO v_bad_fks
  FROM (VALUES ('actor_user_id'), ('target_user_id'), ('target_post_id')) AS cols(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.conrelid = 'public.moderation_actions'::regclass
      AND con.contype = 'f'
      AND con.confdeltype = 'n' -- 'n' = SET NULL
      AND att.attname = cols.col
  );

  PERFORM tap_ok(
    cardinality(v_bad_fks) = 0,
    format('actor/target FKs are all ON DELETE SET NULL (missing/wrong: %s)', COALESCE(array_to_string(v_bad_fks, ', '), ''))
  );

  -- (3)/(4) action_type CHECK vocabulary.
  v_actor := test_seed_user();
  v_target := test_seed_user();

  BEGIN
    INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
    VALUES (v_row_id, v_actor, 'suspend_user', v_target);
    v_accepted := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'in-set action_type (suspend_user) is accepted (seeded as owner)');

  BEGIN
    INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
    VALUES (gen_random_uuid(), v_actor, 'not_a_real_action', v_target);
    v_rejected := FALSE;
  EXCEPTION
    WHEN check_violation THEN v_rejected := TRUE;
  END;
  PERFORM tap_ok(v_rejected, 'out-of-set action_type is rejected by CHECK');

  -- (5) operational sentinel: deleting the actor's account SETs NULL, never
  -- deletes the audit row (append-only accountability trail). public.users.id
  -- -> auth.users(id) ON DELETE CASCADE, so deleting the auth.users row
  -- cascades into public.users, which in turn fires
  -- moderation_actions.actor_user_id's SET NULL.
  DELETE FROM auth.users WHERE id = v_actor;
  SELECT actor_user_id INTO v_actor_after FROM moderation_actions WHERE id = v_row_id;
  PERFORM tap_ok(
    v_actor_after IS NULL,
    'actor_user_id is SET NULL (row survives) when the actor account is deleted'
  );

  -- (6)-(8) the three time-series indexes on moderation_actions.
  SELECT count(*) INTO v_idx_post
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'moderation_actions'
    AND indexdef ~* 'target_post_id.*created_at.*desc';
  PERFORM tap_ok(v_idx_post >= 1, 'index on moderation_actions(target_post_id, created_at DESC) exists');

  SELECT count(*) INTO v_idx_user
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'moderation_actions'
    AND indexdef ~* 'target_user_id.*created_at.*desc';
  PERFORM tap_ok(v_idx_user >= 1, 'index on moderation_actions(target_user_id, created_at DESC) exists');

  SELECT count(*) INTO v_idx_created
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'moderation_actions'
    AND indexdef ~* '\(created_at desc\)';
  PERFORM tap_ok(v_idx_created >= 1, 'time-series index on moderation_actions(created_at DESC) exists');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
