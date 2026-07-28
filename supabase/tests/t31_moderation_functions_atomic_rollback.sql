-- t31: a moderation write and its audit-log entry are atomic — if the
-- audit-log insert fails for any reason, the accompanying state change
-- rolls back with it rather than being left half-applied. Verified by
-- forcing the audit-log insert to fail via a temporary trigger and
-- confirming the paired state change (post removal / new suspension) never
-- lands.
--
-- Red phase: the capture blocks only flip their flag when the caught
-- SQLSTATE is the forced-failure code (P0001). Before remove_post/
-- suspend_user exist, the call instead raises "function ... does not
-- exist" (a different SQLSTATE), so the flag stays FALSE and the
-- assertions fail cleanly.

BEGIN;
\i _helpers.psql

-- A tiny trigger function that always raises, used to force the audit-log
-- INSERT step inside each moderation function to fail so its atomicity can
-- be observed. Defined for the duration of this test transaction only.
CREATE OR REPLACE FUNCTION t31_raise_on_moderation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced audit-log insert failure' USING ERRCODE = 'P0001';
END;
$$;

SELECT plan(2);

DO $$
DECLARE
  v_admin            UUID;
  v_post_owner       UUID;
  v_target           UUID;
  v_post             UUID := gen_random_uuid();
  v_state            TEXT;
  v_caught_remove    BOOLEAN := FALSE;
  v_caught_suspend   BOOLEAN := FALSE;
  v_is_removed       BOOLEAN;
  v_suspension_count INT;
BEGIN
  v_admin      := test_seed_user();
  v_post_owner := test_seed_user();
  v_target     := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_post_owner, 'Post targeted for atomicity check', 'atomicity-body');

  CREATE TRIGGER t31_force_fail
    BEFORE INSERT ON moderation_actions
    FOR EACH ROW EXECUTE FUNCTION t31_raise_on_moderation_insert();

  PERFORM test_become_admin(v_admin);

  BEGIN
    PERFORM remove_post(v_post, 'harassment');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = 'P0001' THEN v_caught_remove := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(v_target, 'post_react', 3);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = 'P0001' THEN v_caught_suspend := TRUE; END IF;
  END;

  RESET ROLE;
  DROP TRIGGER t31_force_fail ON moderation_actions;

  SELECT is_removed INTO v_is_removed FROM collective_posts WHERE id = v_post;
  SELECT count(*) INTO v_suspension_count FROM user_suspensions WHERE user_id = v_target;

  PERFORM tap_ok(
    v_caught_remove AND v_is_removed IS FALSE,
    'a forced audit-log failure rolls back the post-removal state change'
  );
  PERFORM tap_ok(
    v_caught_suspend AND v_suspension_count = 0,
    'a forced audit-log failure rolls back the suspension row (no orphan suspension)'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
