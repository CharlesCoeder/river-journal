-- t30: removing a post, as an admin, atomically marks the post removed,
-- writes a single audit-log entry capturing the actor/reason/note, and
-- resolves every open report against that post in the same transaction.
--
-- Red phase: FAILS because remove_post does not exist yet — the call below
-- is uncaught, so the whole assertion block errors out before any tap_ok
-- lines are emitted.

BEGIN;
\i _helpers.psql
SELECT plan(8);

DO $$
DECLARE
  v_admin           UUID;
  v_post_owner      UUID;
  v_reporter_a      UUID;
  v_reporter_b      UUID;
  v_reporter_c      UUID;
  v_post            UUID := gen_random_uuid();
  v_is_removed      BOOLEAN;
  v_removed_reason  TEXT;
  v_removed_at      TIMESTAMPTZ;
  v_action_count    INT;
  v_reviewed_count  INT;
  v_dismissed_status TEXT;
  v_state           TEXT;
  v_rejected_null    BOOLEAN := FALSE;
  v_rejected_missing BOOLEAN := FALSE;
BEGIN
  v_admin      := test_seed_user();
  v_post_owner := test_seed_user();
  v_reporter_a := test_seed_user();
  v_reporter_b := test_seed_user();
  v_reporter_c := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_post_owner, 'Reported post pending review', 'reported-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_reporter_a, 'spam', 'pending');
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_reporter_b, 'harassment', 'pending');
  -- A report already dismissed before the removal must stay dismissed — the
  -- resolution UPDATE only targets status='pending'.
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_reporter_c, 'spam', 'dismissed');

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_post, 'harassment', 'confirmed after review');

  RESET ROLE;
  SELECT is_removed, removed_reason, removed_at
  INTO v_is_removed, v_removed_reason, v_removed_at
  FROM collective_posts WHERE id = v_post;

  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_post_id = v_post
    AND action_type = 'remove_post'
    AND actor_user_id = v_admin
    AND reason = 'harassment'
    AND note = 'confirmed after review';

  SELECT count(*) INTO v_reviewed_count
  FROM collective_reports
  WHERE post_id = v_post AND status = 'reviewed';

  SELECT status INTO v_dismissed_status
  FROM collective_reports
  WHERE post_id = v_post AND reporter_user_id = v_reporter_c;

  PERFORM tap_ok(v_is_removed IS TRUE,       'admin removal marks the post as removed');
  PERFORM tap_ok(v_removed_reason = 'harassment', 'removal reason is recorded on the post');
  PERFORM tap_ok(v_removed_at IS NOT NULL,   'removal timestamp is stamped on the post');
  PERFORM tap_ok(v_action_count = 1,         'exactly one audit-log entry captures the removal with actor/reason/note');
  PERFORM tap_ok(v_reviewed_count = 2,       'every open report against the removed post is marked reviewed');
  PERFORM tap_ok(v_dismissed_status = 'dismissed', 'a report already dismissed is left untouched by the resolution update');

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM remove_post(NULL, 'harassment');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_null := TRUE; END IF;
  END;

  BEGIN
    PERFORM remove_post(gen_random_uuid(), 'harassment');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_missing := TRUE; END IF;
  END;

  PERFORM tap_ok(v_rejected_null,    'removing a NULL post id is rejected as invalid input');
  PERFORM tap_ok(v_rejected_missing, 'removing a nonexistent post is rejected as invalid input');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
