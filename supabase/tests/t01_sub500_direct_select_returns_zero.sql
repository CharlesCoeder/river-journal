-- t01: Sub-500 user direct SELECT on collective_posts returns zero rows or
-- raises permission_denied. This is the bypass-prevention regression — it
-- catches a future migration accidentally re-opening the read path.
--
-- Red phase: FAILS because collective_posts table does not exist yet.

BEGIN;
\i _helpers.psql
SELECT plan(1);

DO $$
DECLARE
  v_uid UUID;
  v_count INT;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_sub500_today(v_uid);

  -- A 500-completed user must seed a post first (so there IS a row to leak).
  -- This is intentional: the test only proves anything if a real row exists.
  DECLARE
    v_poster UUID := test_seed_user();
  BEGIN
    PERFORM test_seed_500_today(v_poster);
    PERFORM test_become(v_poster);
    INSERT INTO collective_posts (id, user_id, body)
    VALUES (gen_random_uuid(), v_poster, 'leak-canary-body-t01');
  END;

  PERFORM test_become(v_uid);
  BEGIN
    SELECT COUNT(*) INTO v_count FROM collective_posts;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_count := 0;
  END;

  PERFORM tap_ok(v_count = 0, 'sub-500 user must see zero rows from direct SELECT on collective_posts');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
