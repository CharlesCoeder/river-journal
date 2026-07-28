-- t51: collective_export_page -- the DEFINER RPC powering the caller's own
-- Collective data-portability export. Unlike collective_your_posts_page it
-- must return the owner's ENTIRE history: moderator-removed rows WITH their
-- original body + title (collective_your_posts_page filters is_removed out;
-- collective_my_removed_posts withholds body/title), plus self-deleted rows.
--
-- Coverage map:
--   A. authorization -- an anonymous caller (auth.uid() IS NULL) is rejected
--      with SQLSTATE 42501.
--   B. own-only -- caller sees only their own posts; a second user's post is
--      proven absent (non-tautological -- both rows exist server-side).
--   C. moderator-removed rows ARE included, WITH body + title + removed_reason
--      + removed_at (the key departure from collective_your_posts_page).
--   D. self-deleted rows ARE included with their DB '[deleted]' body + the
--      is_user_deleted flag + user_deleted_at.
--   E. reaction_count aggregates COUNT(*) over collective_reactions.
--   F. descendant_count is the EXACT (uncapped) reply count -- no LEAST(.,99).
--   G. page_size clamp -- floor 1, ceiling 50.
--   H. cursor pagination -- composite keyset over (created_at, id) DESC, two
--      pages, with the resume cursor split into (cursor, cursor_id).
--   I. REVOKE/GRANT posture -- EXECUTE granted to authenticated only.
--   J. SECURITY DEFINER + search_path pinned (mirrors the hardening template).
--   K. tied-timestamp pagination -- several rows sharing ONE identical
--      created_at that spans a page boundary are each returned exactly once
--      (the composite (created_at, id) keyset prevents the boundary-row skip
--      that a created_at-only cursor would cause -- data loss in an export).
--
-- Red phase: collective_export_page does not exist yet, so calls against it in
-- blocks B-H raise "function ... does not exist", aborting those DO blocks
-- before their tap_ok lines run. Block A's call is wrapped in an exception
-- handler, so it resolves to FALSE and fails cleanly. Blocks I/J probe
-- pg_proc/pg_catalog directly and degrade to failing tap_ok (no exception).

BEGIN;
\i _helpers.psql
SELECT plan(19);

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
    PERFORM * FROM collective_export_page(NULL, NULL, 20);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;

  PERFORM tap_ok(v_denied, 'an anonymous caller (auth.uid() IS NULL) is rejected with SQLSTATE 42501');
END $$;

-- ==========================================================================
-- B. Own-only: caller sees their own posts; a second user's post is absent.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_other UUID;
  v_post_other UUID := gen_random_uuid();
  v_own_count INT;
  v_other_visible BOOLEAN;
BEGIN
  v_owner := test_seed_user_500();
  v_other := test_seed_user_500();

  PERFORM test_become(v_owner);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (gen_random_uuid(), v_owner, 'Owner one', 'owner-1');
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (gen_random_uuid(), v_owner, 'Owner two', 'owner-2');

  PERFORM test_become(v_other);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_post_other, v_other, 'Other post', 'other-body');

  PERFORM test_become(v_owner);
  SELECT COUNT(*) INTO v_own_count FROM collective_export_page(NULL, NULL, 50);
  SELECT EXISTS(SELECT 1 FROM collective_export_page(NULL, NULL, 50) WHERE id = v_post_other) INTO v_other_visible;
  RESET ROLE;

  PERFORM tap_ok(v_own_count = 2, 'the caller sees exactly their own 2 posts');
  PERFORM tap_ok(NOT v_other_visible, 'a second user''s post is never returned to the caller');
END $$;

-- ==========================================================================
-- C. Moderator-removed rows ARE included, WITH body + title + reason + at.
--    This is the deliberate difference from collective_your_posts_page.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_admin UUID;
  v_post  UUID := gen_random_uuid();
  v_row   RECORD;
BEGIN
  v_owner := test_seed_user_500();
  v_admin := test_seed_user();

  PERFORM test_become(v_owner);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Removed title stays', 'removed-body-stays');
  RESET ROLE;

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_post, 'harassment', NULL);
  RESET ROLE;

  PERFORM test_become(v_owner);
  SELECT * INTO v_row FROM collective_export_page(NULL, NULL, 50) WHERE id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_row.id = v_post, 'a moderator-removed post IS returned in the export (unlike collective_your_posts_page)');
  PERFORM tap_ok(v_row.is_removed = TRUE, 'the removed row carries is_removed = TRUE');
  PERFORM tap_ok(v_row.body = 'removed-body-stays', 'the removed row still carries its ORIGINAL body (owner reading own data)');
  PERFORM tap_ok(v_row.title = 'Removed title stays', 'the removed row still carries its ORIGINAL title');
  PERFORM tap_ok(v_row.removed_reason = 'harassment' AND v_row.removed_at IS NOT NULL, 'the removed row surfaces removed_reason + removed_at for the marker');
