-- t34: reinstating a previously removed post, as an admin, atomically
-- clears the removal state and writes a matching audit-log entry, and
-- reinstating a post that does not exist is rejected.
--
-- The moderation functions covered across this suite are also swept by the
-- dynamic search-path-pinning assertion that runs over every SECURITY
-- DEFINER function in the schema — no separate coverage needed here.
--
-- Red phase: FAILS because reinstate_post does not exist yet — the
-- happy-path call below is uncaught, so the whole assertion block errors
-- out before any tap_ok lines are emitted.

BEGIN;
\i _helpers.psql
SELECT plan(5);

DO $$
DECLARE
  v_admin          UUID;
  v_post_owner     UUID;
  v_post           UUID := gen_random_uuid();
  v_is_removed     BOOLEAN;
  v_removed_reason TEXT;
  v_removed_at     TIMESTAMPTZ;
  v_action_count   INT;
  v_state          TEXT;
  v_rejected       BOOLEAN := FALSE;
BEGIN
  v_admin      := test_seed_user();
  v_post_owner := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body, is_removed, removed_reason, removed_at)
  VALUES (v_post, v_post_owner, 'Previously removed post', 'removed-body', TRUE, 'spam', NOW());

  PERFORM test_become_admin(v_admin);
  PERFORM reinstate_post(v_post, 'appeal upheld on review');

  RESET ROLE;
  SELECT is_removed, removed_reason, removed_at
  INTO v_is_removed, v_removed_reason, v_removed_at
  FROM collective_posts WHERE id = v_post;

  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_post_id = v_post
    AND action_type = 'reinstate'
    AND actor_user_id = v_admin
    AND reason = 'appeal upheld on review';

  PERFORM tap_ok(v_is_removed IS FALSE,     'reinstating clears the removed flag');
  PERFORM tap_ok(v_removed_reason IS NULL,  'reinstating clears the removal reason');
  PERFORM tap_ok(v_removed_at IS NULL,      'reinstating clears the removal timestamp');
  PERFORM tap_ok(v_action_count = 1,        'exactly one audit-log entry captures the reinstatement with actor/reason');

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM reinstate_post(gen_random_uuid(), 'no such post');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected := TRUE; END IF;
  END;

  PERFORM tap_ok(v_rejected, 'reinstating a nonexistent post is rejected as invalid input');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
