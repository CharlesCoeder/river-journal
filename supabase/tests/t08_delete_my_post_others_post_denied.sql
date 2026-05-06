-- t08: User B calling delete_my_post on user A's post must raise the
-- ambiguous SQLSTATE 42501 / message 'cannot delete this post'.
--
-- Red phase: FAILS because delete_my_post + collective_posts do not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(2);

DO $$
DECLARE
  v_a UUID;
  v_b UUID;
  v_post UUID := gen_random_uuid();
  v_state TEXT;
  v_msg   TEXT;
  v_denied BOOLEAN := FALSE;
  v_msg_match BOOLEAN := FALSE;
BEGIN
  v_a := test_seed_user();
  v_b := test_seed_user();
  PERFORM test_seed_500_today(v_a);
  PERFORM test_seed_500_today(v_b);

  PERFORM test_become(v_a);
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_post, v_a, 'A-owned-t08');

  PERFORM test_become(v_b);
  BEGIN
    PERFORM delete_my_post(v_post);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_msg   = MESSAGE_TEXT;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
      IF v_msg = 'cannot delete this post' THEN v_msg_match := TRUE; END IF;
  END;

  PERFORM ok(v_denied,    'delete_my_post on someone else''s post must raise SQLSTATE 42501');
  PERFORM ok(v_msg_match, 'error message must be the ambiguous "cannot delete this post"');
END $$;

SELECT * FROM finish();
ROLLBACK;
