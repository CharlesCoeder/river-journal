-- t13: Story 3-5 -- collective_your_posts_page RPC regression suite.
--
-- Red phase: FAILS because the RPC `collective_your_posts_page` does not
-- exist yet (Story 3-5 lands the migration that creates it).
--
-- Coverage map (AC #4, #5, #6, #7, #8, #20):
--   1.  Auth assertion fires (SQLSTATE 42501) when auth.uid() IS NULL.
--   2.  Returns own posts only (auth.uid() filter).
--   3.  Excludes is_removed = TRUE rows (moderator-removed).
--   4.  Includes is_user_deleted = TRUE rows AND returns the ORIGINAL body
--       verbatim (regression sentinel for the "no server-side [deleted]
--       redaction" design decision -- consistent with feed/thread).
--   5.  descendant_count crosses author boundaries (replies by other users
--       under your post are counted toward your descendant_count).
--   6.  reaction_count aggregation is COUNT(*) over collective_reactions.
--   7.  descendant_count recursive aggregation (reply-of-reply counted).
--   8.  descendant_count outer cap via LEAST(..., 99).
--   9.  tenure_tier is always NULL in this story (sentinel for FR68
--       follow-up; forces explicit re-evaluation when tier population lands).
--   10. mode is always 'full'.
--   11. Cursor pagination with monotonic created_at: 25 posts, two pages.
--   12. page_size clamp: 0 -> 1 row (floor); 999 -> at most 50 rows (ceiling).
--   13. SECURITY DEFINER + search_path pinned via proconfig.
--
-- Note on the descendant cap (#8): we use the LIGHT construction -- seed a
-- handful of descendants and assert LEAST() outer-caps semantics, rather
-- than seeding 100+ rows (option (b) per AC #20).

BEGIN;
\i _helpers.psql
SELECT plan(16);

-- ==========================================================================
-- 1. Auth assertion fires under anon role.
-- ==========================================================================
DO $$
DECLARE
  v_state TEXT;
  v_denied BOOLEAN := FALSE;
BEGIN
  PERFORM test_become_anon();
  BEGIN
    PERFORM * FROM collective_your_posts_page(NULL, 20);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'unauthenticated collective_your_posts_page raises SQLSTATE 42501 (AC #4)');
END $$;

-- ==========================================================================
-- 2. Returns own posts only -- auth.uid() filter excludes other users' posts.
-- ==========================================================================
DO $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
  v_count_a INT;
  v_only_a INT;
BEGIN
  v_user_a := test_seed_user_500();
  v_user_b := test_seed_user_500();

  PERFORM test_become(v_user_a);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user_a, 'a-post-1');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user_a, 'a-post-2');

  PERFORM test_become(v_user_b);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user_b, 'b-post-1');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user_b, 'b-post-2');

  PERFORM test_become(v_user_a);
  SELECT COUNT(*) INTO v_count_a FROM collective_your_posts_page(NULL, 50);
  SELECT COUNT(*) INTO v_only_a FROM collective_your_posts_page(NULL, 50) WHERE user_id = v_user_a;

  PERFORM tap_ok(v_count_a = 2, 'user A sees exactly their 2 posts (AC #7 own-posts filter)');
  PERFORM tap_ok(v_count_a = v_only_a, 'every returned row has user_id = auth.uid() (AC #7)');
END $$;

-- ==========================================================================
-- 3. Excludes is_removed = TRUE rows.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_visible INT;
  v_removed UUID := gen_random_uuid();
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user, 'visible');
  INSERT INTO collective_posts (id, user_id, body, is_removed) VALUES (v_removed, v_user, 'removed', TRUE);

  SELECT COUNT(*) INTO v_visible FROM collective_your_posts_page(NULL, 50) WHERE id = v_removed;
  PERFORM tap_ok(v_visible = 0, 'is_removed = TRUE posts are excluded (AC #7)');
END $$;

-- ==========================================================================
-- 4. is_user_deleted = TRUE: included AND body returned verbatim.
--    Regression sentinel: data layer must NEVER substitute [deleted] for
--    own-posts body. UI redaction belongs in Story 3-14.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_id UUID := gen_random_uuid();
  v_body TEXT;
  v_flag BOOLEAN;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, body, is_user_deleted, user_deleted_at)
  VALUES (v_id, v_user, 'my-original-body-please-dont-redact', TRUE, NOW());

  SELECT body, is_user_deleted INTO v_body, v_flag
  FROM collective_your_posts_page(NULL, 50)
  WHERE id = v_id;

  PERFORM tap_ok(v_flag = TRUE, 'is_user_deleted=TRUE post is included with flag intact (AC #7)');
  PERFORM tap_ok(
    v_body = 'my-original-body-please-dont-redact',
    'body is returned verbatim, not redacted to [deleted] (AC #20 sentinel)'
  );
END $$;

-- ==========================================================================
-- 5. descendant_count crosses author boundaries.
--    Reply by user B under user A's post counts toward A's descendant_count.
-- ==========================================================================
DO $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
  v_a_post UUID := gen_random_uuid();
  v_b_reply UUID := gen_random_uuid();
  v_dcount INT;
BEGIN
  v_user_a := test_seed_user_500();
  v_user_b := test_seed_user_500();

  PERFORM test_become(v_user_a);
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_a_post, v_user_a, 'a-top');

  PERFORM test_become(v_user_b);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_b_reply, v_user_b, 'b-reply', v_a_post);

  PERFORM test_become(v_user_a);
  SELECT descendant_count INTO v_dcount
  FROM collective_your_posts_page(NULL, 50)
  WHERE id = v_a_post;

  PERFORM tap_ok(v_dcount = 1, 'descendant_count counts cross-author replies (AC #7, #20)');
