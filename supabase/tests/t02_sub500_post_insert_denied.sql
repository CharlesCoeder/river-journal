-- t02: Sub-500 user INSERT into collective_posts must be denied by RLS.
--
-- Red phase: FAILS because collective_posts table + RLS policy do not exist.

BEGIN;
\i _helpers.sql
SELECT plan(1);

DO $$
DECLARE
  v_uid UUID;
  v_blocked BOOLEAN := FALSE;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_sub500_today(v_uid);
  PERFORM test_become(v_uid);

  BEGIN
    INSERT INTO collective_posts (id, user_id, body)
    VALUES (gen_random_uuid(), v_uid, 'should-not-land-t02');
  EXCEPTION
    -- 42501 = insufficient_privilege; Postgres returns this for RLS-denied INSERTs.
    WHEN insufficient_privilege THEN v_blocked := TRUE;
    WHEN check_violation       THEN v_blocked := TRUE;
    -- Some Postgres versions surface RLS as new_row_violates_row_level_security.
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blocked := TRUE; END IF;
  END;

  PERFORM ok(v_blocked, 'sub-500 user INSERT must be RLS-denied');
END $$;

SELECT * FROM finish();
ROLLBACK;
