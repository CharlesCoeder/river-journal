-- t29: every admin-only moderation write path rejects a caller who is not
-- recognized as admin — including an unauthenticated caller — and leaves no
-- trace of the attempted action in any table it would otherwise write to.
--
-- Red phase: the four moderation functions do not exist yet, so each call
-- below raises "function ... does not exist" rather than the expected
-- authorization SQLSTATE. The capture blocks only flip their flag on an
-- exact 42501 match, so this mismatch is a clean assertion failure rather
-- than an uncaught error.

BEGIN;
\i _helpers.psql
SELECT plan(12);

DO $$
DECLARE
  v_post_owner        UUID;
  v_target_user       UUID;
  v_non_admin         UUID;
  v_explicit_false    UUID;
  v_post              UUID := gen_random_uuid();
  v_blk_remove        BOOLEAN := FALSE;
  v_blk_suspend       BOOLEAN := FALSE;
  v_blk_note          BOOLEAN := FALSE;
  v_blk_reinstate     BOOLEAN := FALSE;
  v_anon_remove       BOOLEAN := FALSE;
  v_anon_suspend      BOOLEAN := FALSE;
  v_anon_note         BOOLEAN := FALSE;
  v_anon_reinstate    BOOLEAN := FALSE;
  v_blk_explicit_false BOOLEAN := FALSE;
  v_is_removed        BOOLEAN;
  v_suspension_count  INT;
  v_action_count      INT;
BEGIN
  v_post_owner     := test_seed_user();
  v_target_user    := test_seed_user();
  v_non_admin      := test_seed_user();
  v_explicit_false := test_seed_user();

  -- Seed the fixture post as the table owner (pre-test_become session role),
  -- which bypasses RLS the same way the moderation functions themselves will.
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_post_owner, 'Reported post under review', 'body-under-review');

  PERFORM test_become(v_non_admin);

  BEGIN
    PERFORM remove_post(v_post, 'harassment');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blk_remove := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blk_remove := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(v_target_user, 'post_react', 3);
  EXCEPTION
    WHEN insufficient_privilege THEN v_blk_suspend := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blk_suspend := TRUE; END IF;
  END;

  BEGIN
    PERFORM add_moderation_note('flagged for review', v_post, NULL);
  EXCEPTION
    WHEN insufficient_privilege THEN v_blk_note := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blk_note := TRUE; END IF;
  END;

  BEGIN
    PERFORM reinstate_post(v_post, 'appeal upheld');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blk_reinstate := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blk_reinstate := TRUE; END IF;
  END;

  PERFORM test_become_anon();

  BEGIN
    PERFORM remove_post(v_post, 'harassment');
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_remove := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_remove := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(v_target_user, 'post_react', 3);
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_suspend := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_suspend := TRUE; END IF;
  END;

  BEGIN
    PERFORM add_moderation_note('flagged for review', v_post, NULL);
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_note := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_note := TRUE; END IF;
  END;

  BEGIN
    PERFORM reinstate_post(v_post, 'appeal upheld');
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_reinstate := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_reinstate := TRUE; END IF;
  END;

  -- An explicit `is_admin: false` claim (as opposed to the claim being
  -- absent/NULL) must also deny — the guard uses `IS DISTINCT FROM true`,
  -- which treats false and NULL identically, but this exercises the
  -- explicit-false path directly rather than relying on absence.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_explicit_false::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_explicit_false::text, 'role', 'authenticated', 'is_admin', false)::text,
    true
  );

  BEGIN
    PERFORM remove_post(v_post, 'harassment');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blk_explicit_false := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blk_explicit_false := TRUE; END IF;
  END;

  RESET ROLE;
  SELECT is_removed INTO v_is_removed FROM collective_posts WHERE id = v_post;
  SELECT count(*) INTO v_suspension_count FROM user_suspensions WHERE user_id = v_target_user;
  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_post_id = v_post OR target_user_id = v_target_user;

  PERFORM tap_ok(v_blk_remove,     'non-admin caller is rejected removing a post');
  PERFORM tap_ok(v_blk_suspend,    'non-admin caller is rejected suspending a user');
  PERFORM tap_ok(v_blk_note,       'non-admin caller is rejected adding a moderation note');
  PERFORM tap_ok(v_blk_reinstate,  'non-admin caller is rejected reinstating a post');
  PERFORM tap_ok(v_anon_remove,    'unauthenticated caller is rejected removing a post');
  PERFORM tap_ok(v_anon_suspend,   'unauthenticated caller is rejected suspending a user');
  PERFORM tap_ok(v_anon_note,      'unauthenticated caller is rejected adding a moderation note');
  PERFORM tap_ok(v_anon_reinstate, 'unauthenticated caller is rejected reinstating a post');
  PERFORM tap_ok(v_blk_explicit_false, 'caller with an explicit is_admin:false claim is rejected removing a post');
  PERFORM tap_ok(v_is_removed IS FALSE,   'rejected removal attempts leave the post state unchanged');
  PERFORM tap_ok(v_suspension_count = 0,  'rejected suspend attempts create no suspension row');
  PERFORM tap_ok(v_action_count = 0,      'rejected attempts write no audit-log row');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
