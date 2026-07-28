-- t33: recording a moderation note writes only the audit-log entry (no
-- other table changes) whether the note targets a post or a user, and a
-- note with no subject at all is rejected before anything is written.
--
-- Red phase: FAILS because add_moderation_note does not exist yet — the
-- first note-on-post call below is uncaught, so the whole assertion block
-- errors out before any tap_ok lines are emitted.

BEGIN;
\i _helpers.psql
SELECT plan(8);

DO $$
DECLARE
  v_admin                  UUID;
  v_post_owner             UUID;
  v_target_user            UUID;
  v_post                   UUID := gen_random_uuid();
  v_post_note_count        INT;
  v_is_removed             BOOLEAN;
  v_user_note_count        INT;
  v_suspension_count       INT;
  v_state                  TEXT;
  v_rejected               BOOLEAN := FALSE;
  v_total_after            INT;
  v_rejected_missing_post  BOOLEAN := FALSE;
  v_rejected_missing_user  BOOLEAN := FALSE;
BEGIN
  v_admin       := test_seed_user();
  v_post_owner  := test_seed_user();
  v_target_user := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_post_owner, 'Borderline post under watch', 'borderline-body');

  PERFORM test_become_admin(v_admin);
  PERFORM add_moderation_note('borderline call, leaving as-is for now', v_post, NULL);

  RESET ROLE;
  SELECT count(*) INTO v_post_note_count
  FROM moderation_actions
  WHERE target_post_id = v_post AND action_type = 'add_note' AND actor_user_id = v_admin;
  SELECT is_removed INTO v_is_removed FROM collective_posts WHERE id = v_post;

  PERFORM tap_ok(v_post_note_count = 1, 'a note attached to a post writes exactly one audit-log entry');
  PERFORM tap_ok(v_is_removed IS FALSE, 'attaching a note to a post changes no other post state');

  PERFORM test_become_admin(v_admin);
  PERFORM add_moderation_note('pattern of borderline replies, watching this account', NULL, v_target_user);

  RESET ROLE;
  SELECT count(*) INTO v_user_note_count
  FROM moderation_actions
  WHERE target_user_id = v_target_user AND action_type = 'add_note' AND actor_user_id = v_admin;
  SELECT count(*) INTO v_suspension_count FROM user_suspensions WHERE user_id = v_target_user;

  PERFORM tap_ok(v_user_note_count = 1,   'a note attached to a user writes exactly one audit-log entry');
  PERFORM tap_ok(v_suspension_count = 0,  'attaching a note to a user creates no suspension row');

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM add_moderation_note('note with no subject', NULL, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected := TRUE; END IF;
  END;

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM add_moderation_note('note on a post that does not exist', gen_random_uuid(), NULL);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_missing_post := TRUE; END IF;
  END;

  BEGIN
    PERFORM add_moderation_note('note on a user that does not exist', NULL, gen_random_uuid());
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_missing_user := TRUE; END IF;
  END;

  RESET ROLE;
  SELECT count(*) INTO v_total_after FROM moderation_actions WHERE actor_user_id = v_admin;

  PERFORM tap_ok(v_rejected,           'a note with no post or user target is rejected as invalid input');
  PERFORM tap_ok(v_total_after = 2,    'a rejected subject-less note writes no additional audit-log entry');
  PERFORM tap_ok(v_rejected_missing_post, 'a note targeting a nonexistent post is rejected as invalid input');
  PERFORM tap_ok(v_rejected_missing_user, 'a note targeting a nonexistent user is rejected as invalid input');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
