-- t10: Calling delete_my_post on an already-soft-deleted post raises the
-- same ambiguous SQLSTATE 42501. (Story 3.13 client treats this as success.)
--
-- Red phase: FAILS because delete_my_post does not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(1);

DO $$
DECLARE
  v_a UUID;
  v_post UUID := gen_random_uuid();
  v_state TEXT;
  v_denied BOOLEAN := FALSE;
BEGIN
  v_a := test_seed_user();
  PERFORM test_seed_500_today(v_a);
  PERFORM test_become(v_a);
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_post, v_a, 'will-double-delete-t10');

  PERFORM delete_my_post(v_post);

  BEGIN
    PERFORM delete_my_post(v_post);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;

  PERFORM tap_ok(v_denied, 'second delete_my_post on same post must raise 42501 (idempotent ambiguous error)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
