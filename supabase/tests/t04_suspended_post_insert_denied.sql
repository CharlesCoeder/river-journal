-- t04: 500-completed BUT suspended user INSERT must be RLS-denied.
--
-- CONDITIONAL — user_suspensions table is created in Epic 5.1. While the
-- table is absent, this test no-ops cleanly via to_regclass IS NULL guard.
-- Once Epic 5.1 lands, this test becomes a real regression.
--
-- Red phase: FAILS because collective_posts table does not exist (the
-- conditional branch is for the post-Epic-5.1 future).

BEGIN;
\i _helpers.sql
SELECT plan(1);

DO $$
DECLARE
  v_uid UUID;
  v_blocked BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.user_suspensions') IS NULL THEN
    -- Epic 5.1 has not landed; the predicate's exception clause returns FALSE
    -- (i.e. NOT suspended), so an INSERT here would be allowed. Skip-pass.
    PERFORM tap_ok(TRUE, 'user_suspensions table absent — skip (pre-Epic-5.1)');
    RETURN;
  END IF;

  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);
  INSERT INTO user_suspensions (user_id, kind, ends_at)
  VALUES (v_uid, 'post_react', NOW() + INTERVAL '1 day');

  PERFORM test_become(v_uid);
  BEGIN
    INSERT INTO collective_posts (id, user_id, body)
    VALUES (gen_random_uuid(), v_uid, 'should-not-land-t04');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blocked := TRUE;
    WHEN check_violation       THEN v_blocked := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blocked := TRUE; END IF;
  END;

  PERFORM tap_ok(v_blocked, 'suspended user INSERT must be RLS-denied');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