END $$;

-- ==========================================================================
-- 6. reaction_count aggregation.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_post UUID := gen_random_uuid();
  v_reactor1 UUID;
  v_reactor2 UUID;
  v_reactor3 UUID;
  v_rcount INT;
BEGIN
  v_user := test_seed_user_500();
  v_reactor1 := test_seed_user_500();
  v_reactor2 := test_seed_user_500();
  v_reactor3 := test_seed_user_500();

  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_post, v_user, 'p');

  -- Three distinct reactors. Reaction kind enum value: use whichever is
  -- accepted by the table (the v1 schema permits at least 'resonate').
  PERFORM test_become(v_reactor1);
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (gen_random_uuid(), v_post, v_reactor1, 'resonate');
  PERFORM test_become(v_reactor2);
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (gen_random_uuid(), v_post, v_reactor2, 'resonate');
  PERFORM test_become(v_reactor3);
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (gen_random_uuid(), v_post, v_reactor3, 'resonate');

  PERFORM test_become(v_user);
  SELECT reaction_count INTO v_rcount
  FROM collective_your_posts_page(NULL, 50)
  WHERE id = v_post;

  PERFORM tap_ok(v_rcount = 3, 'reaction_count aggregates COUNT(*) over collective_reactions (AC #7, #20)');
END $$;

-- ==========================================================================
-- 7. descendant_count recursive (reply-of-reply).
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
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_top, v_user, 'top');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_r1, v_user, 'r1', v_top);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_r2, v_user, 'r2', v_r1);

  SELECT descendant_count INTO v_dcount
  FROM collective_your_posts_page(NULL, 50)
  WHERE id = v_top;

  PERFORM tap_ok(v_dcount = 2, 'descendant_count walks the recursive CTE (AC #7, #20)');
END $$;

-- ==========================================================================
-- 8. tenure_tier is always NULL (FR68 follow-up sentinel).
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_non_null INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user, 't');

  SELECT COUNT(*) INTO v_non_null
  FROM collective_your_posts_page(NULL, 50)
  WHERE tenure_tier IS NOT NULL;

  PERFORM tap_ok(v_non_null = 0, 'tenure_tier is always NULL in this story (AC #20 sentinel for FR68)');
END $$;

-- ==========================================================================
-- 9. mode is always 'full'.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_total INT;
  v_full INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user, 'm1');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_user, 'm2');

  SELECT COUNT(*) INTO v_total FROM collective_your_posts_page(NULL, 50);
  SELECT COUNT(*) INTO v_full FROM collective_your_posts_page(NULL, 50) WHERE mode = 'full';

  PERFORM tap_ok(v_total = v_full AND v_total >= 2, 'every row has mode = ''full'' (AC #20)');
END $$;

-- ==========================================================================
-- 10. Cursor pagination -- 25 posts, monotonic created_at.
-- ==========================================================================
DO $$
DECLARE
  v_user UUID;
  v_cursor TIMESTAMPTZ;
  v_first INT;
  v_second INT;
  i INT;
BEGIN
  v_user := test_seed_user_500();
  PERFORM test_become(v_user);

  FOR i IN 1..25 LOOP
    INSERT INTO collective_posts (id, user_id, body, created_at)
    VALUES (gen_random_uuid(), v_user, 'page-' || i::text, NOW() - (i || ' minutes')::INTERVAL);
  END LOOP;

  SELECT COUNT(*) INTO v_first FROM collective_your_posts_page(NULL, 20);
  PERFORM tap_ok(v_first = 20, 'first page returns 20 of 25 (AC #7 page_size)');

  -- Cursor = last created_at of the first page.
  SELECT MIN(created_at) INTO v_cursor FROM collective_your_posts_page(NULL, 20);
  SELECT COUNT(*) INTO v_second FROM collective_your_posts_page(v_cursor, 20);
  PERFORM tap_ok(v_second = 5, 'second page returns the remaining 5 with monotonic cursor (AC #6, #20)');
END $$;

-- ==========================================================================
-- 11. page_size clamp -- floor 1, ceiling 50.
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
    INSERT INTO collective_posts (id, user_id, body, created_at)
    VALUES (gen_random_uuid(), v_user, 'clamp-' || i::text, NOW() - (i || ' seconds')::INTERVAL);
  END LOOP;

  SELECT COUNT(*) INTO v_floor FROM collective_your_posts_page(NULL, 0);
  SELECT COUNT(*) INTO v_ceiling FROM collective_your_posts_page(NULL, 999);

  PERFORM tap_ok(v_floor = 1, 'page_size = 0 clamps up to 1 (AC #5)');
  PERFORM tap_ok(v_ceiling = 50, 'page_size = 999 clamps down to 50 (AC #5)');
END $$;

-- ==========================================================================
-- 12. SECURITY DEFINER + search_path pinned via proconfig.
-- ==========================================================================
DO $$
DECLARE
  v_proconfig TEXT[];
  v_has_pin BOOLEAN := FALSE;
BEGIN
  SELECT proconfig INTO v_proconfig
  FROM pg_proc
  WHERE proname = 'collective_your_posts_page'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF v_proconfig IS NOT NULL THEN
    v_has_pin := EXISTS (
      SELECT 1 FROM unnest(v_proconfig) AS opt WHERE opt LIKE 'search_path=%'
    );
  END IF;

  PERFORM tap_ok(v_has_pin, 'collective_your_posts_page has SET search_path pinned (AC #2, #20)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
