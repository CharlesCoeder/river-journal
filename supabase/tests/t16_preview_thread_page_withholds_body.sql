-- t16: collective_thread_page MUST withhold reply bodies from a sub-500
-- (preview) caller.
--
-- SECURITY regression. The preview branch of collective_thread_page
-- (20260506000006, preserved through 20260622000000) returned `cp.body` for
-- the first three replies — the FULL body of each — to sub-500 callers, in
-- violation of the server-authoritative 500-words gate. This test asserts:
--   * FULL mode (500-completed caller): all reply bodies returned verbatim.
--   * PREVIEW mode (sub-500 caller): every reply body is truncated to the
--     server excerpt (<= 140 chars, and NOT the full body).

BEGIN;
\i _helpers.psql
SELECT plan(7);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_root UUID := gen_random_uuid();
  -- Long reply body, no sentence-ending punctuation → truncates to 140 chars.
  v_body TEXT := repeat('reply ', 40);   -- 240 chars, no '.', '!' or '?'
  v_expected_excerpt TEXT;
  -- full-mode capture
  v_full_rows INT;
  v_full_bodies INT;
  v_full_preview INT;
  -- preview-mode capture
  v_pv_rows INT;
  v_pv_preview INT;
  v_pv_leaks INT;      -- rows still carrying the full body (must be 0)
  v_pv_truncated INT;  -- rows truncated to the expected excerpt
BEGIN
  v_expected_excerpt := substring(v_body FROM 1 FOR 140);

  -- Poster (500-completed) seeds a root + three replies (staggered timestamps
  -- so the preview LIMIT 3 is deterministic).
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root, v_poster, 'Root title', 'root body');
  INSERT INTO collective_posts (id, user_id, parent_post_id, body, created_at)
  VALUES (gen_random_uuid(), v_poster, v_root, v_body, NOW() - INTERVAL '3 minutes');
  INSERT INTO collective_posts (id, user_id, parent_post_id, body, created_at)
  VALUES (gen_random_uuid(), v_poster, v_root, v_body, NOW() - INTERVAL '2 minutes');
  INSERT INTO collective_posts (id, user_id, parent_post_id, body, created_at)
  VALUES (gen_random_uuid(), v_poster, v_root, v_body, NOW() - INTERVAL '1 minute');

  -- ── FULL mode: the 500-completed poster reads the reply page. ──
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE body = v_body),
         COUNT(*) FILTER (WHERE mode = 'preview')
  INTO v_full_rows, v_full_bodies, v_full_preview
  FROM collective_thread_page(v_root, NULL, 20);

  PERFORM tap_ok(v_full_rows = 3,     'thread_page: full mode returns all 3 replies');
  PERFORM tap_ok(v_full_bodies = 3,   'thread_page: full mode returns every reply body verbatim');
  PERFORM tap_ok(v_full_preview = 0,  'thread_page: full mode rows are never mode = preview');

  -- ── PREVIEW mode: a sub-500 viewer reads the same reply page. ──
  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE mode = 'preview'),
         COUNT(*) FILTER (WHERE body = v_body),
         COUNT(*) FILTER (WHERE body = v_expected_excerpt AND length(body) <= 140)
  INTO v_pv_rows, v_pv_preview, v_pv_leaks, v_pv_truncated
  FROM collective_thread_page(v_root, NULL, 20);

  PERFORM tap_ok(v_pv_rows = 3,       'thread_page: preview returns up to 3 replies');
  PERFORM tap_ok(v_pv_preview = 3,    'thread_page: every preview row has mode = preview');
  PERFORM tap_ok(v_pv_leaks = 0,      'thread_page: NO preview reply carries the full body (leak closed)');
  PERFORM tap_ok(v_pv_truncated = 3,  'thread_page: every preview reply body is truncated to the server excerpt');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