END $$;

-- ==========================================================================
-- D. Self-deleted rows ARE included with the DB '[deleted]' body + flag.
-- ==========================================================================
DO $$
DECLARE
  v_owner UUID;
  v_post  UUID := gen_random_uuid();
  v_row   RECORD;
BEGIN
  v_owner := test_seed_user_500();

  PERFORM test_become(v_owner);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Soon deleted', 'about-to-delete');
  PERFORM delete_my_post(v_post);

  SELECT * INTO v_row FROM collective_export_page(NULL, NULL, 50) WHERE id = v_post;
  RESET ROLE;

  PERFORM tap_ok(
    v_row.is_user_deleted = TRUE AND v_row.body = '[deleted]' AND v_row.user_deleted_at IS NOT NULL,
    'a self-deleted post IS returned with the DB [deleted] body, is_user_deleted flag, and user_deleted_at'
  );
END $$;

-- ==========================================================================
-- E. reaction_count aggregation.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_post UUID := gen_random_uuid();
  v_r1 UUID;
  v_r2 UUID;
  v_rcount INT;
BEGIN
  v_user := test_seed_user_500();
  v_r1 := test_seed_user_500();
  v_r2 := test_seed_user_500();

  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_post, v_user, 'React', 'react');

  PERFORM test_become(v_r1);
  INSERT INTO collective_reactions (id, post_id, user_id, kind) VALUES (gen_random_uuid(), v_post, v_r1, 'heart');
  PERFORM test_become(v_r2);
  INSERT INTO collective_reactions (id, post_id, user_id, kind) VALUES (gen_random_uuid(), v_post, v_r2, 'flame');

  PERFORM test_become(v_user);
  SELECT reaction_count INTO v_rcount FROM collective_export_page(NULL, NULL, 50) WHERE id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_rcount = 2, 'reaction_count aggregates COUNT(*) over collective_reactions');
END $$;

-- ==========================================================================
-- F. descendant_count is the EXACT (uncapped) reply count.
--    Seed a small recursive reply chain and assert the true count.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_top UUID := gen_random_uuid();
  v_r1 UUID := gen_random_uuid();
  v_r2 UUID := gen_random_uuid();
  v_dcount INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_top, v_user, 'Top', 'top');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_r1, v_user, 'r1', v_top);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_r2, v_user, 'r2', v_r1);

  SELECT descendant_count INTO v_dcount FROM collective_export_page(NULL, NULL, 50) WHERE id = v_top;
  RESET ROLE;

  PERFORM tap_ok(v_dcount = 2, 'descendant_count walks the recursive reply chain (exact, uncapped)');
END $$;

-- ==========================================================================
-- G. page_size clamp -- floor 1, ceiling 50.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_floor INT;
  v_ceiling INT;
  i INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  FOR i IN 1..60 LOOP
    INSERT INTO collective_posts (id, user_id, title, body, created_at)
    VALUES (gen_random_uuid(), v_user, 'Clamp ' || i::text, 'clamp-' || i::text, NOW() - (i || ' seconds')::INTERVAL);
  END LOOP;

  SELECT COUNT(*) INTO v_floor FROM collective_export_page(NULL, NULL, 0);
  SELECT COUNT(*) INTO v_ceiling FROM collective_export_page(NULL, NULL, 999);
  RESET ROLE;

  PERFORM tap_ok(v_floor = 1, 'page_size = 0 clamps up to 1');
  PERFORM tap_ok(v_ceiling = 50, 'page_size = 999 clamps down to 50');
END $$;

