-- t40: collective_my_removed_posts -- the self-serve DEFINER RPC that lets
-- the AFFECTED USER (not an admin) read their own removed posts, since
-- moderation_actions is admin-only and collective_your_posts_page
-- deliberately excludes is_removed rows. This is the sole data source for
-- the in-app "your post was removed" receipt.
--
-- Coverage map:
--   A. authorization -- an anonymous caller (auth.uid() IS NULL) is rejected
--      with SQLSTATE 42501.
--   B. exact return shape -- the row carries ONLY {id, parent_post_id,
--      created_at, removed_reason, removed_at}; NEITHER body NOR title is
--      present (privacy assertion -- the receipt must never be able to leak
--      post content, and title is user-authored content too).
--   C. own-only -- the caller's removed post is returned with the expected
--      fields; a SECOND user's removed post is proven absent from the
--      caller's result set (non-tautological -- both rows exist server-side,
--      only one is visible to this caller).
--   D. non-removed exclusion -- an untouched sibling post owned by the same
--      caller is never returned alongside the removed one.
--   E. reply reachability -- a removed reply's parent_post_id is populated so
--      the client can derive reply-vs-top-level without a title column.
--   F. REVOKE/GRANT posture -- EXECUTE is granted to authenticated only; anon
--      and the PUBLIC pseudo-role have no privilege.
--   G. SECURITY DEFINER hardening -- SET search_path is pinned (mirrors
--      collective_your_posts_page's hardening template).
--
-- Red phase: collective_my_removed_posts does not exist yet, so every call
-- against it in blocks B-E raises "function ... does not exist", aborting
-- those DO blocks before their tap_ok lines run -- an unambiguous suite
-- failure. Block A's call is wrapped in an exception handler, so it resolves
-- to FALSE and fails cleanly instead. Blocks F/G probe pg_proc/pg_catalog
-- directly and degrade to failing tap_ok calls (no exception) when the
-- function is absent.

BEGIN;
\i _helpers.psql
SELECT plan(16);

-- ==========================================================================
-- A. Authorization: anon (auth.uid() IS NULL) is rejected with 42501.
-- ==========================================================================
DO $$
DECLARE
  v_state TEXT;
  v_denied BOOLEAN := FALSE;
BEGIN
  PERFORM test_become_anon();
  BEGIN
    PERFORM * FROM collective_my_removed_posts(50);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;

  PERFORM tap_ok(v_denied, 'an anonymous caller (auth.uid() IS NULL) is rejected with SQLSTATE 42501');
END $$;

-- ==========================================================================
-- B. Exact return shape: {id, parent_post_id, created_at, removed_reason,
--    removed_at} only -- no body, no title.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_admin UUID;
  v_post  UUID := gen_random_uuid();
  v_row   RECORD;
  v_keys  TEXT[];
  v_expected_keys TEXT[] := ARRAY['created_at', 'id', 'parent_post_id', 'removed_at', 'removed_reason'];
BEGIN
  v_owner := test_seed_user();
  v_admin := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Column shape probe', 'column-shape-body');

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_post, 'harassment', NULL);
  RESET ROLE;

  PERFORM test_become(v_owner);
  SELECT * INTO v_row FROM collective_my_removed_posts(50) WHERE id = v_post;
  RESET ROLE;

  SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::TEXT[])
  INTO v_keys
  FROM jsonb_object_keys(to_jsonb(v_row)) AS key;

  PERFORM tap_ok(
    v_keys = v_expected_keys,
    format('collective_my_removed_posts returns exactly {id, parent_post_id, created_at, removed_reason, removed_at} (got: %s)', array_to_string(v_keys, ', '))
  );
  PERFORM tap_ok(NOT ('body' = ANY(v_keys)), 'the return shape does NOT include body (NFR structural leak guard)');
  PERFORM tap_ok(NOT ('title' = ANY(v_keys)), 'the return shape does NOT include title (user-authored content)');
END $$;

-- ==========================================================================
-- C. Own-only: caller sees their own removed post; a second user's removed
--    post is proven absent (non-tautological -- both rows exist).
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_other UUID;
  v_admin UUID;
  v_post_owner UUID := gen_random_uuid();
  v_post_other UUID := gen_random_uuid();
  v_own_count      INT;
  v_other_visible  BOOLEAN;
  v_removed_reason TEXT;
  v_removed_at     TIMESTAMPTZ;
  v_other_actually_removed BOOLEAN;
