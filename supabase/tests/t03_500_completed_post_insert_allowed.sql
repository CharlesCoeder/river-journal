-- t03: 500-completed user INSERT into collective_posts must succeed.
--
-- Red phase: FAILS because collective_posts table + RLS INSERT policy +
-- daily_500_completed_today predicate do not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(1);

DO $$
DECLARE
  v_uid UUID;
  v_post_id UUID := gen_random_uuid();
  v_count INT;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);
  PERFORM test_become(v_uid);

  INSERT INTO collective_posts (id, user_id, body)
  VALUES (v_post_id, v_uid, 'happy-path-t03');

  -- Direct SELECT denied; verify via DEFINER-privileged context with SET ROLE postgres.
  RESET ROLE;
  SELECT COUNT(*) INTO v_count FROM collective_posts WHERE id = v_post_id;
  PERFORM tap_ok(v_count = 1, '500-completed user INSERT must land a row');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