-- ==========================================================================
-- H. Cursor pagination -- 25 posts, monotonic created_at, two pages. The
--    resume cursor is the COMPOSITE (created_at, id) of the last row of the
--    first page (its minimum tuple), split into (cursor, cursor_id).
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_cursor_ts TIMESTAMPTZ;
  v_cursor_id UUID;
  v_first INT;
  v_second INT;
  i INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  FOR i IN 1..25 LOOP
    INSERT INTO collective_posts (id, user_id, title, body, created_at)
    VALUES (gen_random_uuid(), v_user, 'Page ' || i::text, 'page-' || i::text, NOW() - (i || ' minutes')::INTERVAL);
  END LOOP;

  SELECT COUNT(*) INTO v_first FROM collective_export_page(NULL, NULL, 20);
  -- Last row of the first page = the smallest (created_at, id) tuple in it.
  SELECT created_at, id INTO v_cursor_ts, v_cursor_id
    FROM collective_export_page(NULL, NULL, 20)
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  SELECT COUNT(*) INTO v_second FROM collective_export_page(v_cursor_ts, v_cursor_id, 20);
  RESET ROLE;

  PERFORM tap_ok(v_first = 20, 'first page returns 20 of 25');
  PERFORM tap_ok(v_second = 5, 'second page returns the remaining 5 from the composite (created_at, id) cursor');
END $$;

-- ==========================================================================
-- K. Tied-timestamp pagination -- 5 posts sharing ONE identical created_at
--    that spans a page boundary (page_size = 2) are EACH returned exactly
--    once. A created_at-only cursor with a strict `<` would skip the rows
--    sharing the boundary row's timestamp past the page limit -- silent data
--    loss in a data-portability export. The composite (created_at, id) keyset
--    makes the key a total order, so every row is paged through exactly once.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_ts TIMESTAMPTZ := NOW();
  v_cursor_ts TIMESTAMPTZ := NULL;
  v_cursor_id UUID := NULL;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_page_ids UUID[];
  v_total INT;
  v_distinct INT;
  i INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  -- 5 posts sharing ONE identical created_at.
  FOR i IN 1..5 LOOP
    INSERT INTO collective_posts (id, user_id, title, body, created_at)
    VALUES (gen_random_uuid(), v_user, 'Tie ' || i::text, 'tie-' || i::text, v_ts);
  END LOOP;

  -- Page 2 at a time across the tied block, collecting every id seen and
  -- advancing the cursor to each page's last (minimum-tuple) row.
  LOOP
    SELECT array_agg(id) INTO v_page_ids
      FROM collective_export_page(v_cursor_ts, v_cursor_id, 2);
    EXIT WHEN v_page_ids IS NULL OR array_length(v_page_ids, 1) = 0;
    v_seen := v_seen || v_page_ids;

    SELECT created_at, id INTO v_cursor_ts, v_cursor_id
      FROM collective_export_page(v_cursor_ts, v_cursor_id, 2)
      ORDER BY created_at ASC, id ASC
      LIMIT 1;

    EXIT WHEN array_length(v_page_ids, 1) < 2;
  END LOOP;
  RESET ROLE;

  SELECT COUNT(*), COUNT(DISTINCT x) INTO v_total, v_distinct
  FROM unnest(v_seen) AS x;

  PERFORM tap_ok(
    v_total = 5 AND v_distinct = 5,
    'rows sharing an identical created_at across a page boundary are each returned exactly once (composite keyset, no boundary-row skip)'
  );
END $$;

-- ==========================================================================
-- I. REVOKE/GRANT posture.
-- ==========================================================================
DO $$
BEGIN
  PERFORM tap_ok(
    has_function_privilege('authenticated', 'public.collective_export_page(timestamptz, uuid, integer)', 'EXECUTE'),
    'the authenticated role has EXECUTE privilege on collective_export_page'
  );
  PERFORM tap_ok(
    NOT has_function_privilege('anon', 'public.collective_export_page(timestamptz, uuid, integer)', 'EXECUTE'),
    'the anon role has no EXECUTE privilege on collective_export_page'
  );
END $$;

-- ==========================================================================
-- J. SECURITY DEFINER + search_path pinned.
-- ==========================================================================
DO $$
DECLARE
  v_proconfig TEXT[];
  v_has_pin BOOLEAN := FALSE;
BEGIN
  SELECT proconfig INTO v_proconfig
  FROM pg_proc
  WHERE proname = 'collective_export_page'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF v_proconfig IS NOT NULL THEN
    v_has_pin := EXISTS (
      SELECT 1 FROM unnest(v_proconfig) AS opt WHERE opt LIKE 'search_path=%'
    );
  END IF;

  PERFORM tap_ok(v_has_pin, 'collective_export_page has SET search_path pinned');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
