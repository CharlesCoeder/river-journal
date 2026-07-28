-- t37: the admin-only single-post detail read RPC used by the audit trail's
-- tap-through, plus a corrected RLS assertion for a non-admin AUTHENTICATED
-- reader of moderation_actions (distinct from the anon case already covered
-- elsewhere).
--
-- Coverage map:
--   A. authorization -- a non-admin authenticated caller AND an anonymous
--      caller calling the RPC are both rejected with SQLSTATE 42501.
--   B. current-state read -- an admin calling the RPC for an ordinary,
--      untouched post gets back exactly one row whose fields mirror the
--      underlying collective_posts row.
--   C. removed-post reachability -- a post that has already been removed
--      (is_removed = TRUE, no longer pending any report) is STILL reachable
--      through this RPC -- unlike a pending-reports-only queue read.
--   D. self-deleted-post reachability -- a post whose author self-deleted
--      the content (is_user_deleted = TRUE) is likewise reachable, full body
--      included (an admin-power read; UI-layer tombstoning is a separate
--      concern from what the server returns).
--   E. nonexistent target -- a target_post_id with no matching row returns
--      zero rows, not an exception.
--   F. moderation_actions RLS, non-admin AUTHENTICATED case (NOT anon) --
--      deliberately NOT a copy of the anon 42501/insufficient_privilege
--      pattern used elsewhere. moderation_actions still carries GRANT SELECT
--      TO authenticated, so a non-admin authenticated caller's SELECT is
--      silently filtered by the admin-only RLS policy down to zero rows,
--      with NO exception raised at all. Assert on row count = 0, and prove
--      the assertion isn't tautological by showing the very same query
--      returns 1 row for the same target id once the caller is an admin.
--
-- Red phase: the RPC does not exist yet, so every uncaught call in blocks
-- B-E raises "function ... does not exist", aborting those DO blocks outright
-- (no tap lines emitted for them) -- an unambiguous suite failure. Block A's
-- calls are guarded by exception handlers, so it resolves its flags to
-- FALSE and fails cleanly instead. Block F exercises only the pre-existing
-- moderation_actions table (not the new RPC), so its coverage is new
-- regardless of RPC readiness -- this surface is what first depends on that
-- RLS path being correct, so it must be asserted explicitly here.

BEGIN;
\i _helpers.psql
SELECT plan(21);

-- ==========================================================================
-- A. Authorization: non-admin authenticated caller AND anon are rejected.
-- ==========================================================================
DO $$
DECLARE
  v_non_admin UUID;
  v_owner     UUID;
  v_post      UUID := gen_random_uuid();
  v_state     TEXT;
  v_blocked_non_admin BOOLEAN := FALSE;
  v_blocked_anon      BOOLEAN := FALSE;
BEGIN
  v_non_admin := test_seed_user();
  v_owner     := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Authz probe post', 'authz-probe-body');

  PERFORM test_become(v_non_admin);
  BEGIN
    PERFORM * FROM collective_post_admin_detail(v_post);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_blocked_non_admin := TRUE; END IF;
  END;

  PERFORM test_become_anon();
  BEGIN
    PERFORM * FROM collective_post_admin_detail(v_post);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_blocked_anon := TRUE; END IF;
  END;

  RESET ROLE;

  PERFORM tap_ok(v_blocked_non_admin, 'a non-admin authenticated caller is rejected with 42501');
  PERFORM tap_ok(v_blocked_anon,      'an anonymous caller is rejected with 42501');
END $$;

-- ==========================================================================
-- B. Current-state read: an ordinary post's fields mirror collective_posts.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_post   UUID := gen_random_uuid();
  v_rows           INT;
  v_post_id        UUID;
  v_title          TEXT;
  v_body           TEXT;
  v_is_removed     BOOLEAN;
  v_is_user_deleted BOOLEAN;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Ordinary detail post', 'ordinary-detail-body');

  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_rows FROM collective_post_admin_detail(v_post);
  SELECT post_id, title, body, is_removed, is_user_deleted
  INTO v_post_id, v_title, v_body, v_is_removed, v_is_user_deleted
  FROM collective_post_admin_detail(v_post);
  RESET ROLE;

  PERFORM tap_ok(v_rows = 1,                       'an admin gets exactly one row for an existing post');
  PERFORM tap_ok(v_post_id = v_post,                'the returned post_id matches the requested target_post_id');
  PERFORM tap_ok(v_title = 'Ordinary detail post',  'the returned title mirrors the underlying post row');
  PERFORM tap_ok(v_body = 'ordinary-detail-body',   'the returned body mirrors the underlying post row');
  PERFORM tap_ok(NOT v_is_removed,                  'an untouched post carries is_removed = FALSE');
  PERFORM tap_ok(NOT v_is_user_deleted,             'an untouched post carries is_user_deleted = FALSE');
END $$;