BEGIN
  v_owner := test_seed_user();
  v_other := test_seed_user();
  v_admin := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_post_owner, v_owner, 'Owner post', 'owner-body');
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_post_other, v_other, 'Other post', 'other-body');

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_post_owner, 'spam', NULL);
  PERFORM remove_post(v_post_other, 'spam', NULL);
  RESET ROLE;

  -- Prove the "absence" assertion below is non-tautological: the other
  -- user's post really was removed server-side.
  SELECT is_removed INTO v_other_actually_removed FROM collective_posts WHERE id = v_post_other;

  PERFORM test_become(v_owner);
  SELECT COUNT(*) INTO v_own_count FROM collective_my_removed_posts(50);
  SELECT EXISTS(SELECT 1 FROM collective_my_removed_posts(50) WHERE id = v_post_other) INTO v_other_visible;
  SELECT removed_reason, removed_at INTO v_removed_reason, v_removed_at
  FROM collective_my_removed_posts(50) WHERE id = v_post_owner;
  RESET ROLE;

  PERFORM tap_ok(v_other_actually_removed, 'sanity: the second user''s post really is removed server-side (non-tautological setup)');
  PERFORM tap_ok(v_own_count = 1, 'the caller sees exactly one row -- their own removed post');
  PERFORM tap_ok(NOT v_other_visible, 'a second user''s removed post is NEVER returned to the caller');
  PERFORM tap_ok(v_removed_reason = 'spam', 'the returned removed_reason mirrors the code passed to remove_post');
  PERFORM tap_ok(v_removed_at IS NOT NULL, 'removed_at is populated for a removed post');
END $$;

-- ==========================================================================
-- D. Non-removed exclusion: an untouched sibling post is never returned.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_admin UUID;
  v_removed_post   UUID := gen_random_uuid();
  v_untouched_post UUID := gen_random_uuid();
  v_count INT;
  v_untouched_visible BOOLEAN;
BEGIN
  v_owner := test_seed_user();
  v_admin := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_removed_post, v_owner, 'Removed', 'removed-body');
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_untouched_post, v_owner, 'Untouched', 'untouched-body');

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_removed_post, 'other', NULL);
  RESET ROLE;

  PERFORM test_become(v_owner);
  SELECT COUNT(*) INTO v_count FROM collective_my_removed_posts(50);
  SELECT EXISTS(SELECT 1 FROM collective_my_removed_posts(50) WHERE id = v_untouched_post) INTO v_untouched_visible;
  RESET ROLE;

  PERFORM tap_ok(v_count = 1, 'only the removed post is returned -- the untouched sibling post is excluded');
  PERFORM tap_ok(NOT v_untouched_visible, 'a non-removed own post is never returned by collective_my_removed_posts');
END $$;

-- ==========================================================================
-- E. Reply reachability: parent_post_id is populated for a removed reply.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_admin UUID;
  v_top   UUID := gen_random_uuid();
  v_reply UUID := gen_random_uuid();
  v_parent_post_id UUID;
BEGIN
  v_owner := test_seed_user();
  v_admin := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_top, v_owner, 'Top-level', 'top-body');
  INSERT INTO collective_posts (id, user_id, parent_post_id, body) VALUES (v_reply, v_owner, v_top, 'reply-body');

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_reply, 'off_topic', NULL);
  RESET ROLE;

  PERFORM test_become(v_owner);
  SELECT parent_post_id INTO v_parent_post_id FROM collective_my_removed_posts(50) WHERE id = v_reply;
  RESET ROLE;

  PERFORM tap_ok(
    v_parent_post_id = v_top,
    'a removed reply carries its parent_post_id so the client derives reply-vs-top-level without a title column'
  );
END $$;

-- ==========================================================================
-- F. REVOKE/GRANT posture.
-- ==========================================================================
DO $$
BEGIN
  PERFORM tap_ok(
    has_function_privilege('authenticated', 'public.collective_my_removed_posts(integer)', 'EXECUTE'),
    'the authenticated role has EXECUTE privilege on collective_my_removed_posts'
  );
  PERFORM tap_ok(
    NOT has_function_privilege('anon', 'public.collective_my_removed_posts(integer)', 'EXECUTE'),
    'the anon role has no EXECUTE privilege on collective_my_removed_posts'
  );
  PERFORM tap_ok(
    NOT has_function_privilege('public', 'public.collective_my_removed_posts(integer)', 'EXECUTE'),
    'the PUBLIC pseudo-role has no EXECUTE privilege on collective_my_removed_posts'
  );
END $$;

-- ==========================================================================
-- G. SECURITY DEFINER + search_path pinned (mirrors collective_your_posts_page).
-- ==========================================================================
DO $$
DECLARE
  v_proconfig TEXT[];
  v_has_pin BOOLEAN := FALSE;
BEGIN
  SELECT proconfig INTO v_proconfig
  FROM pg_proc
  WHERE proname = 'collective_my_removed_posts'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF v_proconfig IS NOT NULL THEN
    v_has_pin := EXISTS (
      SELECT 1 FROM unnest(v_proconfig) AS opt WHERE opt LIKE 'search_path=%'
    );
  END IF;

  PERFORM tap_ok(v_has_pin, 'collective_my_removed_posts has SET search_path pinned');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
