-- t28: user_suspensions structural shape.
-- Columns/types/nullability, the `kind` CHECK vocabulary (MVP: 'post_react'
-- only), the ON DELETE CASCADE behavior of user_id, and the
-- (user_id, ends_at DESC) index backing is_active_suspension().
--
-- Activated once the user_suspensions table exists.

BEGIN;
\i _helpers.psql
SELECT plan(6);

DO $$
DECLARE
  v_mismatched  TEXT[];
  v_uid         UUID;
  v_row_id      UUID := gen_random_uuid();
  v_accepted    BOOLEAN := FALSE;
  v_rejected    BOOLEAN := FALSE;
  v_cascade_deltype TEXT;
  v_after_count INT;
  v_idx_count   INT;
BEGIN
  -- (1) column shape: name/type/nullability for every declared column.
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('id',         'uuid',                     'NO'),
    ('user_id',    'uuid',                     'NO'),
    ('kind',       'text',                     'NO'),
    ('starts_at',  'timestamp with time zone', 'NO'),
    ('ends_at',    'timestamp with time zone', 'NO'),
    ('reason',     'text',                     'YES'),
    ('created_at', 'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'user_suspensions'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('user_suspensions columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );

  -- (2)/(3) kind CHECK vocabulary (single allowed value at MVP).
  v_uid := test_seed_user();

  BEGIN
    INSERT INTO user_suspensions (id, user_id, kind, ends_at)
    VALUES (v_row_id, v_uid, 'post_react', NOW() + INTERVAL '1 day');
    v_accepted := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'in-set kind (post_react) is accepted (seeded as owner)');

  BEGIN
    INSERT INTO user_suspensions (id, user_id, kind, ends_at)
    VALUES (gen_random_uuid(), v_uid, 'ghost_mode', NOW() + INTERVAL '1 day');
    v_rejected := FALSE;
  EXCEPTION
    WHEN check_violation THEN v_rejected := TRUE;
  END;
  PERFORM tap_ok(v_rejected, 'out-of-set kind is rejected by CHECK (kind = ''post_react'' only at MVP)');

  -- (4) user_id FK is ON DELETE CASCADE (declarative check).
  SELECT con.confdeltype INTO v_cascade_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.user_suspensions'::regclass
    AND con.contype = 'f'
    AND att.attname = 'user_id'
  LIMIT 1;
  PERFORM tap_ok(v_cascade_deltype = 'c', 'user_suspensions.user_id FK is ON DELETE CASCADE');

  -- (5) operational sentinel: deleting the user's account removes their
  -- suspension row entirely (unlike moderation_actions' SET NULL — a deleted
  -- account's suspensions carry no ongoing meaning per design notes).
  DELETE FROM auth.users WHERE id = v_uid;
  SELECT count(*) INTO v_after_count FROM user_suspensions WHERE id = v_row_id;
  PERFORM tap_ok(v_after_count = 0, 'user_suspensions row is cascade-deleted when the account is deleted');

  -- (6) the index backing is_active_suspension().
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'user_suspensions'
    AND indexdef ~* 'user_id.*ends_at.*desc';
  PERFORM tap_ok(v_idx_count >= 1, 'index on user_suspensions(user_id, ends_at DESC) exists');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