-- ==========================================================================
-- C. A REMOVED post (no pending report left) is still reachable.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_post   UUID := gen_random_uuid();
  v_exists       BOOLEAN;
  v_is_removed   BOOLEAN;
  v_removed_reason TEXT;
  v_removed_at   TIMESTAMPTZ;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body, is_removed, removed_reason, removed_at)
  VALUES (v_post, v_owner, 'Already removed post', 'removed-detail-body', TRUE, 'spam', NOW());

  PERFORM test_become_admin(v_admin);
  SELECT EXISTS(SELECT 1 FROM collective_post_admin_detail(v_post)) INTO v_exists;
  SELECT is_removed, removed_reason, removed_at
  INTO v_is_removed, v_removed_reason, v_removed_at
  FROM collective_post_admin_detail(v_post);
  RESET ROLE;

  PERFORM tap_ok(v_exists,                          'a removed post (no pending report) is still reachable through the detail RPC');
  PERFORM tap_ok(v_is_removed,                      'the removed post carries is_removed = TRUE');
  PERFORM tap_ok(v_removed_reason = 'spam',         'the removed post carries the recorded removed_reason');
  PERFORM tap_ok(v_removed_at IS NOT NULL,          'the removed post carries a non-null removed_at');
END $$;

-- ==========================================================================
-- D. A self-deleted post is reachable, full body included.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_post   UUID := gen_random_uuid();
  v_exists            BOOLEAN;
  v_is_user_deleted   BOOLEAN;
  v_user_deleted_at   TIMESTAMPTZ;
  v_body              TEXT;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body, is_user_deleted, user_deleted_at)
  VALUES (v_post, v_owner, 'Self-deleted post', 'self-deleted-full-body', TRUE, NOW());

  PERFORM test_become_admin(v_admin);
  SELECT EXISTS(SELECT 1 FROM collective_post_admin_detail(v_post)) INTO v_exists;
  SELECT is_user_deleted, user_deleted_at, body
  INTO v_is_user_deleted, v_user_deleted_at, v_body
  FROM collective_post_admin_detail(v_post);
  RESET ROLE;

  PERFORM tap_ok(v_exists,                          'a self-deleted post is still reachable through the detail RPC');
  PERFORM tap_ok(v_is_user_deleted,                 'the self-deleted post carries is_user_deleted = TRUE');
  PERFORM tap_ok(v_user_deleted_at IS NOT NULL,     'the self-deleted post carries a non-null user_deleted_at');
  PERFORM tap_ok(v_body = 'self-deleted-full-body', 'the full body is still returned to an admin even for a self-deleted post');
END $$;

-- ==========================================================================
-- E. A nonexistent target_post_id returns zero rows, not an exception.
-- ==========================================================================
DO $$
DECLARE
  v_admin   UUID;
  v_missing UUID := gen_random_uuid();
  v_rows    INT;
  v_no_exception BOOLEAN := FALSE;
BEGIN
  v_admin := test_seed_user();

  PERFORM test_become_admin(v_admin);
  BEGIN
    SELECT COUNT(*) INTO v_rows FROM collective_post_admin_detail(v_missing);
    v_no_exception := TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      v_no_exception := FALSE;
  END;
  RESET ROLE;

  PERFORM tap_ok(v_rows = 0,        'a nonexistent target_post_id returns zero rows');
  PERFORM tap_ok(v_no_exception,    'a nonexistent target_post_id does not raise an exception');
END $$;

-- ==========================================================================
-- F. moderation_actions RLS: a non-admin AUTHENTICATED SELECT is silently
--    filtered to zero rows -- it does NOT raise 42501 like the anon case.
-- ==========================================================================
DO $$
DECLARE
  v_admin     UUID;
  v_non_admin UUID;
  v_actor     UUID;
  v_action_id UUID := gen_random_uuid();
  v_non_admin_rows INT;
  v_admin_rows     INT;
  v_non_admin_no_exception BOOLEAN := FALSE;
BEGIN
  v_admin     := test_seed_user();
  v_non_admin := test_seed_user();
  v_actor     := test_seed_user();

  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_action_id, v_actor, 'add_note', v_actor);

  PERFORM test_become(v_non_admin);
  BEGIN
    SELECT COUNT(*) INTO v_non_admin_rows FROM moderation_actions WHERE id = v_action_id;
    v_non_admin_no_exception := TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      v_non_admin_no_exception := FALSE;
  END;

  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_admin_rows FROM moderation_actions WHERE id = v_action_id;

  RESET ROLE;

  PERFORM tap_ok(v_non_admin_no_exception, 'a non-admin authenticated SELECT on moderation_actions completes without raising an exception');
  PERFORM tap_ok(v_non_admin_rows = 0,     'a non-admin authenticated SELECT on moderation_actions silently filters the row to zero results (RLS, not a raised error)');
  PERFORM tap_ok(v_admin_rows = 1,         'the identical query returns the row for an admin caller, proving the non-admin zero-row result is the RLS filter at work, not a seeding mistake');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
