-- t15: collective_thread_root MUST withhold the root post's full body from a
-- sub-500 (preview) caller.
--
-- SECURITY regression. The Collective 500-words gate is server-authoritative:
-- a preview caller may see word counts / titles / a truncated excerpt, but
-- NEVER a full body (20260506000006 / 20260618000000). collective_thread_root
-- (20260622000000 / 20260623000000) regressed this by returning `cp.body`
-- unconditionally — `mode` was only a label. This test asserts:
--   * FULL mode (500-completed caller): the full body is returned verbatim.
--   * PREVIEW mode (sub-500 caller): body is truncated to the server excerpt
--     (<= 140 chars, and NOT the full body); title / descendant_count /
--     reactions remain available (only the body is gated).

BEGIN;
\i _helpers.psql
SELECT plan(9);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_root  UUID := gen_random_uuid();
  v_reply UUID := gen_random_uuid();
  -- Long body, no sentence-ending punctuation, so the excerpt heuristic
  -- truncates to the first 140 chars (a genuine, assertable truncation).
  v_body  TEXT := repeat('word ', 60);   -- 300 chars, no '.', '!' or '?'
  v_expected_excerpt TEXT;
  -- full-mode capture
  v_full_body TEXT;
  v_full_mode TEXT;
  -- preview-mode capture
  v_pv_body  TEXT;
  v_pv_mode  TEXT;
  v_pv_title TEXT;
  v_pv_desc  INT;
  v_pv_react JSONB;
BEGIN
  v_expected_excerpt := substring(v_body FROM 1 FOR 140);

  -- Poster (500-completed) seeds the root, one reply (descendant_count control),
  -- and one reaction (reactions control).
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root, v_poster, 'Root title', v_body);
  INSERT INTO collective_posts (id, user_id, parent_post_id, body)
  VALUES (v_reply, v_poster, v_root, 'a reply body');
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (gen_random_uuid(), v_root, v_poster, 'resonate');

  -- ── FULL mode: the 500-completed poster reads their own thread root. ──
  SELECT body, mode INTO v_full_body, v_full_mode
  FROM collective_thread_root(v_root);

  PERFORM tap_ok(v_full_mode = 'full',  'thread_root: 500-completed caller gets mode = full');
  PERFORM tap_ok(v_full_body = v_body,  'thread_root: full mode returns the full body verbatim');

  -- ── PREVIEW mode: a sub-500 viewer reads the same thread root. ──
  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  SELECT body, mode, title, descendant_count, reactions
  INTO v_pv_body, v_pv_mode, v_pv_title, v_pv_desc, v_pv_react
  FROM collective_thread_root(v_root);

  PERFORM tap_ok(v_pv_mode = 'preview',             'thread_root: sub-500 caller gets mode = preview');
  PERFORM tap_ok(v_pv_body <> v_body,               'thread_root: preview does NOT return the full body (leak closed)');
  PERFORM tap_ok(length(v_pv_body) <= 140,          'thread_root: preview body is truncated to <= 140 chars');
  PERFORM tap_ok(v_pv_body = v_expected_excerpt,    'thread_root: preview body equals the server excerpt (first 140 chars)');
  PERFORM tap_ok(v_pv_title = 'Root title',         'thread_root: title is still exposed in preview');
  PERFORM tap_ok(v_pv_desc = 1,                     'thread_root: descendant_count still returned in preview');
  PERFORM tap_ok(v_pv_react ? 'resonate',           'thread_root: reactions tally still returned in preview');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
