-- t17: a user-deleted top-level post exposes no title. delete_my_post must
-- blank the title (to the '[deleted]' sentinel) alongside the body, so the
-- feed/thread tombstones — which return cp.title unconditionally — never leak
-- the original letter title. Also asserts the read RPCs surface the blanked
-- title (not the original) to a confirmation the stored row is what leaks.

BEGIN;
\i _helpers.psql
SELECT plan(3);

DO $$
DECLARE
  v_uid  UUID;
  v_post UUID := gen_random_uuid();
  v_stored_title TEXT;
  v_stored_body  TEXT;
  v_feed_title   TEXT;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);

  PERFORM test_become(v_uid);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_uid, 'My private letter title', 'my private body');

  PERFORM delete_my_post(v_post);

  -- Stored row: title + body both blanked to the sentinel.
  RESET ROLE;
  SELECT title, body INTO v_stored_title, v_stored_body
  FROM collective_posts WHERE id = v_post;

  PERFORM tap_ok(v_stored_title = '[deleted]', 'stored title blanked to [deleted]');
  PERFORM tap_ok(v_stored_body  = '[deleted]', 'stored body blanked to [deleted]');

  -- Feed RPC (server-authoritative read path) never surfaces the original title.
  PERFORM test_become(v_uid);
  SELECT title INTO v_feed_title
  FROM collective_feed_page(NULL, 20)
  WHERE id = v_post;

  PERFORM tap_ok(
    v_feed_title IS DISTINCT FROM 'My private letter title',
    'collective_feed_page does not expose the deleted post''s original title'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
